import { describe, expect, it } from "vitest";
import type { Task, VaultTask } from "@/api";
import {
  createTaskDeleteMutationOperation,
  resolveTaskDeleteMutationOperation,
} from "@/pages/contact/modules/taskMutationOperation";

describe("contact task delete mutation operation", () => {
  it("freezes normalized source and root assignee snapshots", () => {
    const source = { vaultId: "101", contactId: "202" };
    const numericRouteContact = { id: "202", name: "Route Contact" };
    Reflect.set(numericRouteContact, "id", 202);
    const contacts: NonNullable<Task["contacts"]> = [
      { id: "303", name: "Shared Assignee" },
      numericRouteContact,
      { id: "303", name: "Duplicate Assignee" },
      { name: "Missing ID" },
    ];

    const operation = createTaskDeleteMutationOperation(source, {
      id: 11,
      contacts,
    });
    source.vaultId = "999";
    contacts.push({ id: "404", name: "Late Assignee" });

    expect(operation).toEqual({
      kind: "delete",
      source: { vaultId: "101", contactId: "202" },
      id: 11,
      previousAssigneeContactIds: ["202", "303"],
    });
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.source)).toBe(true);
    expect(Object.isFrozen(operation.previousAssigneeContactIds)).toBe(true);
  });

  it("freezes exact cycle-safe descendant impact without unrelated assignees", () => {
    const request = createTaskDeleteMutationOperation(
      { vaultId: "101", contactId: "202" },
      {
        id: 11,
        contacts: [{ id: "303", name: "Root Assignee" }],
      },
    );
    const allTasks: VaultTask[] = [
      {
        id: 11,
        label: "Root",
        parent_task_id: 13,
        contacts: [{ id: "303" }],
      },
      {
        id: 12,
        label: "Child",
        parent_task_id: 11,
        contacts: [{ id: "404" }],
      },
      {
        id: 12,
        label: "Duplicate child",
        parent_task_id: 11,
        contacts: [{ id: "404" }],
      },
      {
        id: 13,
        label: "Grandchild",
        parent_task_id: 12,
        contacts: [{ id: "505" }],
      },
      {
        id: 14,
        label: "Unrelated",
        contacts: [{ id: "606" }],
      },
    ];

    const operation = resolveTaskDeleteMutationOperation(request, allTasks);

    expect(operation.impact).toEqual({
      kind: "exact",
      assigneeContactIds: ["202", "303", "404", "505"],
    });
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.impact)).toBe(true);
    if (operation.impact.kind === "exact") {
      expect(Object.isFrozen(operation.impact.assigneeContactIds)).toBe(true);
    }
  });

  it("freezes fallback impact when the Vault task snapshot is unavailable", () => {
    const request = createTaskDeleteMutationOperation(
      { vaultId: "101", contactId: "202" },
      { id: 11, contacts: [] },
    );

    const operation = resolveTaskDeleteMutationOperation(request, undefined);

    expect(operation.impact).toEqual({ kind: "fallback" });
    expect(Object.isFrozen(operation.impact)).toBe(true);
  });
});
