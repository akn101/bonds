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
