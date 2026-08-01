import { describe, expect, it } from "vitest";
import { createContactSaveMutationOperation } from "@/pages/contact/modules/contactSaveMutationOperation";

describe("createContactSaveMutationOperation", () => {
  it("keeps create identity with its submitted form values when no edit id exists", () => {
    const values = { label: "New record" };

    const operation = createContactSaveMutationOperation(null, values);

    expect(operation).toEqual({ kind: "create", values });
  });

  it("keeps update identity and id with its submitted form values when an edit id exists", () => {
    const values = { label: "Updated record" };

    const operation = createContactSaveMutationOperation(7, values);

    expect(operation).toEqual({ kind: "update", id: 7, values });
  });
});
