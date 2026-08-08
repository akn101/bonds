import { render } from "@testing-library/react";
import { expect } from "vitest";
import {
  QueryClient,
  type InvalidateQueryFilters,
  type QueryKey,
} from "@tanstack/react-query";
import type { VaultTask } from "@/api";
import TasksKanban from "@/pages/vault/TasksKanban";
import { vaultTaskListQueryKey } from "@/utils/taskQueryInvalidation";
import { TasksKanbanTestProviders } from "./tasksKanbanTestProviders";

export const kanbanVaultId = "vault-kanban";

export type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: unknown) => void;
};

export type SeededTaskQueries = {
  readonly impacted: readonly QueryKey[];
  readonly fresh: readonly QueryKey[];
};

export const positionMoveCases = [
  {
    move: "cross-column",
    buttonName: "Move across columns",
    expectedRequest: [kanbanVaultId, 1, { position: 0, status: "done" }],
    expectedCache: [
      { id: 2, status: "todo" },
      { id: 1, status: "done" },
      { id: 3, status: "done" },
      { id: 4, status: "done" },
    ],
  },
  {
    move: "same-column",
    buttonName: "Move within column",
    expectedRequest: [kanbanVaultId, 2, { position: 0, status: "todo" }],
    expectedCache: [
      { id: 3, status: "done" },
      { id: 4, status: "done" },
      { id: 2, status: "todo" },
      { id: 1, status: "todo" },
    ],
  },
] as const;

export function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: Deferred<Value>["resolve"] = () => undefined;
  let rejectPromise: Deferred<Value>["reject"] = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

export function createKanbanQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

export function enableDesktopKanban(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function expectInvalidationState(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
  expected: boolean,
): void {
  for (const queryKey of queryKeys) {
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(expected);
  }
}

export function expectTaskImpactInvalidation(
  queryClient: QueryClient,
  queryKeys: SeededTaskQueries,
  filters: readonly InvalidateQueryFilters[],
): void {
  expect(filters).toHaveLength(2);
  expect(filters.filter((filter) => filter.exact)).toEqual([
    { queryKey: vaultTaskListQueryKey(kanbanVaultId), exact: true },
  ]);
  expect(
    filters.filter((filter) => filter.predicate !== undefined),
  ).toHaveLength(1);
  expectInvalidationState(queryClient, queryKeys.impacted, true);
  expectInvalidationState(queryClient, queryKeys.fresh, false);
}

export function kanbanTasks(): VaultTask[] {
  return [
    { id: 1, label: "First todo", status: "todo", contacts: [] },
    { id: 2, label: "Second todo", status: "todo", contacts: [] },
    { id: 3, label: "First done", status: "done", contacts: [] },
    { id: 4, label: "Second done", status: "done", contacts: [] },
  ];
}

export function seedKanbanTaskQueries(
  queryClient: QueryClient,
  tasks: readonly VaultTask[],
): SeededTaskQueries {
  const impacted = [
    vaultTaskListQueryKey(kanbanVaultId),
    ["vaults", kanbanVaultId, "contacts", "contact-a", "tasks"],
    [
      "vaults",
      kanbanVaultId,
      "contacts",
      "contact-b",
      "tasks-completed",
      { page: 2 },
    ],
  ] as const satisfies readonly QueryKey[];
  const fresh = [
    ["vaults", kanbanVaultId, "all-tasks", { page: 2 }],
    ["vaults", kanbanVaultId, "contacts"],
    ["vaults", kanbanVaultId, "contacts", "contact-a", "feed"],
    ["vaults", kanbanVaultId, "feed"],
    ["vaults", "other-vault", "all-tasks"],
    ["vaults", "other-vault", "contacts", "contact-a", "tasks"],
    ["settings", "preferences"],
  ] as const satisfies readonly QueryKey[];

  queryClient.setQueryData(vaultTaskListQueryKey(kanbanVaultId), [...tasks]);
  for (const queryKey of [...impacted.slice(1), ...fresh]) {
    queryClient.setQueryData(queryKey, { cached: true });
  }
  return { impacted, fresh };
}

export function renderTasksKanban(
  queryClient: QueryClient,
  tasks: VaultTask[],
  vaultId = kanbanVaultId,
) {
  const renderKanban = (currentVaultId: string, currentTasks: VaultTask[]) => (
    <TasksKanbanTestProviders queryClient={queryClient}>
      <TasksKanban vaultId={currentVaultId} tasks={currentTasks} />
    </TasksKanbanTestProviders>
  );
  const rendered = render(renderKanban(vaultId, tasks));
  return {
    ...rendered,
    rerenderTasksKanban: (currentVaultId: string, currentTasks: VaultTask[]) =>
      rendered.rerender(renderKanban(currentVaultId, currentTasks)),
  };
}
