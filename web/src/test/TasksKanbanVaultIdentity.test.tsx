import { act, type ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import type { VaultTask } from "@/api";
import { advanceAuthenticationSubjectRevision } from "@/utils/authenticationSubjectRevision";
import { vaultTaskListQueryKey } from "@/utils/taskQueryInvalidation";
import {
  createDeferred,
  createKanbanQueryClient,
  enableDesktopKanban,
  expectTaskImpactInvalidation,
  kanbanTasks,
  kanbanVaultId,
  renderTasksKanban,
  seedKanbanTaskQueries,
} from "@/test/tasksKanbanPositionTestHarness";

const nextVaultId = "vault-after-rerender";

vi.mock("@/api", () => ({
  api: {
    vaultTasks: { tasksPositionPartialUpdate: vi.fn() },
  },
}));

vi.mock("@/pages/vault/TaskEditModal", () => ({ default: () => null }));

vi.mock("@/utils/dateFormat", () => ({
  formatShortDate: () => "",
  useDateFormat: () => ({}),
}));

vi.mock("@/utils/taskStatus", () => ({
  defaultStatusSlug: () => "todo",
  useTaskStatuses: () => ({
    data: [
      {
        id: 1,
        slug: "todo",
        label: "Todo",
        position: 0,
        is_default: true,
        can_be_deleted: false,
      },
      {
        id: 2,
        slug: "done",
        label: "Done",
        position: 1,
        is_default: false,
        can_be_deleted: false,
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  type DndHarnessProps = {
    readonly children: ReactNode;
    readonly onDragEnd?: (event: {
      readonly active: { readonly id: string };
      readonly over: { readonly id: string };
    }) => void;
  };
  const ActualDndContext = actual.DndContext;

  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: DndHarnessProps) => (
      <ActualDndContext>
        <button
          type="button"
          onClick={() =>
            onDragEnd?.({ active: { id: "1" }, over: { id: "3" } })
          }
        >
          Move across columns
        </button>
        <button
          type="button"
          onClick={() =>
            onDragEnd?.({ active: { id: "101" }, over: { id: "103" } })
          }
        >
          Move next Vault across columns
        </button>
        {children}
      </ActualDndContext>
    ),
  };
});

function observePositionMutationSettlement(
  queryClient: ReturnType<typeof createKanbanQueryClient>,
) {
  const settlement = createDeferred<void>();
  const unsubscribe = queryClient.getMutationCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      (event.action.type === "success" || event.action.type === "error")
    ) {
      settlement.resolve(undefined);
    }
  });
  return { settlement, unsubscribe };
}

describe("TasksKanban submitted Vault identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableDesktopKanban();
  });

  it("routes the API request through the submitted Vault after rerender during cancellation", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const cancellation = createDeferred<void>();
    const realCancelQueries = queryClient.cancelQueries.bind(queryClient);
    vi.spyOn(queryClient, "cancelQueries").mockImplementation(
      async (filters, options) => {
        await realCancelQueries(filters, options);
        await cancellation.promise;
      },
    );
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockResolvedValue({
      success: true,
      data: tasks[0],
    });
    const rendered = renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    rendered.rerenderTasksKanban(nextVaultId, tasks);
    await act(async () => {
      cancellation.resolve(undefined);
      await cancellation.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledWith(
      kanbanVaultId,
      1,
      { position: 0, status: "done" },
    );
  });

  it("invalidates only the submitted Vault after success resolves following rerender", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    const queryKeys = seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockReturnValue(
      request.promise,
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const rendered = renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        1,
      ),
    );
    rendered.rerenderTasksKanban(nextVaultId, tasks);
    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await request.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    const filters = invalidateQueries.mock.calls.flatMap(([filter]) =>
      filter === undefined ? [] : [filter],
    );
    expectTaskImpactInvalidation(queryClient, queryKeys, filters);
  });

  it("rolls back only the submitted Vault without invalidation after rejection following rerender", async () => {
    const tasks = kanbanTasks();
    const nextVaultTasks: VaultTask[] = [
      { id: 101, label: "Next Vault task", status: "todo", contacts: [] },
    ];
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    queryClient.setQueryData(
      vaultTaskListQueryKey(nextVaultId),
      nextVaultTasks,
    );
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockReturnValue(
      request.promise,
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const rendered = renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        1,
      ),
    );
    rendered.rerenderTasksKanban(nextVaultId, nextVaultTasks);
    await act(async () => {
      request.reject(new Error("position rejected"));
      await request.promise.catch(() => undefined);
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(
      queryClient.getQueryData(vaultTaskListQueryKey(kanbanVaultId)),
    ).toEqual(tasks);
    expect(
      queryClient.getQueryData(vaultTaskListQueryKey(nextVaultId)),
    ).toEqual(nextVaultTasks);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not restore an old-subject Vault query when a rejected move settles after the authentication boundary", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    const requestStarted = createDeferred<void>();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockImplementation(
      () => {
        requestStarted.resolve(undefined);
        return request.promise;
      },
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { settlement, unsubscribe } =
      observePositionMutationSettlement(queryClient);
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      screen.getByRole("button", { name: "Move across columns" }),
    );
    await act(async () => {
      await requestStarted.promise;
    });
    expect(
      queryClient
        .getQueryData<VaultTask[]>(vaultTaskListQueryKey(kanbanVaultId))
        ?.map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: 2, status: "todo" },
      { id: 1, status: "done" },
      { id: 3, status: "done" },
      { id: 4, status: "done" },
    ]);

    act(() => {
      advanceAuthenticationSubjectRevision();
      queryClient.clear();
    });
    expect(
      queryClient.getQueryState(vaultTaskListQueryKey(kanbanVaultId)),
    ).toBeUndefined();

    await act(async () => {
      request.reject(new Error("position rejected"));
      await settlement.promise;
    });
    unsubscribe();

    expect(
      queryClient.getQueryState(vaultTaskListQueryKey(kanbanVaultId)),
    ).toBeUndefined();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not invalidate old-subject queries when a successful move settles after the authentication boundary", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    const requestStarted = createDeferred<void>();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockImplementation(
      () => {
        requestStarted.resolve(undefined);
        return request.promise;
      },
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const { settlement, unsubscribe } =
      observePositionMutationSettlement(queryClient);
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      screen.getByRole("button", { name: "Move across columns" }),
    );
    await act(async () => {
      await requestStarted.promise;
    });
    expect(
      queryClient
        .getQueryData<VaultTask[]>(vaultTaskListQueryKey(kanbanVaultId))
        ?.map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: 2, status: "todo" },
      { id: 1, status: "done" },
      { id: 3, status: "done" },
      { id: 4, status: "done" },
    ]);

    act(() => {
      advanceAuthenticationSubjectRevision();
      queryClient.clear();
    });
    expect(
      queryClient.getQueryState(vaultTaskListQueryKey(kanbanVaultId)),
    ).toBeUndefined();

    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await settlement.promise;
    });
    unsubscribe();

    expect(
      queryClient.getQueryState(vaultTaskListQueryKey(kanbanVaultId)),
    ).toBeUndefined();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("cancels a position request when authentication changes during cancellation and releases the move guard", async () => {
    const tasks = kanbanTasks();
    const nextSubjectTasks: VaultTask[] = [
      {
        id: 1,
        label: "Next subject todo",
        status: "todo",
        contacts: [],
      },
      {
        id: 3,
        label: "Next subject done",
        status: "done",
        contacts: [],
      },
    ];
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const cancellationStarted = createDeferred<void>();
    const cancellation = createDeferred<void>();
    const realCancelQueries = queryClient.cancelQueries.bind(queryClient);
    vi.spyOn(queryClient, "cancelQueries").mockImplementation(
      async (filters, options) => {
        await realCancelQueries(filters, options);
        cancellationStarted.resolve(undefined);
        await cancellation.promise;
      },
    );
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockResolvedValue({
      success: true,
      data: tasks[0],
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    const { settlement, unsubscribe } =
      observePositionMutationSettlement(queryClient);
    const rendered = renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      screen.getByRole("button", { name: "Move across columns" }),
    );
    await act(async () => {
      await cancellationStarted.promise;
    });
    act(() => {
      advanceAuthenticationSubjectRevision();
      queryClient.clear();
      queryClient.setQueryData(
        vaultTaskListQueryKey(kanbanVaultId),
        nextSubjectTasks,
      );
    });
    const cacheWritesBeforeSettlement = setQueryData.mock.calls.length;

    await act(async () => {
      cancellation.resolve(undefined);
      await settlement.promise;
    });
    unsubscribe();

    expect(
      queryClient.getQueryData(vaultTaskListQueryKey(kanbanVaultId)),
    ).toEqual(nextSubjectTasks);
    expect(api.vaultTasks.tasksPositionPartialUpdate).not.toHaveBeenCalled();
    expect(setQueryData).toHaveBeenCalledTimes(cacheWritesBeforeSettlement);
    expect(invalidateQueries).not.toHaveBeenCalled();

    rendered.rerenderTasksKanban(kanbanVaultId, nextSubjectTasks);
    fireEvent.click(
      screen.getByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledWith(
        kanbanVaultId,
        1,
        { position: 0, status: "done" },
      ),
    );
  });

  it("holds the mounted lock across a Vault rerender and then submits the new Vault move", async () => {
    const tasks = kanbanTasks();
    const nextVaultTasks: VaultTask[] = [
      { id: 101, label: "Next Vault todo", status: "todo", contacts: [] },
      {
        id: 102,
        label: "Next Vault second todo",
        status: "todo",
        contacts: [],
      },
      { id: 103, label: "Next Vault done", status: "done", contacts: [] },
    ];
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    queryClient.setQueryData(
      vaultTaskListQueryKey(nextVaultId),
      nextVaultTasks,
    );
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    const nextRequest =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate)
      .mockReturnValueOnce(request.promise)
      .mockReturnValueOnce(nextRequest.promise);
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    const rendered = renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        1,
      ),
    );
    rendered.rerenderTasksKanban(nextVaultId, nextVaultTasks);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move next Vault across columns",
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(1);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(setQueryData).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(vaultTaskListQueryKey(nextVaultId)),
    ).toEqual(nextVaultTasks);

    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await request.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Move next Vault across columns",
      }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenLastCalledWith(
      nextVaultId,
      101,
      { position: 0, status: "done" },
    );
    expect(
      queryClient
        .getQueryData<VaultTask[]>(vaultTaskListQueryKey(nextVaultId))
        ?.map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: 102, status: "todo" },
      { id: 101, status: "done" },
      { id: 103, status: "done" },
    ]);
    await act(async () => {
      nextRequest.resolve({ success: true, data: nextVaultTasks[0] });
      await nextRequest.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  });
});
