# Prime Radiant

A web app that harmonizes MODIS and VIIRS active-fire detections from NASA FIRMS into one
burning-activity calendar per area. Built for the NASA Space Apps Challenge 2026, challenge
"Harmonization of MODIS and VIIRS Hot Spots".

## Status

Milestone M0 (bootstrap) in progress. Nothing user-facing is built yet. The plan is in
[docs/roadmap.md](docs/roadmap.md).

| Product line | Status |
|---|---|
| A. Burning calendar per area | planned (M1) |
| B. Sensor comparison (MODIS, VIIRS, harmonized) | planned (M1) |
| C. Anomalies against a multi-year baseline | planned (M2) |
| D. Live season from near-real-time data | planned (M3) |

## Run the tests

Requires Node.js 22 or later. There is nothing to install.

```sh
node --test
```

## Data

NASA FIRMS (Fire Information for Resource Management System) active-fire products, MODIS
Collection 6.1 and VIIRS 375 m. Full citation and LANCE acknowledgment: planned, in
`docs/data.md`.
