import { act, type ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api";
import { vaultTaskListQueryKey } from "@/utils/taskQueryInvalidation";
import {
  createDeferred,
  createKanbanQueryClient,
  enableDesktopKanban,
  expectTaskImpactInvalidation,
  kanbanTasks,
  kanbanVaultId,
  positionMoveCases,
  renderTasksKanban,
  seedKanbanTaskQueries,
} from "@/test/tasksKanbanPositionTestHarness";

vi.mock("@/api", () => ({
  api: {
    vaultTasks: { tasksPositionPartialUpdate: vi.fn() },
  },
}));

vi.mock("@/pages/vault/TaskEditModal", () => ({
  default: ({
    open,
    task,
  }: {
    readonly open: boolean;
    readonly task: { readonly label?: string } | null;
  }) => (open ? <div role="dialog">{task?.label}</div> : null),
}));

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
  type DragInput = {
    readonly active: { readonly id: string };
    readonly over: { readonly id: string };
  };
  type DndHarnessProps = {
    readonly children: ReactNode;
    readonly onDragEnd?: (event: DragInput) => void;
  };
  const ActualDndContext = actual.DndContext;

  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: DndHarnessProps) => {
      const moveAcrossColumns = () =>
        onDragEnd?.({ active: { id: "1" }, over: { id: "3" } });
      const moveWithinColumn = () =>
        onDragEnd?.({ active: { id: "2" }, over: { id: "1" } });

      return (
        <ActualDndContext>
          <button type="button" onClick={moveAcrossColumns}>
            Move across columns
          </button>
          <button type="button" onClick={moveWithinColumn}>
            Move within column
          </button>
          <button
            type="button"
            onClick={() => {
              moveAcrossColumns();
              moveWithinColumn();
            }}
          >
            Move twice before rerender
          </button>
          {children}
        </ActualDndContext>
      );
    },
  };
});

describe("TasksKanban position mutation invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableDesktopKanban();
  });

  it.each(positionMoveCases)(
    "optimistically reorders and invalidates only Vault task projections for a $move move",
    async ({ buttonName, expectedRequest, expectedCache }) => {
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
      const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
      renderTasksKanban(queryClient, tasks);

      fireEvent.click(await screen.findByRole("button", { name: buttonName }));
      await waitFor(() =>
        expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
          1,
        ),
      );
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledWith(
        ...expectedRequest,
      );
      expect(cancelQueries.mock.calls).toEqual([
        [{ queryKey: vaultTaskListQueryKey(kanbanVaultId) }],
      ]);
      expect(
        queryClient
          .getQueryData<typeof tasks>(vaultTaskListQueryKey(kanbanVaultId))
          ?.map(({ id, status }) => ({ id, status })),
      ).toEqual(expectedCache);

      await act(async () => {
        request.resolve({ success: true, data: tasks[0] });
        await request.promise;
      });
      await waitFor(() => expect(queryClient.isMutating()).toBe(0));

      const filters = invalidateQueries.mock.calls.flatMap(([filter]) =>
        filter === undefined ? [] : [filter],
      );
      expectTaskImpactInvalidation(queryClient, queryKeys, filters);
    },
  );

  it("accepts only the first valid move before pending state can rerender", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockReturnValue(
      request.promise,
    );
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Move twice before rerender",
      }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalled(),
    );
    const pendingContract = {
      apiCalls: vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mock.calls
        .length,
      cancellations: cancelQueries.mock.calls.length,
      optimisticWrites: setQueryData.mock.calls.length,
      mutations: queryClient.isMutating(),
      cache: queryClient
        .getQueryData<typeof tasks>(vaultTaskListQueryKey(kanbanVaultId))
        ?.map(({ id, status }) => ({ id, status })),
    };

    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await request.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    expect(pendingContract).toEqual({
      apiCalls: 1,
      cancellations: 1,
      optimisticWrites: 1,
      mutations: 1,
      cache: positionMoveCases[0].expectedCache,
    });
  });

  it("keeps task editing enabled while position dragging is pending", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate).mockReturnValue(
      request.promise,
    );
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));

    const taskCard = screen.getByText("First todo").closest('[role="button"]');
    if (!(taskCard instanceof HTMLElement)) {
      throw new Error("First todo task card was not available");
    }
    expect(taskCard).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(taskCard);
    expect(screen.getByRole("dialog")).toHaveTextContent("First todo");

    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await request.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  });

  it("ignores moves through success invalidation and accepts the next move after settling", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
    const request =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    const nextRequest =
      createDeferred<
        Awaited<ReturnType<typeof api.vaultTasks.tasksPositionPartialUpdate>>
      >();
    const predicateInvalidation = createDeferred<void>();
    vi.mocked(api.vaultTasks.tasksPositionPartialUpdate)
      .mockReturnValueOnce(request.promise)
      .mockReturnValueOnce(nextRequest.promise);
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    const setQueryData = vi.spyOn(queryClient, "setQueryData");
    const realInvalidateQueries =
      queryClient.invalidateQueries.bind(queryClient);
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(async (filters = {}, options) => {
        await realInvalidateQueries(filters, options);
        if (filters.predicate !== undefined) {
          await predicateInvalidation.promise;
        }
      });
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalled(),
    );
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ success: true, data: tasks[0] });
      await request.promise;
    });
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());

    expect(queryClient.isMutating()).toBe(1);
    expect(
      invalidateQueries.mock.calls.filter(
        ([filters]) => filters?.predicate !== undefined,
      ),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Move within column" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(1);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(setQueryData).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getQueryData<typeof tasks>(vaultTaskListQueryKey(kanbanVaultId))
        ?.map(({ id, status }) => ({ id, status })),
    ).toEqual(positionMoveCases[0].expectedCache);

    await act(async () => {
      predicateInvalidation.resolve(undefined);
      await predicateInvalidation.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));

    fireEvent.click(screen.getByRole("button", { name: "Move within column" }));
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenLastCalledWith(
      kanbanVaultId,
      2,
      { position: 0, status: "todo" },
    );
    await act(async () => {
      nextRequest.resolve({ success: true, data: tasks[1] });
      await nextRequest.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  });

  it("rolls back a rejected move once and accepts the next move after settling", async () => {
    const tasks = kanbanTasks();
    const queryClient = createKanbanQueryClient();
    seedKanbanTaskQueries(queryClient, tasks);
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
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    renderTasksKanban(queryClient, tasks);

    fireEvent.click(
      await screen.findByRole("button", { name: "Move across columns" }),
    );
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalled(),
    );
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Move within column" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(1);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(setQueryData).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.reject(new Error("position rejected"));
      await request.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData(vaultTaskListQueryKey(kanbanVaultId)),
      ).toEqual(tasks),
    );
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(
      queryClient.getQueryData(vaultTaskListQueryKey(kanbanVaultId)),
    ).toEqual(tasks);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(setQueryData).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Move within column" }));
    await waitFor(() =>
      expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(api.vaultTasks.tasksPositionPartialUpdate).toHaveBeenLastCalledWith(
      kanbanVaultId,
      2,
      { position: 0, status: "todo" },
    );
    await act(async () => {
      nextRequest.resolve({ success: true, data: tasks[1] });
      await nextRequest.promise;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  });
});
