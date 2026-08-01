import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  invalidatedQueryKeys,
  renderTasksModule,
  sourceTask,
  taskApiMocks,
} from "./tasksModuleTestHarness";

function taskListKeysFor(
  ...contactIds: readonly string[]
): readonly (readonly string[])[] {
  return contactIds.flatMap((contactId) => [
    ["vaults", "101", "contacts", contactId, "tasks"],
    ["vaults", "101", "contacts", contactId, "tasks-completed"],
  ]);
}

const routeTaskListKeys = taskListKeysFor("202");
const sharedTaskListKeys = taskListKeysFor("202", "303");
const reassignedTaskListKeys = taskListKeysFor("202", "303", "404");

async function expectTaskListInvalidation(
  queryClient: ReturnType<typeof renderTasksModule>["queryClient"],
  expectedKeys: readonly (readonly string[])[],
): Promise<void> {
  await waitFor(() => {
    const taskListInvalidations = invalidatedQueryKeys(queryClient).filter(
      (queryKey) => {
        const suffix = queryKey.at(-1);
        return suffix === "tasks" || suffix === "tasks-completed";
      },
    );
    expect(taskListInvalidations).toEqual(expectedKeys);
  });
}

describe("TasksModule task list invalidation baseline", () => {
  it("renders shared assignees without duplicating the route contact", async () => {
    renderTasksModule({ pendingTasks: [sourceTask] });

    expect(await screen.findByText("Shared Assignee")).toBeInTheDocument();
    expect(screen.queryByText("Route Contact")).not.toBeInTheDocument();
  });

  it("invalidates pending and completed task lists after create", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderTasksModule();

    await screen.findByText("No pending tasks");
    await user.click(screen.getByRole("button", { name: /Add$/ }));
    await user.type(screen.getByPlaceholderText("New task…"), "New task");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(taskApiMocks.contactsTasksCreate).toHaveBeenCalledWith(
        "101",
        "202",
        { label: "New task", description: "" },
      );
    });
    await expectTaskListInvalidation(queryClient, routeTaskListKeys);
  });

  it("invalidates old and response assignee task lists after update without duplicates", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksUpdate.mockResolvedValue({
      data: {
        ...sourceTask,
        contacts: [
          ...(sourceTask.contacts ?? []),
          { id: "404", name: "New Assignee" },
          { id: "303", name: "Shared Assignee" },
        ],
      },
    });
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await screen.findByText("Route contact task");
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.clear(screen.getByPlaceholderText("New task…"));
    await user.type(screen.getByPlaceholderText("New task…"), "Updated task");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(taskApiMocks.contactsTasksUpdate).toHaveBeenCalledWith(
        "101",
        "202",
        11,
        { label: "Updated task", description: "Task details" },
      );
    });
    await expectTaskListInvalidation(queryClient, reassignedTaskListKeys);
  });

  it("invalidates old and response assignee task lists after toggle without duplicates", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksToggleUpdate.mockResolvedValue({
      data: {
        ...sourceTask,
        completed: true,
        contacts: [
          ...(sourceTask.contacts ?? []),
          { id: "404", name: "New Assignee" },
          { id: "303", name: "Shared Assignee" },
        ],
      },
    });
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await screen.findByText("Route contact task");
    await user.click(
      screen.getByRole("checkbox", { name: "Route contact task" }),
    );

    await waitFor(() => {
      expect(taskApiMocks.contactsTasksToggleUpdate).toHaveBeenCalledWith(
        "101",
        "202",
        11,
      );
    });
    await expectTaskListInvalidation(queryClient, reassignedTaskListKeys);
  });

  it("invalidates only old assignee task lists after delete", async () => {
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
      expect(taskApiMocks.contactsTasksDelete).toHaveBeenCalledWith(
        "101",
        "202",
        11,
      );
    });
    await expectTaskListInvalidation(queryClient, sharedTaskListKeys);
  });

  it("retains old assignee invalidation when an update response omits contacts", async () => {
    const user = userEvent.setup();
    taskApiMocks.contactsTasksUpdate.mockResolvedValue({
      data: {
        id: sourceTask.id,
        label: sourceTask.label,
        description: sourceTask.description,
        completed: sourceTask.completed,
      },
    });
    const { queryClient } = renderTasksModule({ pendingTasks: [sourceTask] });

    await screen.findByText("Route contact task");
    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expectTaskListInvalidation(queryClient, sharedTaskListKeys);
  });
});
