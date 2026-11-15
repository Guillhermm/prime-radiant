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
