import { act } from "react";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { APIError, VaultTask } from "@/api";
import {
  invalidatedQueryFilters,
  renderTasksModule,
  sourceTask,
  taskApiMocks,
  taskMessageMocks,
  vaultTaskApiMocks,
} from "./tasksModuleTestHarness";

const allTasksQueryKey = ["vaults", "101", "all-tasks"] as const;
const rootTask: VaultTask = { ...sourceTask, status: "todo" };
const childTask: VaultTask = {
  id: 12,
  label: "Child task",
  status: "todo",
  parent_task_id: 11,
  contacts: [{ id: "404", name: "Child Assignee" }],
};
const grandchildTask: VaultTask = {
  id: 13,
  label: "Grandchild task",
  status: "todo",
  parent_task_id: 12,
  contacts: [{ id: "505", name: "Grandchild Assignee" }],
};
const unrelatedTask: VaultTask = {
  id: 14,
  label: "Unrelated task",
  status: "todo",
  contacts: [{ id: "606", name: "Unrelated Assignee" }],
};
const allTasks = [rootTask, childTask, grandchildTask, unrelatedTask] as const;
const impactedContactIds = ["202", "303", "404", "505"] as const;

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
};

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: Deferred<Value>["resolve"] = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function allTasksResponse(tasks: readonly VaultTask[]) {
  return {
    data: [...tasks],
    success: true,
    meta: {
      page: 1,
      per_page: 200,
      total: tasks.length,
      total_pages: 1,
    },
  };
}

function taskListKeys(contactIds: readonly string[]) {
  return contactIds.flatMap((contactId) => [
    ["vaults", "101", "contacts", contactId, "tasks"],
    ["vaults", "101", "contacts", contactId, "tasks-completed"],
  ]);
}

function feedKeys(contactIds: readonly string[]) {
  return [
    ["vaults", "101", "feed"],
    ...contactIds.map((contactId) => [
      "vaults",
      "101",
      "contacts",
      contactId,
      "feed",
    ]),
  ];
}

function expectedCascadeInvalidations() {
  return [
    { queryKey: allTasksQueryKey, exact: true },
    ...taskListKeys(impactedContactIds).map((queryKey) => ({ queryKey })),
    ...feedKeys(impactedContactIds).map((queryKey) => ({ queryKey })),
  ];
}

function seedQueryCache(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
): void {
  for (const queryKey of queryKeys) {
    queryClient.setQueryData(queryKey, { cached: true });
  }
}

function expectQueryInvalidationState(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
  expectedInvalidated: boolean,
): void {
  for (const queryKey of queryKeys) {
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(
      expectedInvalidated,
    );
  }
}

async function confirmRootDelete(): Promise<void> {
  const user = userEvent.setup();
  const taskRow = (
    await screen.findByText("Route contact task")
  ).closest<HTMLElement>(".ant-list-item");
  if (taskRow === null) throw new Error("expected the root task row");
  await user.click(within(taskRow).getByRole("button", { name: "delete" }));
  await user.click(await screen.findByRole("button", { name: "OK" }));
}

async function expectCascadeInvalidations(queryClient: QueryClient) {
  await waitFor(() => {
    expect(invalidatedQueryFilters(queryClient)).toEqual(
      expectedCascadeInvalidations(),
    );
  });
  expect(
    invalidatedQueryFilters(queryClient).some((filters) =>
      filters.queryKey?.includes("606"),
    ),
  ).toBe(false);
  expect(invalidatedQueryFilters(queryClient)).not.toContainEqual({
    queryKey: [],
  });
}

