import * as d3 from "d3";

/** A point the map has to keep in view. */
export type MapFitPoint = { latitude: number; longitude: number };

/**
 * How much of the world a map shows when it has only one location to frame.
 *
 * Wide enough to recognise where you are: a couple of degrees fills the canvas
 * with one unbroken landmass and no coastline to orient by, which is not much
 * more useful than the blank map this replaced.
 */
const SINGLE_POINT_SPAN_DEGREES = 12;

/**
 * The points the projection should frame.
 *
 * A single mis-geocoded address — and address books are full of them, a UK
 * postcode that resolved to Brazil — would otherwise drag the view out to a
 * whole-world map with everything else in one corner. Trimming to the middle of
 * the distribution keeps the map on where people actually are; the outlier is
 * still drawn, it just does not get a vote on the framing.
 */
export function fitTargets<T extends MapFitPoint>(points: T[]): T[] {
  if (points.length < 8) return points;
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  };
  const latitudes = points.map((p) => p.latitude);
  const longitudes = points.map((p) => p.longitude);
  const minLat = percentile(latitudes, 0.05);
  const maxLat = percentile(latitudes, 0.95);
  const minLon = percentile(longitudes, 0.05);
  const maxLon = percentile(longitudes, 0.95);
  const kept = points.filter(
    (p) => p.latitude >= minLat && p.latitude <= maxLat && p.longitude >= minLon && p.longitude <= maxLon,
  );
  return kept.length > 0 ? kept : points;
}

/**
 * Frame a projection on a set of points.
 *
 * `fitExtent` cannot do this alone. Given a single point — or several that
 * share a coordinate, which happens whenever addresses are geocoded to their
 * district rather than their doorstep — the bounding box has zero width and
 * height, and d3 answers with a non-finite scale AND a non-finite translate.
 * Correcting only the scale leaves the translate at NaN and the map renders
 * blank. Degenerate cases are therefore framed explicitly by centring on the
 * location and choosing a readable span, never by asking fitExtent.
 */
export function fitProjectionToPoints(
  projection: d3.GeoProjection,
  points: MapFitPoint[],
  width: number,
  height: number,
  padding = 12,
): void {
  const framed = fitTargets(points);
  if (framed.length === 0) return;

  const latitudes = framed.map((p) => p.latitude);
  const longitudes = framed.map((p) => p.longitude);
  const spanLat = Math.max(...latitudes) - Math.min(...latitudes);
  const spanLon = Math.max(...longitudes) - Math.min(...longitudes);

  // Everything at one spot: fitExtent has nothing to scale against.
  if (spanLat < 1e-6 && spanLon < 1e-6) {
    const [lon, lat] = [longitudes[0], latitudes[0]];
    projection
      .center([lon, lat])
      .translate([width / 2, height / 2])
      // Scale so the chosen span fills the smaller axis; geoMercator's scale is
      // in units of "pixels per radian" at the equator.
      .scale(Math.min(width, height) / ((SINGLE_POINT_SPAN_DEGREES * Math.PI) / 180) / 2);
    return;
  }

  projection.fitExtent(
    [
      [padding, padding],
      [width - padding, height - padding],
    ],
    {
      type: "FeatureCollection",
      features: framed.map((p) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
      })),
    } as d3.GeoPermissibleObjects,
  );
}
