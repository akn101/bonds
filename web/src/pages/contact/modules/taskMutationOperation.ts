import type { Task, VaultTask } from "@/api";
import type { TaskMutationSource } from "@/utils/taskQueryInvalidation";

export type TaskSaveValues = {
  readonly label: string;
  readonly description: string;
};

export type TaskMutationTarget = {
  readonly id: number;
  readonly completed?: boolean;
  readonly contacts: Task["contacts"];
};

export type TaskSaveMutationOperation =
  | {
      readonly kind: "create";
      readonly source: TaskMutationSource;
      readonly values: TaskSaveValues;
    }
  | {
      readonly kind: "update";
      readonly source: TaskMutationSource;
      readonly id: number;
      readonly previousAssigneeContactIds: readonly string[];
      readonly values: TaskSaveValues;
    };

export type TaskToggleMutationOperation = {
  readonly kind: "toggle";
  readonly source: TaskMutationSource;
  readonly id: number;
  readonly previousAssigneeContactIds: readonly string[];
  readonly values: {
    readonly completed: boolean;
  };
};

export type TaskDeleteMutationRequest = {
  readonly kind: "delete";
  readonly source: TaskMutationSource;
  readonly id: number;
  readonly previousAssigneeContactIds: readonly string[];
};

type TaskDeleteMutationImpact =
  | {
      readonly kind: "exact";
      readonly assigneeContactIds: readonly string[];
    }
  | {
      readonly kind: "fallback";
    };

export type TaskDeleteMutationOperation = TaskDeleteMutationRequest & {
  readonly impact: TaskDeleteMutationImpact;
};

function freezeRecord<T extends object>(record: T): Readonly<T> {
  return Object.freeze({ ...record });
}

function snapshotAssigneeContactIds(
  source: TaskMutationSource,
  contacts: Task["contacts"],
): readonly string[] {
  const contactIds = new Set<string>([source.contactId]);
  for (const contact of contacts ?? []) {
    if (contact.id !== undefined) contactIds.add(String(contact.id));
  }
  return Object.freeze([...contactIds]);
}

export function createTaskSaveMutationOperation(
  source: TaskMutationSource,
  editingTask: TaskMutationTarget | null,
  values: TaskSaveValues,
): TaskSaveMutationOperation {
  const sourceSnapshot = freezeRecord({
    vaultId: String(source.vaultId),
    contactId: String(source.contactId),
  });
  const valuesSnapshot = freezeRecord(values);
  if (editingTask === null) {
    return freezeRecord({
      kind: "create",
      source: sourceSnapshot,
      values: valuesSnapshot,
    });
  }
  return freezeRecord({
    kind: "update",
    source: sourceSnapshot,
    id: editingTask.id,
    previousAssigneeContactIds: snapshotAssigneeContactIds(
      sourceSnapshot,
      editingTask.contacts,
    ),
    values: valuesSnapshot,
  });
}

export function createTaskToggleMutationOperation(
  source: TaskMutationSource,
  task: TaskMutationTarget,
): TaskToggleMutationOperation {
  const sourceSnapshot = freezeRecord({
    vaultId: String(source.vaultId),
    contactId: String(source.contactId),
  });
  return freezeRecord({
    kind: "toggle",
    source: sourceSnapshot,
    id: task.id,
    previousAssigneeContactIds: snapshotAssigneeContactIds(
      sourceSnapshot,
      task.contacts,
    ),
    values: freezeRecord({ completed: task.completed ?? false }),
  });
}

export function createTaskDeleteMutationOperation(
  source: TaskMutationSource,
  task: TaskMutationTarget,
): TaskDeleteMutationRequest {
  const sourceSnapshot = freezeRecord({
    vaultId: String(source.vaultId),
    contactId: String(source.contactId),
  });
  return freezeRecord({
    kind: "delete",
    source: sourceSnapshot,
    id: task.id,
    previousAssigneeContactIds: snapshotAssigneeContactIds(
      sourceSnapshot,
      task.contacts,
    ),
  });
}

export function resolveTaskDeleteMutationOperation(
  request: TaskDeleteMutationRequest,
  allTasks: readonly VaultTask[] | undefined,
): TaskDeleteMutationOperation {
  if (allTasks === undefined) {
    return freezeRecord({
      ...request,
      impact: freezeRecord({ kind: "fallback" }),
    });
  }

  const childrenByParent = new Map<number, number[]>();
  for (const task of allTasks) {
    if (task.id === undefined || task.parent_task_id === undefined) continue;
    const childIds = childrenByParent.get(task.parent_task_id) ?? [];
    childIds.push(task.id);
    childrenByParent.set(task.parent_task_id, childIds);
  }

  const subtreeTaskIds = new Set<number>([request.id]);
  const pendingTaskIds = [request.id];
  for (let index = 0; index < pendingTaskIds.length; index += 1) {
    const currentTaskId = pendingTaskIds[index];
    if (currentTaskId === undefined) continue;
    for (const childId of childrenByParent.get(currentTaskId) ?? []) {
      if (subtreeTaskIds.has(childId)) continue;
      subtreeTaskIds.add(childId);
      pendingTaskIds.push(childId);
    }
  }

  const assigneeContactIds = new Set(request.previousAssigneeContactIds);
  for (const task of allTasks) {
    if (task.id === undefined || !subtreeTaskIds.has(task.id)) continue;
    for (const contact of task.contacts ?? []) {
      if (contact.id !== undefined) assigneeContactIds.add(String(contact.id));
    }
  }
  const exactAssigneeContactIds = Object.freeze([...assigneeContactIds]);

  return freezeRecord({
    ...request,
    impact: freezeRecord({
      kind: "exact",
      assigneeContactIds: exactAssigneeContactIds,
    }),
  });
}
