# Spatial domain

`brazil.geojson` is the polygon the build clips to (`node pipeline/build.js --domain pipeline/domain/brazil.geojson`).

- Source: Natural Earth admin-0 countries, scale 10m, version 5.1.2 (tag `v5.1.2` of
  https://github.com/nvkelso/natural-earth-vector, file `geojson/ne_10m_admin_0_countries.geojson`,
  13.3 MB for the whole world). 10m was kept: the Brazil outline is small.
- Derived file: the Brazil feature only (`ADM0_A3 == "BRA"`, one MultiPolygon of 43 polygons),
  properties dropped, coordinates rounded to 5 decimals (about 1 m), plus a top-level
  `domain: {id: "ne10m-brazil", version: "5.1.2", name: "Brazil"}`: the build copies id and version into the manifest, and name into `overview.json` as the region label.
  234 KB; sha256 `cc207c56c63d59785d78cb0a2575863379d14821e8f83653ab97b868b3dd33db`.
- License: public domain (https://www.naturalearthdata.com/about/terms-of-use/, checked 2026-11-14:
  "All versions of Natural Earth raster + vector map data ... are in the public domain").
  Credit is not required; the app credits it anyway.
- Natural Earth draws a generalized, de facto outline, not the legal boundary. A fire a few hundred
  meters outside it can be clipped; the rule is the same for every year and sensor.
- Rule: a 0.1 deg cell is in the domain when it intersects the polygon; a 1 deg cell when any of its
  fine cells is. A record is kept only when its point is inside the polygon, so a border cell can
  hold fewer detections than its true area (border cells are in the domain, outside points are not).

`brazil-admin1.geojson` names the hotspots of `overview.json` (`--admin1`).

- Source: Natural Earth admin-1 states and provinces, scale 10m, version 5.1.2 (same repository and
  tag, file `geojson/ne_10m_admin_1_states_provinces.geojson`, 40.7 MB, sha256
  `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`), public domain as above.
- Derived file: the 27 features with `adm0_a3 == "BRA"`, sorted by `iso_3166_2`, properties kept as
  `{name, iso_3166_2, country}` (`country` from `admin`), coordinates rounded to 3 decimals (about
  100 m; only a fine-cell center within that distance of a border can change its vote), plus a top-level
  `source: {id: "ne10m-admin1", version: "5.1.2"}`. 596 KB; sha256
  `6c34ed6daeffb35f5925fe043c7f11bcf502591fda4feb53801e29132b4b0523`.
- A global build needs the whole admin-1 file instead (planned with the global extent, M4-K1).

`ne-gazetteer.json` holds the place names the area field suggests (`pipeline/gazetteer.js` writes
the in-domain part as `places.json`).

- Source: three Natural Earth 10m files, version 5.1.2, same repository and tag, public domain as
  above: `ne_10m_admin_0_countries.geojson` (sha256 `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`),
  `ne_10m_admin_1_states_provinces.geojson` (sha256 above) and `ne_10m_geography_regions_polys.geojson`
  (5.6 MB, sha256 `b7b26e50ea917d3696aec87f932def2bf5f890f5770e441d59c162c6f4c92a77`), which carries
  named regions such as Pantanal, Amazon basin and Caatinga. It has no biomes: the Cerrado is not in it.
- Derived with `node tools/derive-gazetteer.mjs <admin0> <admin1> <regions>`: one entry per feature,
  `{name, alt, kind: country|state|region, country, bbox, label}`; bbox rounded outward to 0.01 deg,
  west > east when the place is narrower across the antimeridian; label is Natural Earth's label point
  for countries and states and an inside point near the middle for regions; a name repeated within a
  kind keeps its largest feature. 5,848 entries, 818 KB; sha256
  `869d8fc40fec7b637f9932fa67df7cec01535346f70c8d05a523037e0882f4dd`.
- A place enters `places.json` when its label point lies in the domain, so Bolivia or the Gran Chaco
  never open an area the data does not cover, while Pantanal (label point in Brazil) does, and its
  calendar says which share of the box lies outside.

