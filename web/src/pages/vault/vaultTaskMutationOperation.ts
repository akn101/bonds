import type {
  CreateVaultTaskRequest,
  UpdateVaultTaskRequest,
  VaultTask,
} from "@/api";
export { vaultTaskListQueryKey } from "@/utils/taskQueryInvalidation";
type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

export type VaultTaskRequestValues = {
  readonly label: string;
  readonly description: string;
  readonly contactIds: readonly (string | number)[];
  readonly parentTaskId: number | null | undefined;
  readonly status: string;
  readonly dueAt: string | undefined;
  readonly calendarType: string | undefined;
  readonly originalDay: number | undefined;
  readonly originalMonth: number | undefined;
  readonly originalYear: number | undefined;
};
export type CreateVaultTaskOperation = {
  readonly kind: "create";
  readonly vaultId: string;
  readonly request: DeepReadonly<CreateVaultTaskRequest>;
  readonly assigneeContactIds: readonly string[];
};
export type UpdateVaultTaskOperation = {
  readonly kind: "update";
  readonly vaultId: string;
  readonly taskId: number;
  readonly request: DeepReadonly<UpdateVaultTaskRequest>;
  readonly previousAssigneeContactIds: readonly string[];
};
export type DeleteVaultTaskRequest = {
  readonly kind: "delete";
  readonly vaultId: string;
  readonly taskId: number;
  readonly rootAssigneeContactIds: readonly string[];
};
type DeleteVaultTaskImpact =
  | {
      readonly kind: "exact";
      readonly assigneeContactIds: readonly string[];
    }
  | {
      readonly kind: "fallback";
    };
export type DeleteVaultTaskOperation = DeleteVaultTaskRequest & {
  readonly impact: DeleteVaultTaskImpact;
};
type CreateOperationInput = {
  readonly vaultId: string;
  readonly values: VaultTaskRequestValues;
};
type UpdateOperationInput = CreateOperationInput & {
  readonly task: VaultTask & { readonly id: number };
};
type DeleteRequestInput = {
  readonly vaultId: string;
  readonly task: VaultTask & { readonly id: number };
};

function freezeRecord<T extends object>(record: T): Readonly<T> {
  return Object.freeze({ ...record });
}

export function snapshotVaultTaskContactIds(
  contactIds: readonly (string | number | undefined)[],
): readonly string[] {
  const normalizedContactIds: string[] = [];
  const seenContactIds = new Set<string>();
  for (const contactId of contactIds) {
    if (contactId === undefined) continue;
    const normalizedContactId = String(contactId);
    if (seenContactIds.has(normalizedContactId)) continue;
    seenContactIds.add(normalizedContactId);
    normalizedContactIds.push(normalizedContactId);
  }
  Object.freeze(normalizedContactIds);
  return normalizedContactIds;
}

function taskAssigneeContactIds(task: VaultTask): readonly string[] {
  return snapshotVaultTaskContactIds(
    (task.contacts ?? []).map((contact) => contact.id),
  );
}

function freezeRequest<Request extends object>(
  request: Request,
): Readonly<Request> {
  Object.freeze(request);
  return request;
}

function createRequest(
  values: VaultTaskRequestValues,
): DeepReadonly<CreateVaultTaskRequest> {
  const contactIds = snapshotVaultTaskContactIds(values.contactIds);
  return freezeRequest({
    label: values.label,
    description: values.description,
    contact_ids: contactIds,
    parent_task_id: values.parentTaskId ?? undefined,
    status: values.status,
    due_at: values.dueAt,
    calendar_type: values.calendarType,
    original_day: values.originalDay,
    original_month: values.originalMonth,
    original_year: values.originalYear,
  });
}

