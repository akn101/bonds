import { App } from "antd";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import type { APIError, CreateImportantDateRequest } from "@/api";
import {
  invalidateReminderQueries,
  queryKeyPrefixes,
  type ContactQueryScope,
  type QueryInvalidationScopes,
} from "@/utils/queryInvalidation";
import type { ImportantDateFormValues } from "@/utils/importantDatePrecision";
import type { ContactSaveMutationOperation } from "./contactSaveMutationOperation";

export type ImportantDateMutationContext = {
  readonly source: ContactQueryScope;
  readonly listQueryKey: QueryKey;
  readonly affectedScopes: QueryInvalidationScopes;
};

export type ImportantDateSaveMutationOperation =
  ContactSaveMutationOperation<ImportantDateFormValues> &
    ImportantDateMutationContext & {
      readonly request: CreateImportantDateRequest;
    };

export type ImportantDateDeleteMutationOperation =
  ImportantDateMutationContext & {
    readonly kind: "delete";
    readonly id: number;
  };

type ImportantDateMutationConfig = {
  readonly closeSaveForm: () => void;
};

export function useImportantDateMutations({
  closeSaveForm,
}: ImportantDateMutationConfig) {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const saveMutation = useMutation({
    mutationFn: (operation: ImportantDateSaveMutationOperation) => {
      switch (operation.kind) {
        case "create":
          return api.importantDates.contactsDatesCreate(
            operation.source.vaultId,
            operation.source.contactId,
            operation.request,
          );
        case "update":
          return api.importantDates.contactsDatesUpdate(
            operation.source.vaultId,
            operation.source.contactId,
            operation.id,
            operation.request,
          );
      }
    },
    onSuccess: async (_data, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeyPrefixes.calendar.vault(operation.source.vaultId),
        }),
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateReminderQueries(queryClient, operation.affectedScopes),
      ]);
      closeSaveForm();
      message.success(
        operation.kind === "update"
          ? t("modules.important_dates.updated")
          : t("modules.important_dates.added"),
      );
    },
    onError: (error: APIError) => message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (operation: ImportantDateDeleteMutationOperation) =>
      api.importantDates.contactsDatesDelete(
        operation.source.vaultId,
        operation.source.contactId,
        operation.id,
      ),
    onSuccess: async (_data, operation) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeyPrefixes.calendar.vault(operation.source.vaultId),
        }),
        queryClient.invalidateQueries({ queryKey: operation.listQueryKey }),
        invalidateReminderQueries(queryClient, operation.affectedScopes),
      ]);
      message.success(t("modules.important_dates.deleted"));
    },
    onError: (error: APIError) => message.error(error.message),
  });

  return { saveMutation, deleteMutation };
}
