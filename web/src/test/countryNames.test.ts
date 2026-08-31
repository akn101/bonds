import { describe, expect, it } from "vitest";
import { matchCountryName } from "@/utils/countryNames";

describe("matchCountryName", () => {
  it("matches a name the map already spells the same way", () => {
    expect(matchCountryName("United Kingdom")).toBe("unitedkingdom");
  });

  it("ignores case, spacing and punctuation", () => {
    expect(matchCountryName("  united   kingdom ")).toBe("unitedkingdom");
    expect(matchCountryName("U.K.")).toBe("unitedkingdom");
  });

  it("folds accents so the map name and the typed name meet", () => {
    // The map spells this "Côte d'Ivoire"; address books rarely do.
    expect(matchCountryName("Cote d'Ivoire")).toBe("cotedivoire");
    expect(matchCountryName("Côte d’Ivoire")).toBe("cotedivoire");
  });

  it("resolves the long form the map does not use", () => {
    expect(matchCountryName("United States")).toBe("unitedstatesofamerica");
    expect(matchCountryName("USA")).toBe("unitedstatesofamerica");
  });

  it("treats the nations of the UK as the UK, which is how addresses are written", () => {
    expect(matchCountryName("England")).toBe("unitedkingdom");
    expect(matchCountryName("Scotland")).toBe("unitedkingdom");
  });

  it("expands two-letter country codes without shipping an ISO table", () => {
    expect(matchCountryName("GB")).toBe("unitedkingdom");
    expect(matchCountryName("de")).toBe("germany");
    expect(matchCountryName("JP")).toBe("japan");
  });

  it("maps older and official names onto the map's spelling", () => {
    expect(matchCountryName("Czech Republic")).toBe("czechia");
    expect(matchCountryName("Burma")).toBe("myanmar");
    expect(matchCountryName("Holland")).toBe("netherlands");
  });

  it("returns an empty key for a blank country so callers can skip it", () => {
    expect(matchCountryName("")).toBe("");
    expect(matchCountryName("   ")).toBe("");
  });

  it("passes an unknown country through rather than guessing", () => {
    expect(matchCountryName("Wakanda")).toBe("wakanda");
  });
});

describe("matchCountryName against the bundled map", () => {
  it("resolves every alias to a country the map actually draws", async () => {
    const world = (await import("@/assets/world-countries.geo.json")) as unknown as {
      default: { features: { properties: { name: string } }[] };
    };
    const features = (world.default ?? world) as { features: { properties: { name: string } }[] };
    const drawn = new Set(features.features.map((f) => matchCountryName(f.properties.name)));

    // A country the reports API can return but the map cannot draw is a silent
    // hole in the choropleth, so check the ones users actually type.
    for (const country of [
      "United Kingdom", "United States", "USA", "GB", "US", "France", "Germany",
      "China", "Austria", "Thailand", "Netherlands", "Czech Republic", "Singapore",
      "Malta", "Luxembourg", "Cyprus", "South Korea", "Vietnam", "Ivory Coast",
      // The country field is free text in an app shipped in seven languages:
      // names written in the reader's own script must shade the map too.
      "中国", "美国", "英国", "日本", "韩国", "Россия", "Украина", "한국", "Ελλάδα",
    ]) {
      expect(drawn.has(matchCountryName(country)), `${country} is not on the map`).toBe(true);
    }
  });
});

describe("matchCountryName with non-Latin scripts", () => {
  it("keeps letters of every script instead of reducing them to nothing", () => {
    // Before this was fixed, normalising stripped everything outside [a-z0-9],
    // so 中国 became "" and the contact silently vanished from the choropleth.
    expect(matchCountryName("中国")).toBe("china");
    expect(matchCountryName("Россия")).toBe("russia");
    expect(matchCountryName("대한민국")).toBe("southkorea");
    // An unknown non-Latin name still yields a non-empty key, so it keeps
    // counting in the country list even though no feature matches it.
    expect(matchCountryName("몽골")).not.toBe("");
  });
});
