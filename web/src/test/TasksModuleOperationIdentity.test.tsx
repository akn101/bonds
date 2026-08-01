import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import type { Task } from "@/api";
import type { TaskSaveValues } from "@/pages/contact/modules/taskMutationOperation";
import {
  invalidatedQueryKeys,
  renderTasksModule,
  sourceTask,
  taskApiMocks,
  taskMessageMocks,
} from "./tasksModuleTestHarness";

type TaskEditorTestProps = {
  readonly mode: "create" | "update";
  readonly values: TaskSaveValues;
  readonly pending: boolean;
  readonly onChange: (values: TaskSaveValues) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
};

type TaskListItemTestProps = {
  readonly task: Task;
  readonly onEdit: (task: Task) => void;
  readonly onToggle: (task: Task) => void;
  readonly onDelete: (task: Task) => void;
};

vi.mock("@/pages/contact/modules/TaskEditor", () => ({
  default: ({
    mode,
    values,
    pending,
    onChange,
    onSubmit,
    onCancel,
  }: TaskEditorTestProps) => (
    <form
      aria-label={`${mode} task editor`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        name="label"
        value={values.label}
        onChange={(event) => onChange({ ...values, label: event.target.value })}
      />
      <textarea
        name="description"
        value={values.description}
        onChange={(event) =>
          onChange({ ...values, description: event.target.value })
        }
      />
      <button type="submit" disabled={pending}>
        {mode === "create" ? "Add" : "Save"}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  ),
}));

vi.mock("@/pages/contact/modules/TaskListItem", () => ({
  default: ({ task, onEdit, onToggle, onDelete }: TaskListItemTestProps) => (
    <article data-task-id={task.id}>
      <span>{task.label}</span>
      <button type="button" aria-label="edit" onClick={() => onEdit(task)} />
      <button
        type="button"
        aria-label="delete"
        onClick={() => onDelete(task)}
      />
      <input
        type="checkbox"
        aria-label={task.label}
        checked={task.completed}
        onChange={() => onToggle(task)}
      />
    </article>
  ),
}));

const originalAllTasksKey = ["vaults", "101", "all-tasks"] as const;
const originalRouteTaskKeys = [
  ["vaults", "101", "contacts", "202", "tasks"],
  ["vaults", "101", "contacts", "202", "tasks-completed"],
] as const;
const originalSharedTaskKeys = [
  originalAllTasksKey,
  ...originalRouteTaskKeys,
  ["vaults", "101", "contacts", "303", "tasks"],
  ["vaults", "101", "contacts", "303", "tasks-completed"],
] as const;
const originalRouteTaskAndFeedKeys = [
  originalAllTasksKey,
  ...originalRouteTaskKeys,
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;
const originalSharedTaskAndSourceFeedKeys = [
  ...originalSharedTaskKeys,
  ["vaults", "101", "feed"],
  ["vaults", "101", "contacts", "202", "feed"],
] as const;
const originalSharedTaskAndAssigneeFeedKeys = [
  ...originalSharedTaskAndSourceFeedKeys,
  ["vaults", "101", "contacts", "303", "feed"],
] as const;
const sharedTaskWithDuplicateAssignees = {
  ...sourceTask,
  contacts: [
    { id: "303", name: "Shared Assignee" },
    { id: "202", name: "Route Contact" },
    { id: "303", name: "Shared Assignee" },
  ],
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });
  return { promise, resolve: resolveDeferred };
}

type RenderTasksModuleOptions = NonNullable<
  Parameters<typeof renderTasksModule>[0]
>;

function renderWithPendingTasks(
  options: RenderTasksModuleOptions,
): ReturnType<typeof renderTasksModule> {
  return renderTasksModule({ ...options, preloadTaskLists: true });
}

function getTaskEditor(mode: "create" | "update"): HTMLFormElement {
  const editor = document.querySelector<HTMLFormElement>(
    `form[aria-label="${mode} task editor"]`,
  );
  if (editor === null) throw new Error(`expected ${mode} task editor`);
  return editor;
}

function getEditorLabel(editor: HTMLFormElement): HTMLInputElement {
  const label = editor.elements.namedItem("label");
  if (!(label instanceof HTMLInputElement)) {
    throw new Error("expected task label input");
  }
  return label;
}

