import type { QueryClient } from "@tanstack/react-query";
import type { ContactQueryScope } from "@/utils/queryInvalidation";

export type NetworkGraphQueryKey = readonly [
  "vaults",
  string,
  "contacts",
  string,
  "graph",
];

export type NetworkGraphChangedEdge = {
  readonly sourceContactId: string;
  readonly targetContactId: string;
};

export function networkGraphQueryKey({
  vaultId,
  contactId,
}: ContactQueryScope): NetworkGraphQueryKey {
  return ["vaults", vaultId, "contacts", contactId, "graph"];
}

/** Facet selections, keyed by facet: {label: ["3"], group: ["12", "14"]}. */
export type VaultGraphFilters = Readonly<Record<string, readonly string[]>>;

// One canonical string for a set of selections, so the same filter chosen in a
// different order is the same query. Both the cache key and the request are
// built from it, which is what stops the page and the canvas from disagreeing
// about which graph they are looking at.
function canonicalVaultGraphFilters(filters: VaultGraphFilters): string {
  return Object.entries(filters)
    .map(
      ([key, values]) =>
        [key, [...values].filter(Boolean).sort()] as [string, string[]],
    )
    .filter(([, values]) => values.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, values]) =>
        `${key}=${values.map((value) => encodeURIComponent(value)).join(",")}`,
    )
    .join("&");
}

export type VaultGraphQueryKey = readonly [
  "vaults",
  string,
  "graph",
  number,
  string,
];

// The vault graph is keyed separately from the per-contact graphs so that the
// page and the canvas share one fetch, and so contact-level invalidation does
// not have to know about it. The limit and the filter are part of the key
// because changing either asks the server for a different graph, not a
// different rendering of this one.
export function vaultGraphQueryKey(
  vaultId: string,
  limit = 0,
  filters: VaultGraphFilters = {},
): VaultGraphQueryKey {
  return [
    "vaults",
    vaultId,
    "graph",
    limit,
    canonicalVaultGraphFilters(filters),
  ];
}

export function vaultGraphURL(
  vaultId: string,
  limit = 0,
  filters: VaultGraphFilters = {},
): string {
  const path = `/vaults/${vaultId}/relationships/graph`;
  const query = [
    ...(limit > 0 ? [`limit=${limit}`] : []),
    ...(canonicalVaultGraphFilters(filters)
      ? [canonicalVaultGraphFilters(filters)]
      : []),
  ];
  return query.length > 0 ? `${path}?${query.join("&")}` : path;
}

export function exactNetworkGraphInvalidationFilter(
  queryKey: NetworkGraphQueryKey,
) {
  return { queryKey, exact: true } as const;
}

function isNetworkGraphQueryKey(
  queryKey: readonly unknown[],
): queryKey is NetworkGraphQueryKey {
  return (
    queryKey.length === 5 &&
    queryKey[0] === "vaults" &&
    typeof queryKey[1] === "string" &&
    queryKey[2] === "contacts" &&
    typeof queryKey[3] === "string" &&
    queryKey[4] === "graph"
  );
}

function graphContainsChangedEdge(
  data: unknown,
  edge: NetworkGraphChangedEdge,
): boolean {
  if (
    typeof data !== "object" ||
    data === null ||
    !("nodes" in data) ||
    !Array.isArray(data.nodes)
  ) {
    return false;
  }

  let containsSource = false;
  let containsTarget = false;
  for (const node of data.nodes) {
    if (typeof node !== "object" || node === null || !("id" in node)) continue;
    if (node.id === edge.sourceContactId) containsSource = true;
    if (node.id === edge.targetContactId) containsTarget = true;
  }
  return containsSource && containsTarget;
}

export function affectedNetworkGraphQueryKeys(
  queryClient: QueryClient,
  directScopes: readonly ContactQueryScope[],
  changedEdges: readonly NetworkGraphChangedEdge[],
): readonly NetworkGraphQueryKey[] {
  const affectedKeys = new Map<string, NetworkGraphQueryKey>();
  for (const scope of directScopes) {
    const queryKey = networkGraphQueryKey(scope);
    affectedKeys.set(`${scope.vaultId}\u0000${scope.contactId}`, queryKey);
  }

  if (changedEdges.length === 0) return [...affectedKeys.values()];

  const cachedGraphQueries = queryClient.getQueryCache().findAll({
    predicate: (query) => isNetworkGraphQueryKey(query.queryKey),
  });
  for (const query of cachedGraphQueries) {
    if (!isNetworkGraphQueryKey(query.queryKey)) continue;
    if (
      changedEdges.some((edge) =>
        graphContainsChangedEdge(query.state.data, edge),
      )
    ) {
      affectedKeys.set(
        `${query.queryKey[1]}\u0000${query.queryKey[3]}`,
        query.queryKey,
      );
    }
  }
  return [...affectedKeys.values()];
}
