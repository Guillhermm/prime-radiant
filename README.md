# Prime Radiant

A web app that harmonizes MODIS and VIIRS active-fire detections from NASA FIRMS into one
burning-activity calendar per area. Built for the NASA Space Apps Challenge 2026, challenge
"Harmonization of MODIS and VIIRS Hot Spots".

## Status

Web app (Guilherme's track) built on fixture and synthetic demo data, redesigned to design 3: first-run screen that suggests the hottest 1° area and offers the top hotspots as examples, a place picker (heat map of the newest full VIIRS year and ranked hotspots from `overview.json`), latest-month verdict with the Radiant (a polar year-by-month view), calendar grid with year totals and a median row, selected-month panel (docked on desktop, sheet on phone), area and period chips, caveats, method drawer, an Export menu (CSV of the numbers on screen, or a PNG image of the calendar), plus the Sensors, Anomalies and Live tabs. The numbers come from `core/` (Kaue's track): fire-cell-days per month over a Brazil domain, MODIS scaled to VIIRS-equivalent with the ratio R and NOAA-20 continuing S-NPP with K, and the median baseline, all accepted at science gate V1 ([docs/gates/V1.md](docs/gates/V1.md)). Every view is on. Anomalies shows core's percentile ranks, flags, flagged periods and year rank, accepted at science gate V2 ([docs/gates/V2.md](docs/gates/V2.md)). Live compares this month so far (NOAA-20 near-real-time detections scaled to S-NPP with K, over Brazil only) with the same days of earlier VIIRS-era years, accepted with caveats at gate V3 ([docs/gates/V3.md](docs/gates/V3.md)); on synthetic data it shows placeholder numbers tagged Preview. Comparisons with the median (delta, rank, typical year) keep a Preview tag; V1 did not cover them. An area outside Brazil shows an outside-domain state, never zeros.

Deployed at https://primeradiant.zenus.systems (Vercel, from `main`; see [docs/deploy.md](docs/deploy.md)). Production reads its data from a Cloudflare R2 bucket through `/data/`, filled by the manual `publish-data` workflow (FIRMS download, build, tests, publish). The first publish (data version `20261115`, Brazil, 2000-11 to 2025-12) ran on 2026-11-15; nothing synthetic is deployed any more. The workflow now builds the whole world by default (FIRMS all-countries zips, `docs/data.md`, "Global build"); the first global publish (data version `202611151751`) ran on 2026-11-15; its science check, gate G1 ([docs/gates/G1.md](docs/gates/G1.md)), accepted it with caveats except the type filter, so the app tags areas outside Brazil preliminary. Live data comes from the daily `live` workflow (NOAA-20 NRT 7-day file, keyless, merged into a rolling record and published to R2 under `live/`). The keyed proxy `api/live.js` is deployed without `MAP_KEY` (it answers 503) and is not used. Judges: [docs/demo.md](docs/demo.md). Plan: [docs/roadmap.md](docs/roadmap.md).

| Product line | Status |
|---|---|
| A. Burning calendar per area | built: core's counts, harmonization and median baseline (gate V1); real tiles built locally; R2 publish built, first publish pending |
| B. Sensor comparison (MODIS, S-NPP, NOAA-20, harmonized) | built: core's R and K, validated at gate V1, applied to the harmonized series |
| C. Anomalies against a multi-year baseline | built on real data: core's ranks, flags, flagged periods and year rank (gate V2) |
| D. Live season from near-real-time data | Built: daily NRT job, Live view on real data over Brazil (gate V3, accepted with caveats); keyed proxy unused |

## Run

Requires Node.js 22 or later. Locally the app reads the gitignored `data/`. Fill it with synthetic demo data (about 17 MB, labeled "Synthetic demo data" in the app), or with a real build (`node tools/fetch-country.mjs`, then `node pipeline/build.js --in raw/country --out data --domain pipeline/domain/brazil.geojson --admin1 pipeline/domain/brazil-admin1.geojson`, about 3 GB of downloads; the global build is in `docs/data.md`):

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