function getEditorCancelButton(editor: HTMLFormElement): HTMLButtonElement {
  const button = editor.querySelector<HTMLButtonElement>(
    'button[type="button"]',
  );
  if (button === null) throw new Error("expected task editor cancel button");
  return button;
}

function getTaskRow(): HTMLElement {
  const row = document.querySelector<HTMLElement>('article[data-task-id="11"]');
  if (row === null) throw new Error("expected the task row to be rendered");
  return row;
}

function getTaskActionButton(action: "edit" | "delete"): HTMLButtonElement {
  const button = getTaskRow().querySelector<HTMLButtonElement>(
    `button[aria-label="${action}"]`,
  );
  if (button === null) throw new Error(`expected task ${action} button`);
  return button;
}

function getTaskToggle(): HTMLInputElement {
  const toggle = getTaskRow().querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (toggle === null) throw new Error("expected task completion toggle");
  return toggle;
}

function getButtonContaining(text: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((candidate) => candidate.textContent?.trim() === text);
  if (button === undefined) throw new Error(`expected ${text} button`);
  return button;
}

function expectLatestMutationSnapshotFrozen(
  queryClient: ReturnType<typeof renderTasksModule>["queryClient"],
  nestedProperties: readonly string[],
): void {
  const operation = queryClient.getMutationCache().getAll().at(-1)
    ?.state.variables;
  expect(Object.isFrozen(operation)).toBe(true);
  if (operation === null || typeof operation !== "object") {
    throw new Error("expected mutation variables to be an object");
  }
  for (const propertyName of nestedProperties) {
    const descriptor = Object.getOwnPropertyDescriptor(operation, propertyName);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`expected mutation property ${propertyName}`);
    }
    expect(Object.isFrozen(descriptor.value)).toBe(true);
  }
}