describe("TasksModule parent delete cascade invalidation", () => {
  it("uses fresh cached all-tasks to invalidate the exact descendant impact without refetching", async () => {
    const { queryClient } = renderTasksModule({
      pendingTasks: [sourceTask],
      cachedAllTasks: allTasks,
    });

    await confirmRootDelete();

    await waitFor(() =>
      expect(taskApiMocks.contactsTasksDelete).toHaveBeenCalled(),
    );
    expect(vaultTaskApiMocks.tasksList).not.toHaveBeenCalled();
    await expectCascadeInvalidations(queryClient);
  });

  it("waits for an impact fetch when all-tasks cache is absent before deleting", async () => {
    const impactFetch = createDeferred<ReturnType<typeof allTasksResponse>>();
    vaultTaskApiMocks.tasksList.mockReturnValue(impactFetch.promise);
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await confirmRootDelete();

    await waitFor(() => {
      expect(vaultTaskApiMocks.tasksList).toHaveBeenCalledWith("101", {});
    });
    expect(taskApiMocks.contactsTasksDelete).not.toHaveBeenCalled();
    await act(async () => {
      impactFetch.resolve(allTasksResponse(allTasks));
      await impactFetch.promise;
    });
    await waitFor(() =>
      expect(taskApiMocks.contactsTasksDelete).toHaveBeenCalled(),
    );
    await expectCascadeInvalidations(queryClient);
  });

  it("fetches fresh impact instead of trusting invalidated cached all-tasks", async () => {
    const impactFetch = createDeferred<ReturnType<typeof allTasksResponse>>();
    vaultTaskApiMocks.tasksList.mockReturnValue(impactFetch.promise);
    const { queryClient } = renderTasksModule({
      pendingTasks: [sourceTask],
      cachedAllTasks: [rootTask, unrelatedTask],
      allTasksCacheInvalidated: true,
    });

    await confirmRootDelete();

    await waitFor(() => expect(vaultTaskApiMocks.tasksList).toHaveBeenCalled());
    expect(taskApiMocks.contactsTasksDelete).not.toHaveBeenCalled();
    await act(async () => {
      impactFetch.resolve(allTasksResponse(allTasks));
      await impactFetch.promise;
    });
    await waitFor(() =>
      expect(taskApiMocks.contactsTasksDelete).toHaveBeenCalled(),
    );
    await expectCascadeInvalidations(queryClient);
  });

  it("falls back to exact all-tasks, a task-only predicate, and Vault feed for a plain API error", async () => {
    const impactError = {
      code: "IMPACT_UNAVAILABLE",
      message: "impact rejected",
    } satisfies APIError;
    vaultTaskApiMocks.tasksList.mockRejectedValue(impactError);
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await confirmRootDelete();

    await waitFor(() =>
      expect(taskApiMocks.contactsTasksDelete).toHaveBeenCalled(),
    );
    expect(vaultTaskApiMocks.tasksList).toHaveBeenCalledWith("101", {});
    await waitFor(() => {
      expect(invalidatedQueryFilters(queryClient)).toHaveLength(3);
    });
    const fallbackFilters = invalidatedQueryFilters(queryClient);
    expect(
      fallbackFilters.filter((filters) => filters.predicate === undefined),
    ).toEqual([
      { queryKey: allTasksQueryKey, exact: true },
      { queryKey: ["vaults", "101", "feed"] },
    ]);
    expect(
      fallbackFilters.filter((filters) => filters.predicate !== undefined),
    ).toEqual([{ predicate: expect.any(Function) }]);

    const taskQueryKeys = [
      allTasksQueryKey,
      ["vaults", "101", "contacts", "202", "tasks"],
      ["vaults", "101", "contacts", "303", "tasks-completed", { page: 2 }],
      ["vaults", "101", "feed", { page: 2 }],
    ] as const satisfies readonly QueryKey[];
    const freshQueryKeys = [
      ["vaults", "101", "all-tasks", { page: 2 }],
      ["vaults", "101", "contacts", "202"],
      ["vaults", "101", "contacts", "202", "feed"],
      ["vaults", "101", "contacts", "202", "reminders"],
      ["vaults", "101", "contacts", "202", "relationships"],
      ["vaults", "101", "contacts", null, null, 1, 20],
    ] as const satisfies readonly QueryKey[];
    const predicateProofClient = new QueryClient();
    seedQueryCache(predicateProofClient, [...taskQueryKeys, ...freshQueryKeys]);
    for (const filters of fallbackFilters) {
      await predicateProofClient.invalidateQueries(filters);
    }
    expectQueryInvalidationState(predicateProofClient, taskQueryKeys, true);
    expectQueryInvalidationState(predicateProofClient, freshQueryKeys, false);
  });

  it("retains a TypeError and stops before DELETE or invalidation", async () => {
    const impactError = new TypeError("impact classification failed");
    vaultTaskApiMocks.tasksList.mockRejectedValue(impactError);
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await confirmRootDelete();

    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll().at(-1)?.state.status).toBe(
        "error",
      );
    });
    expect(queryClient.getMutationCache().getAll().at(-1)?.state.error).toBe(
      impactError,
    );
    expect(vaultTaskApiMocks.tasksList).toHaveBeenCalledWith("101", {});
    expect(taskApiMocks.contactsTasksDelete).not.toHaveBeenCalled();
    expect(invalidatedQueryFilters(queryClient)).toEqual([]);
    expect(taskMessageMocks.success).not.toHaveBeenCalled();
  });

  it("does not invalidate or show success when DELETE rejects", async () => {
    taskApiMocks.contactsTasksDelete.mockRejectedValue(
      new Error("delete rejected"),
    );
    const { queryClient } = renderTasksModule({
      pendingTasks: [sourceTask],
      cachedAllTasks: allTasks,
    });

    await confirmRootDelete();

    await waitFor(() => {
      expect(taskMessageMocks.error).toHaveBeenCalledWith("delete rejected");
    });
    expect(invalidatedQueryFilters(queryClient)).toEqual([]);
    expect(taskMessageMocks.success).not.toHaveBeenCalled();
  });
});

describe("TasksModule Vault all-tasks invalidation", () => {
  it.each([
    {
      name: "create",
      pendingTasks: [],
      run: async () => {
        const user = userEvent.setup();
        await screen.findByText("No pending tasks");
        await user.click(screen.getByRole("button", { name: /Add$/ }));
        await user.type(screen.getByPlaceholderText("New task…"), "New task");
        await user.click(screen.getByRole("button", { name: "Add" }));
      },
    },
    {
      name: "update",
      pendingTasks: [sourceTask],
      run: async () => {
        const user = userEvent.setup();
        await screen.findByText("Route contact task");
        await user.click(screen.getByRole("button", { name: "edit" }));
        await user.click(screen.getByRole("button", { name: "Save" }));
      },
    },
    {
      name: "toggle",
      pendingTasks: [sourceTask],
      run: async () => {
        const user = userEvent.setup();
        await user.click(
          await screen.findByRole("checkbox", { name: "Route contact task" }),
        );
      },
    },
    {
      name: "delete",
      pendingTasks: [sourceTask],
      run: confirmRootDelete,
    },
  ])(
    "invalidates exact all-tasks after contact-task $name",
    async ({ pendingTasks, run }) => {
      const { queryClient } = renderTasksModule({
        pendingTasks,
        cachedAllTasks: allTasks,
      });

      await run();

      await waitFor(() => {
        expect(invalidatedQueryFilters(queryClient)).toContainEqual({
          queryKey: allTasksQueryKey,
          exact: true,
        });
      });
    },
  );
});
