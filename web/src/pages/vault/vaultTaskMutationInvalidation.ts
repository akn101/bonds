import type { QueryClient } from "@tanstack/react-query";
import type { VaultTask } from "@/api";
import { invalidateFeedQueries } from "@/utils/queryInvalidation";
import {
  invalidateTaskListQueries,
  invalidateVaultTaskListQuery,
  invalidateVaultTaskImpactQueries,
} from "@/utils/taskQueryInvalidation";
import {
  snapshotVaultTaskContactIds,
  type CreateVaultTaskOperation,
  type DeleteVaultTaskOperation,
  type UpdateVaultTaskOperation,
} from "./vaultTaskMutationOperation";

type VaultTaskInvalidationImpact = {
  readonly vaultId: string;
  readonly taskContactIds: readonly string[];
  readonly feedContactIds: readonly string[];
};

function unionContactIds(
  first: readonly string[],
  second: readonly string[],
): readonly string[] {
  return snapshotVaultTaskContactIds([...first, ...second]);
}

function contactIdSetsEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length !== second.length) return false;
  const secondContactIds = new Set(second);
  return first.every((contactId) => secondContactIds.has(contactId));
}

async function invalidateVaultTaskImpact(
  queryClient: QueryClient,
  impact: VaultTaskInvalidationImpact,
): Promise<void> {
  const invalidations = [
    invalidateVaultTaskListQuery(queryClient, impact.vaultId),
    invalidateTaskListQueries(
      queryClient,
      impact.taskContactIds.map((contactId) => ({
        vaultId: impact.vaultId,
        contactId,
      })),
    ),
  ];
  if (impact.feedContactIds.length > 0) {
    invalidations.push(
      invalidateFeedQueries(queryClient, {
        vaultIds: [impact.vaultId],
        contacts: impact.feedContactIds.map((contactId) => ({
          vaultId: impact.vaultId,
          contactId,
        })),
      }),
    );
  }
  await Promise.all(invalidations);
}

export function invalidateCreatedVaultTask(
  queryClient: QueryClient,
  operation: CreateVaultTaskOperation,
): Promise<void> {
  return invalidateVaultTaskImpact(queryClient, {
    vaultId: operation.vaultId,
    taskContactIds: operation.assigneeContactIds,
    feedContactIds: operation.assigneeContactIds,
  });
}

export function invalidateUpdatedVaultTask(
  queryClient: QueryClient,
  operation: UpdateVaultTaskOperation,
  responseTask: VaultTask | undefined,
): Promise<void> {
  const responseAssigneeContactIds = snapshotVaultTaskContactIds(
    (responseTask?.contacts ?? []).map((contact) => contact.id),
  );
  const impactedContactIds = unionContactIds(
    operation.previousAssigneeContactIds,
    responseAssigneeContactIds,
  );
  return invalidateVaultTaskImpact(queryClient, {
    vaultId: operation.vaultId,
    taskContactIds: impactedContactIds,
    feedContactIds: contactIdSetsEqual(
      operation.previousAssigneeContactIds,
      responseAssigneeContactIds,
    )
      ? []
      : impactedContactIds,
  });
}

export function invalidateDeletedVaultTask(
  queryClient: QueryClient,
  operation: DeleteVaultTaskOperation,
): Promise<void> {
  switch (operation.impact.kind) {
    case "exact":
      return invalidateVaultTaskImpact(queryClient, {
        vaultId: operation.vaultId,
        taskContactIds: operation.impact.assigneeContactIds,
        feedContactIds: operation.impact.assigneeContactIds,
      });
    case "fallback":
      return Promise.all([
        invalidateVaultTaskImpactQueries(queryClient, [operation.vaultId]),
        invalidateFeedQueries(queryClient, {
          vaultIds: [operation.vaultId],
          contacts: [],
        }),
      ]).then(() => undefined);
    default: {
      const unreachableImpact: never = operation.impact;
      return unreachableImpact;
    }
  }
}
