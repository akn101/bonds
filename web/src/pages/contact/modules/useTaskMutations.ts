import { App } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, isPlainAPIError } from "@/api";
import type { APIError, Task, VaultTask } from "@/api";
import { invalidateFeedQueries } from "@/utils/queryInvalidation";
import {
  invalidateTaskListQueries,
  invalidateVaultTaskImpactQueries,
  invalidateVaultTaskListQuery,
  vaultTaskListQueryKey,
} from "@/utils/taskQueryInvalidation";
import {
  type TaskDeleteMutationOperation,
  type TaskDeleteMutationRequest,
  type TaskSaveMutationOperation,
  type TaskToggleMutationOperation,
  resolveTaskDeleteMutationOperation,
} from "./taskMutationOperation";

type TaskMutationConfig = {
  readonly resetSaveForm: () => void;
};

function taskMutationSources(
  source: TaskSaveMutationOperation["source"],
  contactIds: readonly (string | number | undefined)[],
): readonly TaskSaveMutationOperation["source"][] {
  const normalizedContactIds = new Set<string>([source.contactId]);
  for (const contactId of contactIds) {
    if (contactId !== undefined) normalizedContactIds.add(String(contactId));
  }
  return [...normalizedContactIds].map((contactId) => ({
    vaultId: source.vaultId,
    contactId,
  }));
}

export function useTaskMutations({ resetSaveForm }: TaskMutationConfig) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const saveMutation = useMutation({
    mutationFn: (operation: TaskSaveMutationOperation) => {
      if (operation.kind === "update") {
        return api.tasks.contactsTasksUpdate(
          operation.source.vaultId,
          operation.source.contactId,
          operation.id,
          operation.values,
        );
      }
      return api.tasks.contactsTasksCreate(
        operation.source.vaultId,
        operation.source.contactId,
        operation.values,
      );
    },
    onSuccess: async (response, operation) => {
      const taskSources =
        operation.kind === "create"
          ? [operation.source]
          : taskMutationSources(operation.source, [
              ...operation.previousAssigneeContactIds,
              ...(response.data?.contacts ?? []).map(
                (contact: NonNullable<Task["contacts"]>[number]) => contact.id,
              ),
            ]);
      const invalidations = [
        invalidateVaultTaskListQuery(queryClient, operation.source.vaultId),
        invalidateTaskListQueries(queryClient, taskSources),
      ];
      if (operation.kind === "create") {
        invalidations.push(
          invalidateFeedQueries(queryClient, {
            vaultIds: [operation.source.vaultId],
            contacts: [operation.source],
          }),
        );
      }
      await Promise.all(invalidations);
      resetSaveForm();
      message.success(
        operation.kind === "update"
          ? t("modules.tasks.updated")
          : t("modules.tasks.added"),
      );
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (operation: TaskToggleMutationOperation) =>
      api.tasks.contactsTasksToggleUpdate(
        operation.source.vaultId,
        operation.source.contactId,
        operation.id,
      ),
    onSuccess: async (response, operation) => {
      const taskSources = taskMutationSources(operation.source, [
        ...operation.previousAssigneeContactIds,
        ...(response.data?.contacts ?? []).map(
          (contact: NonNullable<Task["contacts"]>[number]) => contact.id,
        ),
      ]);
      const invalidations = [
        invalidateVaultTaskListQuery(queryClient, operation.source.vaultId),
        invalidateTaskListQueries(queryClient, taskSources),
      ];
      if (response.data?.completed === true) {
        invalidations.push(
          invalidateFeedQueries(queryClient, {
            vaultIds: [operation.source.vaultId],
            contacts: [operation.source],
          }),
        );
      }
      await Promise.all(invalidations);
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (operation: TaskDeleteMutationOperation) =>
      api.tasks.contactsTasksDelete(
        operation.source.vaultId,
        operation.source.contactId,
        operation.id,
      ),
    onSuccess: async (_response, operation) => {
      if (operation.impact.kind === "fallback") {
        await Promise.all([
          invalidateVaultTaskImpactQueries(queryClient, [
            operation.source.vaultId,
          ]),
          invalidateFeedQueries(queryClient, {
            vaultIds: [operation.source.vaultId],
            contacts: [],
          }),
        ]);
      } else {
        const impactedSources = taskMutationSources(
          operation.source,
          operation.impact.assigneeContactIds,
        );
        await Promise.all([
          invalidateVaultTaskListQuery(queryClient, operation.source.vaultId),
          invalidateTaskListQueries(queryClient, impactedSources),
          invalidateFeedQueries(queryClient, {
            vaultIds: [operation.source.vaultId],
            contacts: impactedSources,
          }),
        ]);
      }
      message.success(t("modules.tasks.deleted"));
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const deleteImpactMutation = useMutation({
    mutationFn: async (
      request: TaskDeleteMutationRequest,
    ): Promise<TaskDeleteMutationOperation> => {
      const allTasksQueryKey = vaultTaskListQueryKey(request.source.vaultId);
      const cachedAllTasks =
        queryClient.getQueryData<readonly VaultTask[]>(allTasksQueryKey);
      const cacheState = queryClient.getQueryState(allTasksQueryKey);
      let allTasks: readonly VaultTask[] | undefined;
      if (cachedAllTasks !== undefined && cacheState?.isInvalidated === false) {
        allTasks = cachedAllTasks;
      } else {
        try {
          const response = await api.vaultTasks.tasksList(
            request.source.vaultId,
            {},
          );
          allTasks = response.data ?? [];
        } catch (error) {
          // Generated API failures are plain objects; programmer errors must still abort before DELETE.
          if (!isPlainAPIError(error)) throw error;
          allTasks = undefined;
        }
      }

      // The backend deletes descendants recursively, so snapshot every affected assignee before DELETE.
      return resolveTaskDeleteMutationOperation(request, allTasks);
    },
    onSuccess: (operation) => deleteMutation.mutate(operation),
  });

  return {
    saveMutation,
    toggleMutation,
    deleteMutation: deleteImpactMutation,
  };
}
