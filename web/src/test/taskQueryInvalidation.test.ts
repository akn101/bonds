import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateVaultTaskImpactQueries } from "@/utils/taskQueryInvalidation";

function seedQueries(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): void {
  for (const queryKey of queryKeys) {
    queryClient.setQueryData(queryKey, { value: "cached" });
  }
}

function expectQueriesInvalidated(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): void {
  for (const queryKey of queryKeys) {
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  }
}

function expectQueriesFresh(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): void {
  for (const queryKey of queryKeys) {
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  }
}

describe("invalidateVaultTaskImpactQueries", () => {
  it("invalidates only task projections in the impacted Vault", async () => {
    // Given
    const queryClient = new QueryClient();
    const impactedQueryKeys = [
      ["vaults", "vault-1", "all-tasks"],
      ["vaults", "vault-1", "contacts", "contact-1", "tasks"],
      ["vaults", "vault-1", "contacts", "contact-1", "tasks", { page: 2 }],
      ["vaults", "vault-1", "contacts", "contact-2", "tasks-completed"],
      [
        "vaults",
        "vault-1",
        "contacts",
        "contact-2",
        "tasks-completed",
        "archived",
      ],
    ] as const satisfies readonly QueryKey[];
    const freshQueryKeys = [
      ["vaults", "vault-1", "all-tasks", { page: 2 }],
      ["vaults", "vault-1", "contacts"],
      ["vaults", "vault-1", "contacts", "contact-1"],
      ["vaults", "vault-1", "contacts", "contact-1", "feed"],
      ["vaults", "vault-1", "contacts", "contact-1", "reminders"],
      ["vaults", "vault-1", "contacts", "contact-1", "relationships"],
      ["vaults", "vault-1", "contacts", "contact-1", "labels"],
      ["settings", "preferences"],
      ["vaults", "vault-2", "all-tasks"],
      ["vaults", "vault-2", "contacts", "contact-1", "tasks"],
      [
        "vaults",
        "vault-2",
        "contacts",
        "contact-1",
        "tasks-completed",
        "archived",
      ],
    ] as const satisfies readonly QueryKey[];
    seedQueries(queryClient, [...impactedQueryKeys, ...freshQueryKeys]);

    // When
    await invalidateVaultTaskImpactQueries(queryClient, ["vault-1"]);

    // Then
    expectQueriesInvalidated(queryClient, impactedQueryKeys);
    expectQueriesFresh(queryClient, freshQueryKeys);
  });

  it("deduplicates Vaults and propagates caller filters to every invalidation", async () => {
    // Given
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    // When
    await invalidateVaultTaskImpactQueries(
      queryClient,
      ["vault-1", "vault-1", "vault-2"],
      { refetchType: "none" },
    );

    // Then
    const filters = invalidateQueries.mock.calls.map(([filter]) => filter);
    expect(filters).toHaveLength(3);
    expect(filters.every((filter) => filter?.refetchType === "none")).toBe(
      true,
    );
    expect(filters.filter((filter) => filter?.exact)).toEqual([
      {
        refetchType: "none",
        queryKey: ["vaults", "vault-1", "all-tasks"],
        exact: true,
      },
      {
        refetchType: "none",
        queryKey: ["vaults", "vault-2", "all-tasks"],
        exact: true,
      },
    ]);
    expect(
      filters.filter((filter) => filter?.predicate !== undefined),
    ).toHaveLength(1);
  });
});