describe("TasksModule immutable mutation identity", () => {
  it("keeps pending create kind, values, and source stable across rerenders", async () => {
    const createStarted = createDeferred<void>();
    const createCompletion = createDeferred<{ data: typeof sourceTask }>();
    const createSucceeded = createDeferred<void>();
    taskApiMocks.contactsTasksCreate.mockImplementation(() => {
      createStarted.resolve(undefined);
      return createCompletion.promise;
    });
    taskMessageMocks.success.mockImplementation(() => {
      createSucceeded.resolve(undefined);
    });
    const { queryClient, rerenderModule } = renderWithPendingTasks({
      pendingTasks: [sourceTask],
    });

    fireEvent.click(getButtonContaining("Add"));
    const createEditor = getTaskEditor("create");
    fireEvent.change(getEditorLabel(createEditor), {
      target: { value: "Created first" },
    });
    fireEvent.submit(createEditor);
    await act(async () => {
      await createStarted.promise;
    });

    fireEvent.click(getEditorCancelButton(createEditor));
    fireEvent.click(getTaskActionButton("edit"));

    expect(getEditorLabel(getTaskEditor("update"))).toHaveValue(
      "Route contact task",
    );
    rerenderModule("404", "505");
    rerenderModule("606", "707");

    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "create",
      source: { vaultId: "101", contactId: "202" },
      values: { label: "Created first", description: "" },
    });

    await act(async () => {
      createCompletion.resolve({ data: { ...sourceTask, id: 12 } });
      await createSucceeded.promise;
    });

    expect(invalidatedQueryKeys(queryClient)).toEqual(
      originalRouteTaskAndFeedKeys,
    );
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "create",
      source: { vaultId: "101", contactId: "202" },
      values: { label: "Created first", description: "" },
    });
    expectLatestMutationSnapshotFrozen(queryClient, ["source", "values"]);
    expect(taskMessageMocks.success).toHaveBeenCalledWith("Task added");
  });

  it("keeps pending update kind, id, values, and source stable after cancellation", async () => {
    const updateStarted = createDeferred<void>();
    const updateCompletion = createDeferred<{ data: typeof sourceTask }>();
    const updateSucceeded = createDeferred<void>();
    taskApiMocks.contactsTasksUpdate.mockImplementation(() => {
      updateStarted.resolve(undefined);
      return updateCompletion.promise;
    });
    taskMessageMocks.success.mockImplementation(() => {
      updateSucceeded.resolve(undefined);
    });
    const { queryClient, rerenderModule } = renderWithPendingTasks({
      pendingTasks: [sharedTaskWithDuplicateAssignees],
    });

    fireEvent.click(getTaskActionButton("edit"));
    const updateEditor = getTaskEditor("update");
    fireEvent.change(getEditorLabel(updateEditor), {
      target: { value: "Updated first" },
    });
    fireEvent.submit(updateEditor);
    await act(async () => {
      await updateStarted.promise;
    });
    fireEvent.click(getEditorCancelButton(updateEditor));
    rerenderModule("404", "505");

    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "update",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      values: { label: "Updated first", description: "Task details" },
    });

    await act(async () => {
      updateCompletion.resolve({ data: sourceTask });
      await updateSucceeded.promise;
    });

    expect(invalidatedQueryKeys(queryClient)).toEqual(originalSharedTaskKeys);
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "update",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      values: { label: "Updated first", description: "Task details" },
    });
    expectLatestMutationSnapshotFrozen(queryClient, [
      "source",
      "previousAssigneeContactIds",
      "values",
    ]);
    expect(taskMessageMocks.success).toHaveBeenCalledWith("Task updated");
  });

  it("freezes delete source before the 204 response", async () => {
    const deleteStarted = createDeferred<void>();
    const deleteCompletion = createDeferred<void>();
    const deleteSucceeded = createDeferred<void>();
    taskApiMocks.contactsTasksDelete.mockImplementation(() => {
      deleteStarted.resolve(undefined);
      return deleteCompletion.promise;
    });
    taskMessageMocks.success.mockImplementation(() => {
      deleteSucceeded.resolve(undefined);
    });
    const { queryClient, rerenderModule } = renderWithPendingTasks({
      pendingTasks: [sharedTaskWithDuplicateAssignees],
    });

    fireEvent.click(getTaskActionButton("delete"));
    await act(async () => {
      await deleteStarted.promise;
    });

    rerenderModule("404", "505");
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "delete",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      impact: {
        kind: "exact",
        assigneeContactIds: ["202", "303"],
      },
    });
    await act(async () => {
      deleteCompletion.resolve(undefined);
      await deleteSucceeded.promise;
    });

    expect(invalidatedQueryKeys(queryClient)).toEqual(
      originalSharedTaskAndAssigneeFeedKeys,
    );
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "delete",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      impact: {
        kind: "exact",
        assigneeContactIds: ["202", "303"],
      },
    });
    expectLatestMutationSnapshotFrozen(queryClient, [
      "source",
      "previousAssigneeContactIds",
      "impact",
    ]);
    expect(taskMessageMocks.success).toHaveBeenCalledWith("Task deleted");
  });

  it("freezes toggle source, task id, and current completion state", async () => {
    const toggleStarted = createDeferred<void>();
    const toggleCompletion = createDeferred<{
      data: typeof sourceTask;
    }>();
    taskApiMocks.contactsTasksToggleUpdate.mockImplementation(() => {
      toggleStarted.resolve(undefined);
      return toggleCompletion.promise;
    });
    const { queryClient, rerenderModule } = renderWithPendingTasks({
      pendingTasks: [sharedTaskWithDuplicateAssignees],
    });
    const invalidationsFinished = createDeferred<void>();
    let invalidationCount = 0;
    vi.mocked(queryClient.invalidateQueries).mockImplementation(() => {
      invalidationCount += 1;
      if (invalidationCount === originalSharedTaskAndSourceFeedKeys.length) {
        invalidationsFinished.resolve(undefined);
      }
      return Promise.resolve();
    });

    fireEvent.click(getTaskToggle());
    await act(async () => {
      await toggleStarted.promise;
    });

    rerenderModule("404", "505");
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "toggle",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      values: { completed: false },
    });
    await act(async () => {
      toggleCompletion.resolve({
        data: { ...sourceTask, completed: true },
      });
      await invalidationsFinished.promise;
    });

    expect(invalidatedQueryKeys(queryClient)).toEqual(
      originalSharedTaskAndSourceFeedKeys,
    );
    expect(
      queryClient.getMutationCache().getAll().at(-1)?.state.variables,
    ).toEqual({
      kind: "toggle",
      id: 11,
      source: { vaultId: "101", contactId: "202" },
      previousAssigneeContactIds: ["202", "303"],
      values: { completed: false },
    });
    expectLatestMutationSnapshotFrozen(queryClient, [
      "source",
      "previousAssigneeContactIds",
      "values",
    ]);
  });
});