function updateRequest(
  values: VaultTaskRequestValues,
): DeepReadonly<UpdateVaultTaskRequest> {
  const contactIds = snapshotVaultTaskContactIds(values.contactIds);
  const request: DeepReadonly<UpdateVaultTaskRequest> = {
    label: values.label,
    description: values.description,
    contact_ids: contactIds,
    parent_task_id: values.parentTaskId ?? undefined,
    status: values.status,
    due_at: values.dueAt,
    calendar_type: values.calendarType,
    original_day: values.originalDay,
    original_month: values.originalMonth,
    original_year: values.originalYear,
  };
  if (values.parentTaskId === null) {
    Object.defineProperty(request, "parent_task_id", {
      configurable: true,
      enumerable: true,
      value: null,
      writable: true,
    });
  }
  return freezeRequest(request);
}

// Snapshot identity and cascade impact at submit time so rerenders or deletion cannot redirect cache cleanup.
export function createVaultTaskOperation(
  input: CreateOperationInput,
): CreateVaultTaskOperation {
  const request = createRequest(input.values);
  const assigneeContactIds = snapshotVaultTaskContactIds(
    request.contact_ids ?? [],
  );
  return freezeRecord({
    kind: "create",
    vaultId: String(input.vaultId),
    request,
    assigneeContactIds,
  });
}

export function updateVaultTaskOperation(
  input: UpdateOperationInput,
): UpdateVaultTaskOperation {
  const request = updateRequest(input.values);
  return freezeRecord({
    kind: "update",
    vaultId: String(input.vaultId),
    taskId: input.task.id,
    request,
    previousAssigneeContactIds: taskAssigneeContactIds(input.task),
  });
}

export function vaultTaskDescendantIds(
  rootTaskId: number,
  allTasks: readonly VaultTask[],
): ReadonlySet<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const task of allTasks) {
    if (task.id === undefined || task.parent_task_id === undefined) continue;
    const childIds = childrenByParent.get(task.parent_task_id) ?? [];
    childIds.push(task.id);
    childrenByParent.set(task.parent_task_id, childIds);
  }

  const descendantIds = new Set<number>();
  const visitedTaskIds = new Set<number>([rootTaskId]);
  const pendingTaskIds = [rootTaskId];
  while (pendingTaskIds.length > 0) {
    const currentTaskId = pendingTaskIds.shift();
    if (currentTaskId === undefined) continue;
    for (const childId of childrenByParent.get(currentTaskId) ?? []) {
      if (visitedTaskIds.has(childId)) continue;
      visitedTaskIds.add(childId);
      descendantIds.add(childId);
      pendingTaskIds.push(childId);
    }
  }
  return descendantIds;
}

export function createDeleteVaultTaskRequest(
  input: DeleteRequestInput,
): DeleteVaultTaskRequest {
  return freezeRecord({
    kind: "delete",
    vaultId: String(input.vaultId),
    taskId: input.task.id,
    rootAssigneeContactIds: taskAssigneeContactIds(input.task),
  });
}

export function resolveDeleteVaultTaskOperation(
  request: DeleteVaultTaskRequest,
  allTasks: readonly VaultTask[] | undefined,
): DeleteVaultTaskOperation {
  // Only a trustworthy all-task snapshot can identify every backend-cascaded assignee.
  if (allTasks === undefined) {
    const impact: DeleteVaultTaskImpact = freezeRecord({ kind: "fallback" });
    return freezeRecord({ ...request, impact });
  }

  const descendantIds = vaultTaskDescendantIds(request.taskId, allTasks);
  const descendantAssigneeContactIds = allTasks.flatMap((task) =>
    task.id !== undefined && descendantIds.has(task.id)
      ? taskAssigneeContactIds(task)
      : [],
  );
  const impact: DeleteVaultTaskImpact = freezeRecord({
    kind: "exact",
    assigneeContactIds: snapshotVaultTaskContactIds([
      ...request.rootAssigneeContactIds,
      ...descendantAssigneeContactIds,
    ]),
  });
  return freezeRecord({ ...request, impact });
}
