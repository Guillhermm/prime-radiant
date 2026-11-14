# Prime Radiant

A web app that harmonizes MODIS and VIIRS active-fire detections from NASA FIRMS into one
burning-activity calendar per area. Built for the NASA Space Apps Challenge 2026, challenge
"Harmonization of MODIS and VIIRS Hot Spots".

## Status

Web app (Guilherme's track) built and QA-approved on fixture data: calendar, area and period selection, map, cell detail, caveats, method drawer, CSV export, plus the anomaly layer and live view behind `?preview=1`. The science in `core/` (Kaue's track) is still stubbed, so numbers are placeholders. Not deployed yet.
[docs/roadmap.md](docs/roadmap.md).

| Product line | Status |
|---|---|
| A. Burning calendar per area | UI built on fixtures; science stubbed (M1) |
| B. Sensor comparison (MODIS, VIIRS, harmonized) | planned (M1, Kaue: sensors view) |
| C. Anomalies against a multi-year baseline | UI built behind `?preview=1`; science planned (M2) |
| D. Live season from near-real-time data | UI and keyed proxy built; live data pipeline planned (M3) |

## Run the tests

Requires Node.js 22 or later. There is nothing to install.

```sh
node --test
```

## Data

NASA FIRMS (Fire Information for Resource Management System) active-fire products, MODIS
Collection 6.1 and VIIRS 375 m. Full citation and LANCE acknowledgment: planned, in
`docs/data.md`.
