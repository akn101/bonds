import type {
  InvalidateQueryFilters,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

export type TaskMutationSource = {
  readonly vaultId: string;
  readonly contactId: string;
};

export type TaskQueryInvalidationFilters = Omit<
  InvalidateQueryFilters,
  "exact" | "predicate" | "queryKey"
>;

export const vaultTaskListQueryKey = (vaultId: string) =>
  ["vaults", vaultId, "all-tasks"] as const;

export function invalidateVaultTaskListQuery(
  queryClient: QueryClient,
  vaultId: string,
  filters: TaskQueryInvalidationFilters = {},
): Promise<void> {
  return queryClient.invalidateQueries({
    ...filters,
    queryKey: vaultTaskListQueryKey(vaultId),
    exact: true,
  });
}

export function taskListQueryKeys(source: TaskMutationSource): {
  readonly pending: QueryKey;
  readonly completed: QueryKey;
} {
  return {
    pending: ["vaults", source.vaultId, "contacts", source.contactId, "tasks"],
    completed: [
      "vaults",
      source.vaultId,
      "contacts",
      source.contactId,
      "tasks-completed",
    ],
  };
}

export async function invalidateTaskListQueries(
  queryClient: QueryClient,
  sources: readonly TaskMutationSource[],
): Promise<void> {
  const queryKeyPrefixes = new Map<string, QueryKey>();
  for (const source of sources) {
    const queryKeys = taskListQueryKeys(source);
    queryKeyPrefixes.set(JSON.stringify(queryKeys.pending), queryKeys.pending);
    queryKeyPrefixes.set(
      JSON.stringify(queryKeys.completed),
      queryKeys.completed,
    );
  }
  await Promise.all(
    [...queryKeyPrefixes.values()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );
}

export async function invalidateVaultTaskImpactQueries(
  queryClient: QueryClient,
  vaultIds: readonly string[],
  filters: TaskQueryInvalidationFilters = {},
): Promise<void> {
  const impactedVaultIds = new Set(vaultIds);

  // Unknown assignee impact spans every contact task projection, but not unrelated contact data.
  await Promise.all([
    ...[...impactedVaultIds].map((vaultId) =>
      invalidateVaultTaskListQuery(queryClient, vaultId, filters),
    ),
    queryClient.invalidateQueries({
      ...filters,
      predicate: ({ queryKey }) =>
        isImpactedVaultContactTaskQuery(queryKey, impactedVaultIds),
    }),
  ]);
}

function isImpactedVaultContactTaskQuery(
  queryKey: QueryKey,
  impactedVaultIds: ReadonlySet<string>,
): boolean {
  return (
    queryKey.length >= 5 &&
    queryKey[0] === "vaults" &&
    typeof queryKey[1] === "string" &&
    impactedVaultIds.has(queryKey[1]) &&
    queryKey[2] === "contacts" &&
    (queryKey[4] === "tasks" || queryKey[4] === "tasks-completed")
  );
}
