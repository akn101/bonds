import type { ContactTabModule, ContactTabPage } from "@/api";

// Compares a card's name with its section's for the navigation, ignoring case
// and spacing so "Relationship network" and "Relationship Network" count as the
// same word rather than as two entries.
function normaliseNavName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The cards the section navigation should list under a section.
 *
 * A LONE card that just restates its section's name is dropped: "Activities >
 * Activities" tells the reader nothing, and repeating the name puts two
 * identically labelled buttons in one navigation, which is ambiguous both to a
 * screen reader and to anything selecting by accessible name.
 *
 * Only the lone case folds. In a multi-card section a card sharing the
 * section's name is still a distinct scroll target — its siblings prove the
 * section and the card are different things — so renaming a page to match one
 * of its cards must not silently delete that card from the navigation.
 *
 * Sections whose lone card is named differently still expand — "Summary"
 * holding "Contact summary" is worth showing. Suppressing every single-card
 * section was tried first and made the control look broken, because in a
 * default layout five of the eight sections hold exactly one card, including
 * the one a contact opens on.
 */
export function sectionNavCards(page: ContactTabPage): ContactTabModule[] {
  const cards = page.modules ?? [];
  if (cards.length === 1) {
    const sectionName = normaliseNavName(page.name ?? page.slug ?? "");
    if (normaliseNavName(cards[0].name ?? cards[0].type ?? "") === sectionName) {
      return [];
    }
  }
  return cards;
}

