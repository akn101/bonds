/**
 * Matching a country a user typed into an address against a country on the map.
 *
 * Address country is free text — "UK", "U.S.A.", "Great Britain", "Côte
 * d'Ivoire" — while the map carries Natural Earth's names, which have their own
 * spellings ("United States of America", "Czechia", "Dem. Rep. Congo"). Both
 * sides are reduced to a comparable key, with an alias table for the cases no
 * amount of normalising will reconcile.
 */

/** Strip case, accents and punctuation so "Côte d'Ivoire" and "cote divoire" meet. */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Aliases keyed by normalised input, valued by the normalised Natural Earth
 * name. Only entries that normalising alone cannot resolve belong here.
 */
const ALIASES: Record<string, string> = {
  // The map spells this one out in full.
  unitedstates: "unitedstatesofamerica",
  usa: "unitedstatesofamerica",
  us: "unitedstatesofamerica",
  america: "unitedstatesofamerica",

  // The constituent nations of the UK are routinely written where the country
  // field is expected.
  uk: "unitedkingdom",
  greatbritain: "unitedkingdom",
  britain: "unitedkingdom",
  england: "unitedkingdom",
  scotland: "unitedkingdom",
  wales: "unitedkingdom",
  northernireland: "unitedkingdom",

  // Names the map abbreviates.
  bosniaandherzegovina: "bosniaandherz",
  centralafricanrepublic: "centralafricanrep",
  dominicanrepublic: "dominicanrep",
  southsudan: "ssudan",
  equatorialguinea: "eqguinea",
  solomonislands: "solomonis",
  democraticrepublicofthecongo: "demrepcongo",
  drcongo: "demrepcongo",
  republicofthecongo: "congo",

  // Short, older or official long forms.
  czechrepublic: "czechia",
  russianfederation: "russia",
  republicofkorea: "southkorea",
  korea: "southkorea",
  democraticpeoplesrepublicofkorea: "northkorea",
  laopeoplesdemocraticrepublic: "laos",
  syrianarabrepublic: "syria",
  islamicrepublicofiran: "iran",
  burma: "myanmar",
  swaziland: "eswatini",
  northmacedonia: "macedonia",
  ivorycoast: "cotedivoire",
  holland: "netherlands",
  thenetherlands: "netherlands",
  turkiye: "turkey",
  unitedrepublicoftanzania: "tanzania",
  republicofmoldova: "moldova",
  bolivarianrepublicofvenezuela: "venezuela",
};

let regionNames: Intl.DisplayNames | null | undefined;

/**
 * Expand a two-letter country code to its English name. Uses the platform's own
 * region table rather than shipping a copy of ISO 3166.
 */
function expandCode(value: string): string | null {
  if (!/^[a-z]{2}$/.test(value)) return null;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  if (!regionNames) return null;
  try {
    const name = regionNames.of(value.toUpperCase());
    // Intl echoes the input back when it does not recognise the code.
    return name && name.toUpperCase() !== value.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/**
 * Reduce a country name to the key both the address book and the map agree on.
 * Returns "" for anything blank, which callers treat as "no country".
 */
export function matchCountryName(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";

  let key = normalise(trimmed);
  const expanded = expandCode(key);
  if (expanded) key = normalise(expanded);

  return ALIASES[key] ?? key;
}
