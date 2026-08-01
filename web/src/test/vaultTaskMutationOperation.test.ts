import { describe, expect, it } from "vitest";
import type { VaultTask } from "@/api";
import {
  createDeleteVaultTaskRequest,
  createVaultTaskOperation,
  resolveDeleteVaultTaskOperation,
  updateVaultTaskOperation,
  vaultTaskDescendantIds,
  type CreateVaultTaskOperation,
  type UpdateVaultTaskOperation,
  type VaultTaskRequestValues,
} from "@/pages/vault/vaultTaskMutationOperation";

type IsReadonlyArray<Value> =
  NonNullable<Value> extends readonly unknown[]
    ? NonNullable<Value> extends unknown[]
      ? false
      : true
    : false;

type RequireTrue<Value extends boolean> = Value extends true ? true : never;

type RequestContactIdArraysAreReadonly =
  IsReadonlyArray<
    CreateVaultTaskOperation["request"]["contact_ids"]
  > extends true
    ? IsReadonlyArray<UpdateVaultTaskOperation["request"]["contact_ids"]>
    : false;

const requestContactIdArraysAreReadonly: RequireTrue<RequestContactIdArraysAreReadonly> = true;

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

describe("vault task mutation operation snapshots", () => {
  it("exposes type-level readonly contact ID arrays on create and update requests", () => {
    expect(requestContactIdArraysAreReadonly).toBe(true);
  });

  it("stable-deduplicates create contact IDs and runtime-freezes mutation snapshot arrays", () => {
    const createOperation = createVaultTaskOperation({
      vaultId: "vault-1",
      values: requestValues([101, "101", "202"]),
    });
    const updateOperation = updateVaultTaskOperation({
      vaultId: "vault-1",
      task: task(11, ["101"]),
      values: requestValues(["202"]),
    });
    const deleteRequest = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(11, ["101", "101", "202"]),
    });

    expect(createOperation.request.contact_ids).toEqual(["101", "202"]);
    expect(createOperation.assigneeContactIds).toEqual(["101", "202"]);
    expect(Object.isFrozen(createOperation.request.contact_ids)).toBe(true);
    expect(Object.isFrozen(createOperation.assigneeContactIds)).toBe(true);
    expect(Object.isFrozen(updateOperation.request.contact_ids)).toBe(true);
    expect(Object.isFrozen(updateOperation.previousAssigneeContactIds)).toBe(
      true,
    );
    expect(deleteRequest).toEqual({
      kind: "delete",
      vaultId: "vault-1",
      taskId: 11,
      rootAssigneeContactIds: ["101", "202"],
    });
    expect(Object.isFrozen(deleteRequest)).toBe(true);
    expect(Object.isFrozen(deleteRequest.rootAssigneeContactIds)).toBe(true);
  });

  it("resolves exact recursive root, child, and grandchild assignees without unrelated tasks", () => {
    const request = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(11, ["101"]),
    });

    const operation = resolveDeleteVaultTaskOperation(request, [
      task(11, ["101"]),
      task(12, ["202"], 11),
      task(13, ["303"], 12),
      task(14, ["404"]),
    ]);

    expect(operation.impact).toEqual({
      kind: "exact",
      assigneeContactIds: ["101", "202", "303"],
    });
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.impact)).toBe(true);
    if (operation.impact.kind === "exact") {
      expect(Object.isFrozen(operation.impact.assigneeContactIds)).toBe(true);
    }
  });

  it("resolves cyclic descendant assignees once without revisiting the root", () => {
    const request = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(1, ["101"]),
    });

    const operation = resolveDeleteVaultTaskOperation(request, [
      task(1, ["101"], 3),
      task(2, ["202"], 1),
      task(2, ["202"], 1),
      task(3, ["303"], 2),
    ]);

    expect(operation.impact).toEqual({
      kind: "exact",
      assigneeContactIds: ["101", "202", "303"],
    });
  });

  it("resolves fallback impact when the all-task snapshot is unavailable", () => {
    const request = createDeleteVaultTaskRequest({
      vaultId: "vault-1",
      task: task(11, ["101"]),
    });

    const operation = resolveDeleteVaultTaskOperation(request, undefined);

    expect(operation.impact).toEqual({ kind: "fallback" });
    expect(Object.isFrozen(operation.impact)).toBe(true);
  });

  it("terminates cyclic descendants and returns each descendant once", () => {
    const descendants = vaultTaskDescendantIds(1, [
      task(1, [], 3),
      task(2, [], 1),
      task(2, [], 1),
      task(3, [], 2),
    ]);

    expect([...descendants].sort((left, right) => left - right)).toEqual([
      2, 3,
    ]);
  });

  it("does not expose the submitted assignee snapshot on update operations", () => {
    const operation = updateVaultTaskOperation({
      vaultId: "vault-1",
      task: task(11, ["101"]),
      values: requestValues(["202"]),
    });

    expect(Object.keys(operation).sort()).toEqual([
      "kind",
      "previousAssigneeContactIds",
      "request",
      "taskId",
      "vaultId",
    ]);
    expect(operation).not.toHaveProperty("submittedAssigneeContactIds");
  });
});
