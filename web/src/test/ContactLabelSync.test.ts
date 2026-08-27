import { describe, expect, it } from "vitest";

import { buildContactLabelSyncPlan } from "@/pages/contact/modules/contactLabelSync";

describe("contact label synchronization", () => {
  it("builds add and remove operations from changed label selections", () => {
    expect(
      buildContactLabelSyncPlan(
        [
          { id: 101, label_id: 1, name: "Family" },
          { id: 202, label_id: 2, name: "Friends" },
        ],
        [2, 3, 3],
      ),
    ).toEqual({
      addLabelIds: [3],
      removeAssignmentIds: [101],
    });
  });
});
