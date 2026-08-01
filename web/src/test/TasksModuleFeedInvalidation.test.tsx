import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryClient } from "@tanstack/react-query";
import {
  invalidatedQueryKeys,
  renderTasksModule,
  sourceTask,
  taskApiMocks,
  taskMessageMocks,
} from "./tasksModuleTestHarness";

const allTasksKey = ["vaults", "101", "all-tasks"] as const;
const routeTaskListKeys = [
  ["vaults", "101", "contacts", "202", "tasks"],
  ["vaults", "101", "contacts", "202", "tasks-completed"],
] as const;
const sharedTaskListKeys = [
  ...routeTaskListKeys,
  ["vaults", "101", "contacts", "303", "tasks"],
  ["vaults", "101", "contacts", "303", "tasks-completed"],
] as const;
const sourceFeedKeys = [
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;
const assigneeFeedKey = ["vaults", "101", "contacts", "303", "feed"] as const;
const routeTaskAndSourceFeedKeys = [
  allTasksKey,
  ...routeTaskListKeys,
  ...sourceFeedKeys,
] as const;
const sharedTaskKeys = [allTasksKey, ...sharedTaskListKeys] as const;
const sharedTaskAndSourceFeedKeys = [
  allTasksKey,
  ...sharedTaskListKeys,
  ...sourceFeedKeys,
] as const;
const sharedTaskAndAssigneeFeedKeys = [
  ...sharedTaskAndSourceFeedKeys,
  assigneeFeedKey,
] as const;

function holdInvalidation(
  queryClient: QueryClient,
  heldQueryKey: readonly string[],
): () => void {
  let releaseInvalidation: () => void = () => undefined;
  const heldPromise = new Promise<void>((resolve) => {
    releaseInvalidation = resolve;
  });
  vi.mocked(queryClient.invalidateQueries).mockImplementation((filters) =>
    JSON.stringify(filters?.queryKey) === JSON.stringify(heldQueryKey)
      ? heldPromise
      : Promise.resolve(),
  );
  return releaseInvalidation;
}

describe("TasksModule Feed invalidation", () => {
  it("invalidates only task lists and the route source Feed after create", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderTasksModule();

    await screen.findByText("No pending tasks");
    await user.click(screen.getByRole("button", { name: /Add$/ }));
    await user.type(screen.getByPlaceholderText("New task…"), "New task");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(invalidatedQueryKeys(queryClient)).toEqual(
        routeTaskAndSourceFeedKeys,
      );
    });
    expect(invalidatedQueryKeys(queryClient)).not.toContainEqual(
      assigneeFeedKey,
    );
    expect(invalidatedQueryKeys(queryClient)).not.toContainEqual([]);
  });

  it("invalidates task lists without Feed after ordinary update", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await screen.findByText("Route contact task");
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invalidatedQueryKeys(queryClient)).toEqual(sharedTaskKeys);
    });
  });

  it("invalidates only task lists and the route source Feed when response completes a task", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksToggleUpdate.mockResolvedValue({
      data: { ...sourceTask, completed: true },
    });
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await user.click(
      await screen.findByRole("checkbox", { name: "Route contact task" }),
    );

    await waitFor(() => {
      expect(invalidatedQueryKeys(queryClient)).toEqual(
        sharedTaskAndSourceFeedKeys,
      );
    });
    expect(invalidatedQueryKeys(queryClient)).not.toContainEqual(
      assigneeFeedKey,
    );
  });

  it("invalidates task lists without Feed when response uncompletes a task", async () => {
    const user = userEvent.setup();
    const completedTask = { ...sourceTask, completed: true };
    taskApiMocks.contactsTasksToggleUpdate.mockResolvedValue({
      data: { ...completedTask, completed: false },
    });
    const { queryClient } = renderTasksModule({
      completedTasks: [completedTask],
    });

    await user.click(screen.getByRole("button", { name: "Show completed" }));
    await user.click(
      await screen.findByRole("checkbox", { name: "Route contact task" }),
    );

    await waitFor(() => {
      expect(invalidatedQueryKeys(queryClient)).toEqual(sharedTaskKeys);
    });
  });

  it("invalidates task lists and every affected assignee Feed after delete", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    const taskRow = (
      await screen.findByText("Route contact task")
    ).closest<HTMLElement>(".ant-list-item");
    if (taskRow === null) {
      throw new Error("expected the task row to be rendered");
    }
    await user.click(within(taskRow).getByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(invalidatedQueryKeys(queryClient)).toEqual(
        sharedTaskAndAssigneeFeedKeys,
      );
    });
    expect(invalidatedQueryKeys(queryClient)).toContainEqual(assigneeFeedKey);
  });

  it.each(routeTaskAndSourceFeedKeys.map((queryKey) => ({ queryKey })))(
    "awaits create invalidation $queryKey before completing success UI",
    async ({ queryKey }) => {
      const user = userEvent.setup();
      const { queryClient } = renderTasksModule();
      const releaseInvalidation = holdInvalidation(queryClient, queryKey);

      await screen.findByText("No pending tasks");
      await user.click(screen.getByRole("button", { name: /Add$/ }));
      await user.type(screen.getByPlaceholderText("New task…"), "New task");
      await user.click(screen.getByRole("button", { name: "Add" }));

      await waitFor(() => {
        expect(invalidatedQueryKeys(queryClient)).toEqual(
          routeTaskAndSourceFeedKeys,
        );
      });
      expect(screen.getByPlaceholderText("New task…")).toBeInTheDocument();
      expect(taskMessageMocks.success).not.toHaveBeenCalled();

      await act(async () => {
        releaseInvalidation();
      });

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText("New task…"),
        ).not.toBeInTheDocument();
      });
      expect(taskMessageMocks.success).toHaveBeenCalledWith("Task added");
    },
  );

  it.each(sharedTaskKeys.map((queryKey) => ({ queryKey })))(
    "awaits shared update invalidation $queryKey before completing success UI",
    async ({ queryKey }) => {
      const user = userEvent.setup();
      const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });
      const releaseInvalidation = holdInvalidation(queryClient, queryKey);

      await screen.findByText("Route contact task");
      await user.click(screen.getByRole("button", { name: "edit" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(invalidatedQueryKeys(queryClient)).toEqual(sharedTaskKeys);
      });
      expect(screen.getByPlaceholderText("New task…")).toBeInTheDocument();
      expect(taskMessageMocks.success).not.toHaveBeenCalled();

      await act(async () => {
        releaseInvalidation();
      });

      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText("New task…"),
        ).not.toBeInTheDocument();
      });
      expect(taskMessageMocks.success).toHaveBeenCalledWith("Task updated");
    },
  );

  it("invalidates nothing when update is rejected", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksUpdate.mockRejectedValue(
      new Error("update rejected"),
    );
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await screen.findByText("Route contact task");
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(taskMessageMocks.error).toHaveBeenCalledWith("update rejected");
    });
    expect(invalidatedQueryKeys(queryClient)).toEqual([]);
  });

  it("invalidates nothing when toggle is rejected", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksToggleUpdate.mockRejectedValue(
      new Error("toggle rejected"),
    );
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await user.click(
      await screen.findByRole("checkbox", { name: "Route contact task" }),
    );

    await waitFor(() => {
      expect(taskMessageMocks.error).toHaveBeenCalledWith("toggle rejected");
    });
    expect(invalidatedQueryKeys(queryClient)).toEqual([]);
  });

  it("invalidates nothing when delete is rejected", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksDelete.mockRejectedValue(
      new Error("delete rejected"),
    );
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    const taskRow = (
      await screen.findByText("Route contact task")
    ).closest<HTMLElement>(".ant-list-item");
    if (taskRow === null) {
      throw new Error("expected the task row to be rendered");
    }
    await user.click(within(taskRow).getByRole("button", { name: "delete" }));
    await user.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(taskMessageMocks.error).toHaveBeenCalledWith("delete rejected");
    });
    expect(invalidatedQueryKeys(queryClient)).toEqual([]);
  });
});
