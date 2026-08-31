/**
 * Matching a country a user typed into an address against a country on the map.
 *
 * Address country is free text — "UK", "U.S.A.", "Great Britain", "Côte
 * d'Ivoire" — while the map carries Natural Earth's names, which have their own
 * spellings ("United States of America", "Czechia", "Dem. Rep. Congo"). Both
 * sides are reduced to a comparable key, with an alias table for the cases no
 * amount of normalising will reconcile.
 */

/**
 * Strip case, accents and punctuation so "Côte d'Ivoire" and "cote divoire"
 * meet. Letters of every script survive — the country field is free text in an
 * app shipped in seven languages, and reducing 中国 or Россия to an empty
 * string would silently drop those contacts from the map.
 */
function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Recompose what decomposition took apart: Hangul splits into jamo under
    // NFD and must be reassembled into syllables to match the alias table.
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

  // Names in the app's own non-Latin locales, and neighbours a zh or ru
  // speaker's address book realistically holds. Normalising cannot bridge a
  // script, so these are plain lookups. The list is common names, not a
  // gazetteer — anything missing still counts in the country list, it just
  // does not shade the map.
  中国: "china",
  中华人民共和国: "china",
  台湾: "taiwan",
  美国: "unitedstatesofamerica",
  英国: "unitedkingdom",
  法国: "france",
  德国: "germany",
  西班牙: "spain",
  葡萄牙: "portugal",
  意大利: "italy",
  荷兰: "netherlands",
  瑞士: "switzerland",
  瑞典: "sweden",
  爱尔兰: "ireland",
  波兰: "poland",
  希腊: "greece",
  土耳其: "turkey",
  日本: "japan",
  韩国: "southkorea",
  朝鲜: "northkorea",
  新加坡: "singapore",
  马来西亚: "malaysia",
  印度尼西亚: "indonesia",
  菲律宾: "philippines",
  泰国: "thailand",
  越南: "vietnam",
  印度: "india",
  俄罗斯: "russia",
  澳大利亚: "australia",
  新西兰: "newzealand",
  加拿大: "canada",
  墨西哥: "mexico",
  巴西: "brazil",
  阿根廷: "argentina",
  南非: "southafrica",
  埃及: "egypt",
  россия: "russia",
  российскаяфедерация: "russia",
  украина: "ukraine",
  беларусь: "belarus",
  казахстан: "kazakhstan",
  대한민국: "southkorea",
  한국: "southkorea",
  미국: "unitedstatesofamerica",
  일본: "japan",
  중국: "china",
  ελλαδα: "greece",
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
