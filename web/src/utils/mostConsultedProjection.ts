import type {
  InvalidateQueryFilters,
  QueryClient,
} from "@tanstack/react-query";

export type MostConsultedQueryKey = readonly [
  "vaults",
  string,
  "mostConsulted",
];

export type MostConsultedProjectionChange = {
  readonly vaultId: string | number;
  readonly evictContactIds?: readonly string[];
};

export type MostConsultedInvalidationFilters = Omit<
  InvalidateQueryFilters,
  "exact" | "predicate" | "queryKey"
>;

export function mostConsultedQueryKey(
  vaultId: string | number,
): MostConsultedQueryKey {
  return ["vaults", String(vaultId), "mostConsulted"];
}

export async function refreshMostConsultedProjections(
  queryClient: QueryClient,
  changes: readonly MostConsultedProjectionChange[],
  filters: MostConsultedInvalidationFilters = {},
): Promise<void> {
  const evictedContactIdsByVault = new Map<string, Set<string>>();

  for (const change of changes) {
    const vaultId = String(change.vaultId);
    const evictedContactIds =
      evictedContactIdsByVault.get(vaultId) ?? new Set<string>();
    for (const contactId of change.evictContactIds ?? []) {
      evictedContactIds.add(contactId);
    }
    evictedContactIdsByVault.set(vaultId, evictedContactIds);
  }

  await Promise.all(
    [...evictedContactIdsByVault].map(([vaultId, evictedContactIds]) => {
      const queryKey = mostConsultedQueryKey(vaultId);
      if (evictedContactIds.size > 0) {
        queryClient.setQueryData(queryKey, (cachedData: unknown) =>
          evictMostConsultedContacts(cachedData, evictedContactIds),
        );
      }
      return queryClient.invalidateQueries({
        ...filters,
        queryKey,
        exact: true,
      });
    }),
  );
}

function evictMostConsultedContacts(
  cachedData: unknown,
  evictedContactIds: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(cachedData)) return cachedData;
  if (
    !cachedData.some((record) => hasEvictedContactId(record, evictedContactIds))
  ) {
    return cachedData;
  }
  return cachedData.filter(
    (record) => !hasEvictedContactId(record, evictedContactIds),
  );
}

function hasEvictedContactId(
  value: unknown,
  evictedContactIds: ReadonlySet<string>,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "contact_id" in value &&
    typeof value.contact_id === "string" &&
    evictedContactIds.has(value.contact_id)
  );
}
