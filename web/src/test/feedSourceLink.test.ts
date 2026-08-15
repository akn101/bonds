import { describe, expect, it } from "vitest";
import {
  buildContactSourcePath,
  parseContactSourceFocus,
} from "@/utils/feedSourceLink";

const basePath = "/vaults/vault-1/contacts/contact-1";

describe("buildContactSourcePath", () => {
  it.each([
    ["Note", "notes"],
    ["ContactReminder", "reminders"],
    ["Call", "calls"],
    ["ContactTask", "tasks"],
    ["Address", "addresses"],
    ["Loan", "loans"],
    ["Relationship", "relationships"],
    ["File", "photos"],
    ["File", "documents"],
    ["File", "quick_facts"],
  ])("builds the canonical %s source path for %s", (kind, module) => {
    // Given
    const source = { available: true, id: 17, kind, module };

    // When
    const path = buildContactSourcePath("vault-1", "contact-1", source);

    // Then
    expect(path).toBe(`${basePath}?focus=${module}&source=${kind}:17`);
  });

  it("builds the canonical route-backed activity detail path", () => {
    expect(
      buildContactSourcePath("vault-1", "contact-1", {
        available: true,
        id: 17,
        kind: "Activity",
        module: "activities",
      }),
    ).toBe("/vaults/vault-1/activities/17");
  });

  it.each([
    ["missing source", undefined],
    [
      "unavailable source",
      { available: false, id: 1, kind: "Note", module: "notes" },
    ],
    ["missing availability", { id: 1, kind: "Note", module: "notes" }],
    ["missing id", { available: true, kind: "Note", module: "notes" }],
    ["zero id", { available: true, id: 0, kind: "Note", module: "notes" }],
    ["negative id", { available: true, id: -1, kind: "Note", module: "notes" }],
    [
      "fractional id",
      { available: true, id: 1.5, kind: "Note", module: "notes" },
    ],
    [
      "unsafe id",
      {
        available: true,
        id: Number.MAX_SAFE_INTEGER + 1,
        kind: "Note",
        module: "notes",
      },
    ],
    [
      "infinite id",
      {
        available: true,
        id: Number.POSITIVE_INFINITY,
        kind: "Note",
        module: "notes",
      },
    ],
    ["unknown kind", { available: true, id: 1, kind: "Gift", module: "gifts" }],
    [
      "wrong-case kind",
      { available: true, id: 1, kind: "note", module: "notes" },
    ],
    [
      "invalid module",
      { available: true, id: 1, kind: "Note", module: "gifts" },
    ],
    [
      "kind/module mismatch",
      { available: true, id: 1, kind: "Note", module: "reminders" },
    ],
    [
      "invalid file module",
      { available: true, id: 1, kind: "File", module: "notes" },
    ],
  ])("falls back to the base contact path for %s", (_caseName, source) => {
    // When
    const path = buildContactSourcePath("vault-1", "contact-1", source);

    // Then
    expect(path).toBe(basePath);
  });
});

describe("parseContactSourceFocus", () => {
  it.each([
    ["Note", "notes"],
    ["ContactReminder", "reminders"],
    ["Call", "calls"],
    ["ContactTask", "tasks"],
    ["Address", "addresses"],
    ["Activity", "activities"],
    ["Loan", "loans"],
    ["Relationship", "relationships"],
    ["File", "photos"],
    ["File", "documents"],
    ["File", "quick_facts"],
  ])("parses the canonical %s source pair for %s", (kind, module) => {
    // When
    const parsed = parseContactSourceFocus(
      `?focus=${module}&source=${kind}:17`,
    );

    // Then
    expect(parsed).toEqual({
      focus: module,
      source: { id: 17, kind, module },
    });
  });

  it.each([
    ["missing focus", "?source=Note:1"],
    ["missing source", "?focus=notes"],
    ["duplicate focus", "?focus=notes&focus=notes&source=Note:1"],
    ["duplicate source", "?focus=notes&source=Note:1&source=Note:1"],
    ["extra parameter", "?focus=notes&source=Note:1&view=compact"],
    ["zero id", "?focus=notes&source=Note:0"],
    ["negative id", "?focus=notes&source=Note:-1"],
    ["fractional id", "?focus=notes&source=Note:1.5"],
    ["leading-zero id", "?focus=notes&source=Note:01"],
    ["signed id", "?focus=notes&source=Note:%2B1"],
    ["exponential id", "?focus=notes&source=Note:1e3"],
    ["unsafe id", "?focus=notes&source=Note:9007199254740992"],
    ["wrong-case kind", "?focus=notes&source=note:1"],
    ["wrong-case focus", "?focus=Notes&source=Note:1"],
    ["unknown kind", "?focus=gifts&source=Gift:1"],
    ["kind/module mismatch", "?focus=reminders&source=Note:1"],
    ["invalid file module", "?focus=notes&source=File:1"],
    ["malformed source", "?focus=notes&source=Note"],
    ["extra source separator", "?focus=notes&source=Note:1:2"],
  ])("rejects %s", (_caseName, search) => {
    // When
    const parsed = parseContactSourceFocus(search);

    // Then
    expect(parsed).toBeNull();
  });
});
