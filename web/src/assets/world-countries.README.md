# world-countries.geo.json

Country outlines for the vault map on the reports page.

The map is drawn from these vectors with `d3-geo`, which the project already
depends on. There is no tile server and no map API: the page makes no network
request to draw the world, needs no API key, and works on an air-gapped
instance. That also means no third party is told which countries a reader is
looking at.

## Source and licence

Natural Earth 1:50m Admin 0 – Countries, via
[world-atlas](https://github.com/topojson/world-atlas) (`countries-50m.json`).

Natural Earth is **public domain**: "no permission is needed to use Natural
Earth. Crediting the authors is unnecessary." — <https://www.naturalearthdata.com/about/terms-of-use/>

## How it was produced

The published data is TopoJSON at ~756 KB. It was converted to GeoJSON and
simplified so it could be shipped with the app:

1. Decode the quantised, delta-encoded TopoJSON arcs to absolute coordinates.
2. Simplify each ring with Douglas–Peucker at a tolerance of 0.05° (~5 km).
3. Round coordinates to two decimal places (~1 km) and drop the duplicate
   points that rounding creates.
4. Drop Antarctica, which no address resolves to and which is enormous.
5. Where simplification collapsed a country entirely — micro-states such as
   Monaco — keep its largest ring unsimplified instead of dropping the country.
   A country missing from the map is a bug a reader cannot see.

The result is 237 countries and ~29,000 points: 448 KB raw, ~144 KB gzipped,
loaded as its own chunk only when the reports page is opened.

Regenerating is a one-off job; the steps above are the whole recipe. Resolution
was chosen by what the map has to do: 1:110m is a third of the size but renders
the United Kingdom as a 55-point blob, which is unusable once the map fits
itself to a single country.
