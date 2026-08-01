import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  mostConsultedQueryKey,
  refreshMostConsultedProjections,
} from "@/utils/mostConsultedProjection";

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function seedQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
  data: unknown = { value: "cached" },
): void {
  queryClient.setQueryData(queryKey, data);
}

describe("mostConsultedQueryKey", () => {
  it("normalizes string and numeric Vault IDs into the exact canonical key", () => {
    // Given / When / Then
    expect(mostConsultedQueryKey("42")).toEqual([
      "vaults",
      "42",
      "mostConsulted",
    ]);
    expect(mostConsultedQueryKey(42)).toEqual([
      "vaults",
      "42",
      "mostConsulted",
    ]);
  });
});

describe("refreshMostConsultedProjections", () => {
  it("deduplicates normalized Vault changes and unions contact evictions", async () => {
    // Given
    const queryClient = new QueryClient({
      defaultOptions: { queries: { structuralSharing: false } },
    });
    const queryKey = mostConsultedQueryKey("42");
    const firstRemaining = { contact_id: "contact-2", number_of_views: 8 };
    const secondRemaining = { contact_id: "contact-4", number_of_views: 3 };
    seedQuery(queryClient, queryKey, [
      { contact_id: "contact-1", number_of_views: 10 },
      firstRemaining,
      { contact_id: "contact-3", number_of_views: 5 },
      secondRemaining,
    ]);
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [
        { vaultId: "42", evictContactIds: ["contact-1"] },
        { vaultId: 42, evictContactIds: ["contact-3", "contact-1"] },
      ],
      { refetchType: "none" },
    );

    // Then
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      refetchType: "none",
      queryKey,
      exact: true,
    });
    const remaining = queryClient.getQueryData<readonly unknown[]>(queryKey);
    expect(remaining).toEqual([firstRemaining, secondRemaining]);
    expect(remaining?.[0]).toBe(firstRemaining);
    expect(remaining?.[1]).toBe(secondRemaining);
  });

  it("keeps caller filters but prevents key and exact overrides", async () => {
    // Given
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const attemptedOverride = {
      queryKey: ["settings", "preferences"],
      exact: false,
      refetchType: "none",
    } as const;

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "vault-1" }],
      attemptedOverride,
    );

    // Then
    expect(invalidateQueries).toHaveBeenCalledWith({
      refetchType: "none",
      queryKey: mostConsultedQueryKey("vault-1"),
      exact: true,
    });
  });

  it("invalidates only the exact canonical query in a real QueryClient", async () => {
    // Given
    const queryClient = new QueryClient();
    const exactKey = mostConsultedQueryKey("vault-1");
    const childKey = [...exactKey, "detail"] as const;
    const otherVaultKey = mostConsultedQueryKey("vault-2");
    const unrelatedKey = ["settings", "preferences"] as const;
    for (const queryKey of [exactKey, childKey, otherVaultKey, unrelatedKey]) {
      seedQuery(queryClient, queryKey);
    }

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "vault-1" }],
      { refetchType: "none" },
    );

    // Then
    expect(queryClient.getQueryState(exactKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(childKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherVaultKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it("evicts matching raw records synchronously without changing remaining records", async () => {
    // Given
    const queryClient = new QueryClient({
      defaultOptions: { queries: { structuralSharing: false } },
    });
    const queryKey = mostConsultedQueryKey("vault-1");
    const firstRemaining = {
      contact_id: "contact-2",
      first_name: "Ada",
      number_of_views: 9,
      custom_field: { preserved: true },
    };
    const secondRemaining = {
      contact_id: "contact-3",
      first_name: "Grace",
      number_of_views: 4,
    };
    seedQuery(queryClient, queryKey, [
      firstRemaining,
      { contact_id: "contact-1", first_name: "Moved", number_of_views: 12 },
      secondRemaining,
    ]);

    // When
    const refresh = refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "vault-1", evictContactIds: ["contact-1"] }],
      { refetchType: "none" },
    );

    // Then
    const remaining = queryClient.getQueryData<readonly unknown[]>(queryKey);
    expect(remaining).toEqual([firstRemaining, secondRemaining]);
    expect(remaining?.[0]).toBe(firstRemaining);
    expect(remaining?.[1]).toBe(secondRemaining);
    await refresh;
  });

  it("preserves the array reference when no contact ID matches", async () => {
    // Given
    const queryClient = new QueryClient({
      defaultOptions: { queries: { structuralSharing: false } },
    });
    const queryKey = mostConsultedQueryKey("vault-1");
    const cachedRecords = [
      { contact_id: "contact-2", number_of_views: 9 },
      { contact_id: "contact-3", number_of_views: 4 },
    ];
    seedQuery(queryClient, queryKey, cachedRecords);
    const cachedReference = queryClient.getQueryData(queryKey);

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "vault-1", evictContactIds: ["absent-contact"] }],
      { refetchType: "none" },
    );

    // Then
    expect(queryClient.getQueryData(queryKey)).toBe(cachedReference);
  });

  it("does not create an absent cache while evicting specified IDs", async () => {
    // Given
    const queryClient = new QueryClient();
    const queryKey = mostConsultedQueryKey("vault-1");
    expect(queryClient.getQueryState(queryKey)).toBeUndefined();

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "vault-1", evictContactIds: ["contact-1"] }],
      { refetchType: "none" },
    );

    // Then
    expect(queryClient.getQueryState(queryKey)).toBeUndefined();
  });

  it("does not insert, reorder, or guess data for a target-only change", async () => {
    // Given
    const queryClient = new QueryClient({
      defaultOptions: { queries: { structuralSharing: false } },
    });
    const queryKey = mostConsultedQueryKey("target-vault");
    const cachedRecords = [
      { contact_id: "contact-9", number_of_views: 2 },
      { contact_id: "contact-7", number_of_views: 11 },
    ];
    seedQuery(queryClient, queryKey, cachedRecords);
    const cachedReference = queryClient.getQueryData(queryKey);

    // When
    await refreshMostConsultedProjections(
      queryClient,
      [{ vaultId: "target-vault" }],
      { refetchType: "none" },
    );

    // Then
    expect(queryClient.getQueryData(queryKey)).toBe(cachedReference);
    expect(queryClient.getQueryData(queryKey)).toEqual(cachedRecords);
  });

  it("waits for every independently held per-Vault invalidation", async () => {
    // Given
    const queryClient = new QueryClient();
    const firstInvalidation = createDeferred<void>();
    const secondInvalidation = createDeferred<void>();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) => {
      return filters?.queryKey?.[1] === "vault-1"
        ? firstInvalidation.promise
        : secondInvalidation.promise;
    });
    let refreshCompleted = false;

    // When
    const refresh = refreshMostConsultedProjections(queryClient, [
      { vaultId: "vault-1" },
      { vaultId: "vault-2" },
    ]).then(() => {
      refreshCompleted = true;
    });
    firstInvalidation.resolve(undefined);
    await firstInvalidation.promise;
    await Promise.resolve();

    // Then
    expect(refreshCompleted).toBe(false);
    secondInvalidation.resolve(undefined);
    await refresh;
    expect(refreshCompleted).toBe(true);
  });
});
