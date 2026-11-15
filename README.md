# Prime Radiant

A web app that harmonizes MODIS and VIIRS active-fire detections from NASA FIRMS into one
burning-activity calendar per area. Built for the NASA Space Apps Challenge 2026, challenge
"Harmonization of MODIS and VIIRS Hot Spots".

## Status

Web app (Guilherme's track) built on fixture and synthetic demo data, redesigned to design 3 (not yet re-validated by QA): first-run screen with example areas, latest-month verdict with the Radiant (a polar year-by-month view), calendar grid with year totals and a median row, selected-month panel (docked on desktop, sheet on phone), area and period chips, caveats, method drawer, one-click CSV export, plus the Sensors, Anomalies and Live tabs. The numbers come from `core/` (Kaue's track): fire-cell-days per month over a Brazil domain, MODIS scaled to VIIRS-equivalent with the ratio R and NOAA-20 continuing S-NPP with K, and the median baseline, all accepted at science gate V1 ([docs/gates/V1.md](docs/gates/V1.md)). Calendar and Sensors are always on. Anomalies and Live still run on placeholder numbers labeled Preview: they show on synthetic data or with `?preview=1`, and stay hidden with real data. Comparisons with the median (delta, rank, typical year) keep a Preview tag; V1 did not cover them. An area outside Brazil shows an outside-domain state, never zeros.

Deployed at https://primeradiant.zenus.systems (Vercel, built from `main`; see [docs/deploy.md](docs/deploy.md)). Production serves synthetic data generated at build time and shows a "Synthetic demo data" band: no fire count on it is real until the pipeline publishes real tiles (planned). The live proxy is deployed without `MAP_KEY` (it answers 503) and the app does not call it yet: the Live tab shows placeholder data. Judges: [docs/demo.md](docs/demo.md). Plan: [docs/roadmap.md](docs/roadmap.md).

| Product line | Status |
|---|---|
| A. Burning calendar per area | built: core's counts, harmonization and median baseline (gate V1); real tiles built locally, not hosted yet |
| B. Sensor comparison (MODIS, S-NPP, NOAA-20, harmonized) | built: core's R and K, validated at gate V1, applied to the harmonized series |
| C. Anomalies against a multi-year baseline | UI built, labeled Preview; science planned (M2) |
| D. Live season from near-real-time data | UI and keyed proxy built and deployed without a key (503); live data pipeline planned (M3) |

## Run

Requires Node.js 22 or later. No real data exists yet, so generate synthetic demo data first (written to the gitignored `data/`, about 17 MB, labeled "Synthetic demo data" in the app):

```sh
npm run mock && npm run serve
```

Then open `/web/` on the address `serve` prints. `/web/?fixtures=1` loads the tiny test fixtures instead.

## Run the tests

Requires Node.js 22 or later. There is nothing to install.

```sh
node --test
```

## Data

NASA FIRMS (Fire Information for Resource Management System) active-fire products, MODIS
Collection 6.1 and VIIRS 375 m. Full citation and LANCE acknowledgment: planned, in
`docs/data.md`.
