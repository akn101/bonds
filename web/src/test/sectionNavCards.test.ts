import { describe, expect, it } from "vitest";
import { sectionNavCards } from "@/pages/contact/sectionNavCards";
import type { ContactTabPage } from "@/api";

const page = (name: string, cards: string[]): ContactTabPage => ({
  id: 1,
  name,
  slug: name.toLowerCase(),
  type: "contact",
  modules: cards.map((n, i) => ({ id: i + 1, name: n, type: n.toLowerCase(), position: i })),
});

describe("sectionNavCards", () => {
  it("lists the cards of a multi-card section", () => {
    const cards = sectionNavCards(page("Profile and contact", ["Important dates", "Labels", "Addresses"]));
    expect(cards.map((c) => c.name)).toEqual(["Important dates", "Labels", "Addresses"]);
  });

  it("keeps a single card whose name differs from the section", () => {
    // "Summary" holding "Contact summary" is worth showing.
    expect(sectionNavCards(page("Summary", ["Contact summary"])).map((c) => c.name)).toEqual([
      "Contact summary",
    ]);
  });

  it("drops a lone card that merely restates the section name", () => {
    // "Activities > Activities" tells the reader nothing, and two buttons with
    // the same accessible name in one nav are ambiguous to a screen reader.
    expect(sectionNavCards(page("Activities", ["Activities"]))).toEqual([]);
    expect(sectionNavCards(page("Goals", ["Goals"]))).toEqual([]);
    expect(sectionNavCards(page("Relationship network", ["Relationship network"]))).toEqual([]);
  });

  it("ignores case and spacing when comparing", () => {
    expect(sectionNavCards(page("Relationship network", ["Relationship  Network"]))).toEqual([]);
  });

  it("keeps a name-sharing card when it has siblings", () => {
    // With siblings present, the section and the card are demonstrably
    // different things, and the card is a distinct scroll target: renaming a
    // page to match one of its cards must not silently delete that card.
    const cards = sectionNavCards(page("Social", ["Social", "Pets", "Groups"]));
    expect(cards.map((c) => c.name)).toEqual(["Social", "Pets", "Groups"]);
  });

  it("only ever folds the lone-card case", () => {
    // The fold exists to stop "Activities > Activities" — a nav entry that
    // duplicates its own section header and nothing else. Any layout with
    // more than one card keeps every card.
    for (const p of [
      page("Notes and records", ["Notes", "Documents", "Notes and records"]),
      page("Social", ["Social", "Pets"]),
    ]) {
      expect(sectionNavCards(p)).toHaveLength(p.modules?.length ?? 0);
    }
  });

  it("handles a section with no cards", () => {
    expect(sectionNavCards({ id: 1, name: "Empty", slug: "empty", modules: [] })).toEqual([]);
    expect(sectionNavCards({ id: 1, name: "Empty", slug: "empty" })).toEqual([]);
  });
});
