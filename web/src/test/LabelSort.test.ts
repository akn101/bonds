import { describe, expect, it } from "vitest";

import { sortLabelsByName } from "@/utils/labelSort";

describe("sortLabelsByName", () => {
  it("sorts labels case-insensitively with natural numeric order", () => {
    const labels = [
      { id: 1, name: "Zulu" },
      { id: 2, name: "label 10" },
      { id: 3, name: "Alpha" },
      { id: 4, name: "label 2" },
    ];

    expect(sortLabelsByName(labels, "en").map((label) => label.name)).toEqual([
      "Alpha",
      "label 2",
      "label 10",
      "Zulu",
    ]);
    expect(labels.map((label) => label.name)).toEqual([
      "Zulu",
      "label 10",
      "Alpha",
      "label 2",
    ]);
  });
});
