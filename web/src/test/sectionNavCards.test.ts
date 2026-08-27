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

  it("drops only the restating card, not its siblings", () => {
    const cards = sectionNavCards(page("Social", ["Social", "Pets", "Groups"]));
    expect(cards.map((c) => c.name)).toEqual(["Pets", "Groups"]);
  });

  it("never produces a duplicate of the section's own name", () => {
    // The property that matters: whatever the layout, the nav cannot end up
    // with two identically labelled buttons under one section.
    for (const p of [
      page("Activities", ["Activities"]),
      page("Notes and records", ["Notes", "Documents", "Notes and records"]),
      page("Summary", ["Contact summary"]),
    ]) {
      const names = sectionNavCards(p).map((c) => c.name?.toLowerCase());
      expect(names).not.toContain(p.name?.toLowerCase());
    }
  });

  it("handles a section with no cards", () => {
    expect(sectionNavCards({ id: 1, name: "Empty", slug: "empty", modules: [] })).toEqual([]);
    expect(sectionNavCards({ id: 1, name: "Empty", slug: "empty" })).toEqual([]);
  });
});
