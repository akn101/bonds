import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { VaultTask } from "@/api";
import {
  createDeleteVaultTaskRequest,
  createVaultTaskOperation,
  resolveDeleteVaultTaskOperation,
  updateVaultTaskOperation,
  type VaultTaskRequestValues,
} from "@/pages/vault/vaultTaskMutationOperation";
import {
  invalidateCreatedVaultTask,
  invalidateDeletedVaultTask,
  invalidateUpdatedVaultTask,
} from "@/pages/vault/vaultTaskMutationInvalidation";

function requestValues(
  contactIds: readonly (string | number)[],
): VaultTaskRequestValues {
  return {
    label: "Task",
    description: "Description",
    contactIds,
    parentTaskId: undefined,
    status: "todo",
    dueAt: undefined,
    calendarType: undefined,
    originalDay: undefined,
    originalMonth: undefined,
    originalYear: undefined,
  };
}

function task(
  id: number,
  contactIds: readonly string[],
  parentTaskId?: number,
): VaultTask & { readonly id: number } {
  return {
    id,
    label: `Task ${id}`,
    status: "todo",
    contacts: contactIds.map((contactId) => ({ id: contactId })),
    parent_task_id: parentTaskId,
  };
}

function invalidatedFilters(queryClient: QueryClient) {
  const invalidateQueries = vi.mocked(queryClient.invalidateQueries);
  return invalidateQueries.mock.calls.map(([filters]) => filters);
}

function exactImpactFilters(vaultId: string, contactIds: readonly string[]) {
  return [
    { queryKey: ["vaults", vaultId, "all-tasks"], exact: true },
    ...contactIds.flatMap((contactId) => [
      { queryKey: ["vaults", vaultId, "contacts", contactId, "tasks"] },
      {
        queryKey: ["vaults", vaultId, "contacts", contactId, "tasks-completed"],
      },
    ]),
    { queryKey: ["vaults", vaultId, "feed"] },
    ...contactIds.map((contactId) => ({
      queryKey: ["vaults", vaultId, "contacts", contactId, "feed"],
    })),
  ];
}

describe("vault task mutation invalidation", () => {
  it("uses exact all-tasks while preserving assigned contact task and Feed invalidations after create", async () => {
    // Given
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    const operation = createVaultTaskOperation({
      vaultId: "vault-1",
      values: requestValues(["101", "202"]),
    });

    // When
    await invalidateCreatedVaultTask(queryClient, operation);

    // Then
    expect(invalidatedFilters(queryClient)).toEqual(
      exactImpactFilters("vault-1", ["101", "202"]),
    );
  });

  it("uses exact all-tasks while preserving previous and response contact task and Feed invalidations after update", async () => {
    // Given
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    const operation = updateVaultTaskOperation({
      vaultId: "vault-1",
      task: task(11, ["101"]),
      values: requestValues(["202"]),
    });

    // When
    await invalidateUpdatedVaultTask(queryClient, operation, task(11, ["303"]));

    // Then
    expect(invalidatedFilters(queryClient)).toEqual(
      exactImpactFilters("vault-1", ["101", "303"]),
    );
    expect(invalidatedFilters(queryClient)).not.toContainEqual({
      queryKey: ["vaults", "vault-1", "contacts", "202", "tasks"],
    });
  });

  it("preserves exact all-task, impacted contact task, vault feed, and contact feed invalidations", async () => {
    // Given
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    const request = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(11, ["101"]),
    });
    const operation = resolveDeleteVaultTaskOperation(request, [
      task(12, ["202"], 11),
    ]);

    // When
    await invalidateDeletedVaultTask(queryClient, operation);

    // Then
    expect(invalidatedFilters(queryClient)).toEqual(
      exactImpactFilters("vault-1", ["101", "202"]),
    );
  });

  it("limits fallback to exact all-tasks, task-only predicate, and Vault feed", async () => {
    // Given
    const queryClient = new QueryClient();
    const impactedQueryKeys = [
      ["vaults", "vault-1", "all-tasks"],
      ["vaults", "vault-1", "contacts", "101", "tasks"],
      ["vaults", "vault-1", "contacts", "101", "tasks", { page: 2 }],
      ["vaults", "vault-1", "contacts", "202", "tasks-completed"],
      ["vaults", "vault-1", "feed"],
    ] as const satisfies readonly QueryKey[];
    const freshQueryKeys = [
      ["vaults", "vault-1", "all-tasks", { page: 2 }],
      ["vaults", "vault-1", "contacts"],
      ["vaults", "vault-1", "contacts", "101", "feed"],
      ["vaults", "vault-1", "contacts", "101", "reminders"],
      ["vaults", "vault-2", "all-tasks"],
      ["vaults", "vault-2", "contacts", "101", "tasks"],
      ["vaults", "vault-2", "feed"],
    ] as const satisfies readonly QueryKey[];
    for (const queryKey of [...impactedQueryKeys, ...freshQueryKeys]) {
      queryClient.setQueryData(queryKey, { value: "cached" });
    }
    vi.spyOn(queryClient, "invalidateQueries");
    const request = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(11, ["101"]),
    });
    const operation = resolveDeleteVaultTaskOperation(request, undefined);

    // When
    await invalidateDeletedVaultTask(queryClient, operation);

    // Then
    const filters = invalidatedFilters(queryClient);
    expect(filters).toHaveLength(3);
    expect(filters[0]).toEqual({
      queryKey: ["vaults", "vault-1", "all-tasks"],
      exact: true,
    });
    expect(filters[1]).toEqual({ predicate: expect.any(Function) });
    expect(filters[2]).toEqual({
      queryKey: ["vaults", "vault-1", "feed"],
    });
    for (const queryKey of impactedQueryKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    for (const queryKey of freshQueryKeys) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });
});
