import { describe, expect, it } from "vitest";
import * as d3 from "d3";
import { fitProjectionToPoints, fitTargets } from "@/components/mapProjection";

const W = 900;
const H = 420;

function finiteProjection(points: { latitude: number; longitude: number }[]) {
  const projection = d3.geoMercator();
  fitProjectionToPoints(projection, points, W, H);
  return projection;
}

describe("fitProjectionToPoints", () => {
  it("produces a drawable projection for exactly one point", () => {
    // The bug: fitExtent over a single Point has a zero-area bounding box, so
    // d3 returns a non-finite scale AND translate, and the map renders blank.
    const projection = finiteProjection([{ latitude: 51.5072, longitude: -0.1276 }]);

    expect(Number.isFinite(projection.scale())).toBe(true);
    const [tx, ty] = projection.translate();
    expect(Number.isFinite(tx)).toBe(true);
    expect(Number.isFinite(ty)).toBe(true);

    const projected = projection([-0.1276, 51.5072]);
    expect(projected).not.toBeNull();
    const [x, y] = projected!;
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    // and it lands inside the canvas, not off in space
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(W);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(H);
  });

  it("centres a single point in the canvas", () => {
    const projection = finiteProjection([{ latitude: 48.2082, longitude: 16.3738 }]);
    const [x, y] = projection([16.3738, 48.2082])!;
    expect(x).toBeCloseTo(W / 2, 0);
    expect(y).toBeCloseTo(H / 2, 0);
  });

  it("handles several points that share one coordinate", () => {
    // District-level geocoding puts many addresses on the same spot, which is
    // the same degenerate bounding box as a single point.
    const same = Array.from({ length: 5 }, () => ({ latitude: 51.5, longitude: -0.12 }));
    const projection = finiteProjection(same);
    expect(Number.isFinite(projection.scale())).toBe(true);
    expect(projection.translate().every(Number.isFinite)).toBe(true);
  });

  it("still fits normally to points that span an area", () => {
    const projection = finiteProjection([
      { latitude: 51.5, longitude: -0.12 },
      { latitude: 55.9, longitude: -3.19 },
      { latitude: 53.4, longitude: -2.98 },
    ]);
    expect(Number.isFinite(projection.scale())).toBe(true);
    for (const p of [
      [-0.12, 51.5],
      [-3.19, 55.9],
    ] as [number, number][]) {
      const [x, y] = projection(p)!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it("does nothing when there are no points", () => {
    const projection = d3.geoMercator();
    const before = projection.scale();
    fitProjectionToPoints(projection, [], W, H);
    expect(projection.scale()).toBe(before);
  });
});

describe("fitTargets", () => {
  it("keeps every point when there are few of them", () => {
    const points = [
      { latitude: 51.5, longitude: -0.1 },
      { latitude: -18.9, longitude: -48.3 },
    ];
    expect(fitTargets(points)).toHaveLength(2);
  });

  it("excludes a far outlier from the framing once there is a distribution", () => {
    // A real case: a UK postcode that geocoded to Brazil. It is still drawn,
    // it just must not drag the viewport out to the Atlantic.
    const uk = Array.from({ length: 20 }, (_, i) => ({
      latitude: 51 + i * 0.01,
      longitude: -0.1 + i * 0.01,
    }));
    const withOutlier = [...uk, { latitude: -18.95, longitude: -48.31 }];
    const framed = fitTargets(withOutlier);
    expect(framed.some((p) => p.latitude < 0)).toBe(false);
    expect(framed.length).toBeGreaterThan(10);
  });
});
