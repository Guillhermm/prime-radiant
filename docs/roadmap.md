# Prime Radiant roadmap

Status: accepted by the team on 2026-11-14 (planning ritual). Open decisions in section 12 hold their default until the team changes them. No hour estimates: sizes are S (one focused session), M (two or three), L (several, worth slicing again before starting).

## 0. How to read this

- Two humans, two tracks, one contract. **Kaue owns data and science** (pipeline, `core/` science, data hosting, live ingestion). **Guilherme owns the web app** (shell, inputs, views, the Vercel function). The axis can be swapped wholesale (decision H1); nothing else depends on who is who.
- Task ID: `M{milestone}-{K|G}{n}`. K = Kaue, G = Guilherme. Every deliverable task has exactly one owner.
- "Done" for any task: code + tests in the same commit, `node --test` green, docs that describe it true, reviewed by the other human (or the dev master) before merge.
- ✅ marks a task whose deliverable is built and tested (checked 2026-11-15, after merging Kaue's data and science work). M2-G1 and M3-G1 run on core stubs until M2-K1 and M3-K3 land. Not marked: M1-K4 (the publish ran on 2026-11-15, by hand and through the `publish-data` workflow; still open: the contract test on a real-tile sample and the cell hand-checked against the FIRMS map), M1-G12 (production serves real data; still open: `docs/demo.md` rewritten for real data).
- Size points used for balancing: S = 1, M = 2, L = 3.
- Gates are not tasks of one person; they are checkpoints a milestone cannot pass without. Each gate names who triggers it.

## 1. Stack and repository layout

- One language: JavaScript ES modules, Node.js standard library only, zero runtime dependencies. Tests: `node --test`. No bundler, no TypeScript.
- Pipeline fallback: if the one-year spike (M0-K4) shows Node too slow or too memory-hungry, the pipeline alone moves to Python + DuckDB after an advisory check. Science stays in `core/` (JS) either way, so the contract does not change.
- Science runs in `core/`, in the browser, per AOI (area of interest). The pipeline only bins and counts. A method change bumps `method.version` without rebuilding data.

```
prime-radiant/
  core/            pure functions, shared by web, pipeline tests and api      (owner K)
    schema.js        validators: manifest, tile, Series, CalendarCell
    grid.js          lon/lat -> cell id, cell center, tile id, edge rules
    tiles.js         columnar tile reader, coverage lookup
    aggregate.js     seriesForAoi(bbox, tiles, manifest) -> {modis, viirs}
    harmonize.js     R, fallback, per-month/annual, CI -> Series harmonized
    baseline.js      median of same month over earlier complete years
    anomaly.js       percentile rank (ties split), year rank, flags      (M2)
    calendar.js      toCalendar(series...) -> CalendarCell[]; KPI model
    csv.js           aggregate CSV with metadata header, injection guard
    caveats.js       caveat ids, texts, "preliminary" flags
    index.js         public surface (stubs in M0, real by M1)
  pipeline/        FIRMS archive CSV -> tiles + manifest                     (owner K)
    read.js, bin.js, dedupe.js, write-tiles.js, manifest.js, build.js, publish.js
    live.js          NRT CSV -> data/live tiles                               (M3)
  api/live.js      Vercel function, keyed FIRMS proxy                          (owner G, M3, cuttable)
  web/                                                                        (owner G, except sensor-chart.js)
    index.html, styles/tokens.css, styles/app.css
    src/state.js     QueryState <-> URL hash
    src/views.js     VIEWS config (enabled tabs)
    src/data-source.js  manifest + tile loading, cache, fixture swap
    src/components/  app-shell, query-bar, aoi-form, map-picker, date-range, calendar-grid,
                     legend, cell-detail, kpi-strip, data-table, caveat-strip, method-drawer,
                     states, export-menu, sensor-chart (K), anomaly-layer, flag-list (K), live-view
  fixtures/        tiny manifest, 3 tiles, 50-row FIRMS CSV per sensor, NRT CSV, live response (owner K)
  test/            unit tests sit next to the module (*.test.js); test/integration, test/e2e
  docs/            method.md (K), ux.md (G), data.md (K), deploy.md (K), README links
  .github/workflows/ci.yml (G), live.yml (K, M3)
  vercel.json      headers, CSP (K in M0, G edits from M1)
```

Ignored from the first commit: `raw/` (archive downloads), `data/` (generated tiles), `.vercel/`, `.env*`, `node_modules/`, `test-results/`.

## 2. The contract (frozen at sync point S0, end of M0)

Owned by Kaue in `core/schema.js` + `fixtures/`, reviewed by Guilherme. A change after S0 is one commit touching schema, fixtures and the contract test together, reviewed by the other human.

| Item | Shape (summary) | Producer | Consumer |
|---|---|---|---|
| Manifest `data/manifest.json` | `{schema:1, dataVersion, generated_at, base_url, grid:{res:0.1, tile_deg:10, coarse_res:1}, month0:"2000-01", last_month, granularity:"month", coverage:{modis:[from,to], viirs:[from,to], noaa20:[from,to]} (a sensor with no records in the build: `null`, every value of it null), partial_months:{modis:[YYYY-MM], viirs:[], noaa20:[]}, acquisition_days?:{Terra|Aqua|SNPP|NOAA20:{YYYY-MM:days}} (docs/data.md), satellites:{era...}, tiles:[ids], domain?:{id:"ne10m-brazil", version, file:"domain.json", res:0.1}, citation, caveats:[ids]}` (`domain` is optional: absent means no clipping) | pipeline | data-source, core |
| Tile `data/tiles/{res}/x{tx}y{ty}.json` | columnar `{cell[], month[], modis[], viirs[], noaa20[]}` (Terra-only counts sit in `modis`); `cell = row*100+col` from integer lon*10/lat*10 within the tile; month = index from `month0`; sparse: absent = 0 inside coverage, outside coverage = null | pipeline | core/tiles |
| Domain `data/domain.json` | `{rows:{latIdx:[[c0,c1],...]}}`: 0.1 deg cells that intersect the polygon, as inclusive column runs per row (latIdx 0 = lat -90, column 0 = lon -180; sorted, non-touching). A 1 deg cell is in when any of its fine cells is. Rule: inside coverage and inside the domain, absent row = 0; outside the domain every value is null (a series for an AOI wholly outside is all null, flagged `outside-domain`; partly outside, sums cover the in-domain part and the series is flagged `partial-domain`). Records outside the polygon are dropped at build (`clipped_by_domain`); the polygon is `pipeline/domain/brazil.geojson` | pipeline | core/domain, core/aggregate |
| Series | `{id: modis|viirs|harmonized|baseline|anomaly|live, unit:"fire-cell-days", start:"YYYY-MM", values:(number|null)[], flags?, method:{id,version}, comparable:boolean}`; null = sensor not operating, 0 = none detected (hard rule) | core | web |
| CalendarCell | `{year, month, value, status: observed|harmonized|no-data|partial, estimated:boolean, flags?:string[], median?, rank?}` | core/calendar | calendar-grid, cell-detail, kpi-strip |
| QueryState | `{bbox:[w,s,e,n], name: string|null, from:"YYYY-MM", to:"YYYY-MM", view: calendar|sensors|anomalies|live, layer: counts|anomaly}` in URL hash `#aoi=bbox:w,s,e,n&name=..&from=..&to=..&view=..&layer=..` | web/state | web |
| Core API | `seriesForAoi`, `harmonize`, `baseline`, `toCalendar`, `kpis`, `toCsv` (M1); `anomaly`, `flags`, `yearRank` (M2); live tiles share the tile shape with `day[]` instead of `month[]` (M3) | core | web |
| Live (M3) | `data/live/manifest.json` + tiles with `day[]`; `GET /api/live?bbox=&days=` -> Series `id:"live", comparable:false` | pipeline/live, api | live-view |

Contract test (`test/integration/contract.test.js`): fixtures validate against schema; from M1-K4 on, a sample of real tiles and the real manifest validate too.

## 3. Milestones and gates

| Milestone | Goal | Exit gates |
|---|---|---|
| M0 | Bootstrap, contract, spikes, archive request, hosting set up | S0 contract freeze; designer gate D0 (IA + phone wireframes); spike decisions recorded |
| M1 | A + B fully working on real archive data, tested, excellent UX, deployed | SF gate V1 (unit, binning, harmonization, median, caveats); designer gate D1 in running app; QA sign-off Q1; security pass; public URL; demo script |
| M2 | C anomalies | SF gate V2 (baseline, percentile rank, flag rule, n>=9); D2; Q2 |
| M3 | D live | SF gate V3 (live labeling, comparability, provisional wording); secret scan + `npm audit` equivalent; D3; Q3 |

Gate rules:
- **SF gates (V1-V3)**: run `second-foundation:validate` on the method note and the known-answer tests. Triggered by Kaue. Until a number's gate passes, the UI shows it labeled "preliminary" and it does not ship to the public URL as final. If V1 rejects harmonization, M1 ships with the raw-only toggle (MODIS-only and VIIRS-only, no harmonized line) and A uses MODIS-only units 2002-07 onward (mathematician's simpler route), so A+B stay complete.
- **Designer gates (D0-D3)**: `foundation:designer` reviews wireframes (D0) and the running app at desktop and ~400px phone width (D1-D3). Triggered by Guilherme.
- **QA gates (Q1-Q3)**: `foundation:qa` checks every acceptance criterion of the milestone and the pyramid shape. Triggered by whoever integrates (Guilherme for M1, M2; Kaue for M3).
- **Review**: every diff reviewed by the dev master before QA.

## 4. M0: bootstrap, contract, spikes

### Kaue

✅ **M0-K1 Request FIRMS archive data (day 1, first thing)** · S · depends: none
- Deliverable: requests submitted in the FIRMS Archive Download Tool (Earthdata login, delivered by email): (a) global, one full year (2023 default), MODIS C6.1 standard + VIIRS S-NPP standard, for the spike; (b) demo region (H3 default) full span, MODIS from 2000-11-01, VIIRS S-NPP 2012-01-20 to 2026-11-02; (c) global full span per sensor (requested now because of email lag; used only if the spike passes). NOAA-20 standard from 2018-04-01 requested for the demo region, and globally with (c), for the factor K (H11).
- Acceptance: request confirmations saved (ids only, no credentials) in `docs/data.md` with request date, product, version, region, span; download location `raw/` is gitignored.
- Tests: none (no code). Docs: `docs/data.md`.
- Files: `docs/data.md`, `.gitignore`.

✅ **M0-K2 Contract: schema, fixtures, contract test** · M · depends: M0-G1
- Deliverable: `core/schema.js` (validators for manifest, tile, Series, CalendarCell, returning a list of errors), `core/grid.js` (cell id, center, tile id, edge rule: a point on a cell edge belongs to the cell to its east/north; lon 180 maps to -180), `fixtures/manifest.json`, three tiles (one crossing the antimeridian neighbor, one with an empty month, one coarse), `fixtures/firms-modis-50.csv`, `fixtures/firms-viirs-50.csv` hand-built with known answers, `fixtures/README.md` listing the expected totals.
- Acceptance: every fixture validates; an invalid tile (mismatched column lengths, month out of range, negative count) fails with a named error; grid known answers pass (cell edge, +/-180, poles clamp).
- Tests: unit `core/schema.test.js`, `core/grid.test.js`; integration `test/integration/contract.test.js`.
- Files: `core/schema.js`, `core/grid.js`, `fixtures/*`, `test/integration/contract.test.js`.

✅ **M0-K3 Core API stubs** · S · depends: M0-K2
- Deliverable: `core/index.js` exporting the M1 API with real signatures. `seriesForAoi` already real on fixtures if cheap, else stub; `harmonize`, `baseline`, `toCalendar`, `kpis`, `toCsv` return fixture-shaped values tagged `method.id:"stub"`. JSDoc on every export is the interface doc.
- Acceptance: every stub output passes `core/schema.js`; Guilherme can render every M1 view from `core/index.js` + fixtures without waiting for real science.
- Tests: unit `core/index.test.js` (shape of each export).
- Files: `core/index.js`, `core/*.js` (stubs).

✅ **M0-K4 One-year size spike** · M · depends: M0-K1 (a) delivered, M0-K2
- Deliverable: throwaway-quality but tested streaming prototype (`pipeline/read.js` + `bin.js` minimal) run on the global year: tile count, total raw and brotli size at 0.1 and 1 deg, wall time, peak memory (`/usr/bin/time -l`), detections in vs fire-cell-days out. Recorded in `docs/data.md` with the decision: global vs demo region (H3), Node vs Python fallback, Vercel static vs external tile host (with M0-G3).
- Acceptance: numbers measured, not estimated; extrapolation to the full span stated as extrapolation; decision written.
- Tests: unit tests on the prototype parsers carry into M1-K1.
- Files: `pipeline/read.js`, `pipeline/bin.js`, `docs/data.md`.

✅ **M0-K5 Method note draft and early science questions** · S · depends: none
- Deliverable: `docs/method.md` v0: unit (fire-cell-days, type=0, 0.1 deg assumption), dedupe rules, era definitions, R definition, fallback rule, baseline rule, caveat list. Open questions sent to the Second Foundation now so answers arrive before M1-K6: parent region definition for the fallback (default: enclosing 10 x 10 deg tile, then continent box), threshold 129 MODIS fire-cell-days, physicist on NOAA-20 after S-NPP, MODIS confidence cutoff (default: no confidence filter, stated).
- Acceptance: every assumption labeled as assumption; each open question has an owner in the Second Foundation and a default.
- Tests: none. Files: `docs/method.md`.

✅ **M0-K6 Vercel project, domain and headers** · S · depends: M0-G1
- Deliverable: repository stays under Guilherme's personal GitHub (`Guillhermm/prime-radiant`, H6: Vercel Hobby cannot connect an org-owned repo), Kaue as collaborator; Guilherme creates the Vercel Hobby project on his account (the account owner) serving `web/` with a placeholder page; Kaue writes `vercel.json` with CSP (`default-src 'self'`, `connect-src` including the tile host and map tile host once chosen), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`; domain bought only after M1 deploys on `*.vercel.app` (H7).
- Acceptance: placeholder reachable on the preview URL; headers verified with `curl -I` and recorded in `docs/deploy.md`.
- Tests: `test/integration/headers.test.js` asserts `vercel.json` contains each required header.
- Files: `vercel.json`, `docs/deploy.md`.

### Guilherme

✅ **M0-G1 Repository bootstrap and CI** · S · depends: none
- Deliverable: `package.json` (`"type":"module"`, `test` = `node --test`, no dependencies), `.gitignore` (see section 1), repo `CLAUDE.md` pointing to the team contract and naming the layout, `README.md` skeleton (what it is, how to run, data citation placeholder), `.github/workflows/ci.yml` running `node --test` on push and PR, a trivial passing test.
- Acceptance: CI green on the first commit; `node --test` runs locally with zero installs.
- Tests: one smoke unit test.
- Files: `package.json`, `.gitignore`, `CLAUDE.md`, `README.md`, `.github/workflows/ci.yml`.

✅ **M0-G2 Web contract: QueryState, URL codec, VIEWS** · M · depends: M0-G1
- Deliverable: `web/src/state.js` (parse/serialize hash, validate bbox lat in [-90,90], lon in [-180,180], west<east, south<north, area cap H4, dates within manifest span; invalid input falls back to defaults with a reported reason), a tiny subscribe/notify store, `web/src/views.js` (`VIEWS` list; disabled views not rendered).
- Acceptance: round trip parse(serialize(s)) == s; every invalid case has a test; unknown keys ignored.
- Tests: unit `web/src/state.test.js`, `web/src/views.test.js`.
- Files: `web/src/state.js`, `web/src/views.js`.

✅ **M0-G3 Tile hosting spike** · S · depends: M0-K4 numbers (can start before with a guess)
- Deliverable: decision H5 between (a) tiles deployed with the site through `vercel deploy` from a local or CI build (tiles stay gitignored, so a git-triggered Vercel build cannot see them) and (b) Cloudflare R2 public bucket with CORS for the app origin, `manifest.base_url` pointing to it. Check Vercel Hobby upload and file-count limits and R2 free tier against the spike sizes; check whether the Vercel CLI honors `.gitignore` or only `.vercelignore` (unverified). Record in `docs/deploy.md`.
- Acceptance: one fixture tile fetched from the chosen host by a page on the preview URL with the CSP from M0-K6, no console errors.
- Tests: none beyond the manual check; the fetch path is tested in M1-G5.
- Files: `docs/deploy.md`.

✅ **M0-G4 Map spike** · S · depends: M0-G1
- Deliverable: decision H8 between vendored Leaflet 1.9.x + OpenStreetMap tiles (check the OSM tile usage policy and Leaflet advisories first) and a zero-dependency SVG world outline (Natural Earth 1:110m, public domain) with pan/zoom and custom rectangle draw. Prototype the rectangle draw on the chosen base.
- Acceptance: decision recorded with the policy and advisory check results (scanned, not assumed); prototype draws a bbox and emits `[w,s,e,n]`.
- Tests: unit on the pixel-to-lonlat conversion if SVG; none if Leaflet.
- Files: `docs/ux.md`, `web/vendor/` (if Leaflet).

✅ **M0-G5 UX spec and designer gate D0** · S · depends: none
- Deliverable: `docs/ux.md`: IA (tabs Calendar | Sensors | Anomalies | Live, Query bar, caveat strip, Method drawer, Export), desktop and phone wireframes (ASCII or SVG), color tokens (viridis 7 log bins, zero = lowest bin labeled 0, no data = gray hatch, PuOr 11 diverging, Okabe-Ito series), states (empty, zero, loading, error, live unavailable), a11y checklist (WCAG 2.2 AA). Run `foundation:designer` review.
- Acceptance: D0 passed; C and D slots visible in wireframes; contrast of every token pair computed.
- Tests: none. Files: `docs/ux.md`, `web/styles/tokens.css`.

### M0 parallel tracks

| Kaue | Guilherme |
|---|---|
| M0-K1 archive request (day 1, first) | M0-G1 bootstrap + CI (day 1, first) |
| M0-K5 method note + science questions | M0-G5 UX spec, D0 |
| M0-K2 contract (needs K1) | M0-G2 QueryState + VIEWS |
| M0-K6 Vercel + headers (needs K1) | M0-G4 map spike |
| M0-K3 core stubs | M0-G3 tile hosting spike (finalized with G4 numbers) |
| M0-K4 size spike (when data arrives) | (free: start M1-G1 shell) |

Load: K 1+2+1+2+1+1 = 8, G 1+2+1+1+1 = 6, plus G starts M1 early.

Sync point **S0 (contract freeze)**: both review schema, fixtures, stubs, QueryState together; spike decisions H3, H5, H8 recorded. If M0-K4 is still waiting on email delivery, S0 freezes the contract anyway; the spike result only changes extent and hosting, not shapes.

## 5. M1: A + B on real data, deployed

### Kaue (data, science, B view)

✅ **M1-K1 Pipeline reader and filter** · M · depends: S0, M0-K4
- Deliverable: `pipeline/read.js` streams `.csv` and `.csv.gz` with `node:readline` + `zlib`, header-driven columns (MODIS and VIIRS headers differ), row validation (lat/lon range, date, time HHMM, satellite, type), keeps `type=0` only, emits `{sensor, satellite, lat, lon, utcDay}`; counts of rejected rows by reason.
- Acceptance: known answers: non-vegetation types excluded; 23:59 and 00:01 UTC fall on different days; Feb 29 parsed; malformed row rejected and counted, never thrown away silently.
- Tests: unit `pipeline/read.test.js` on fixture CSVs.
- Files: `pipeline/read.js`.

✅ **M1-K2 Binning and dedupe** · M · depends: M1-K1
- Deliverable: `pipeline/bin.js` + `dedupe.js`: cell via `core/grid.js`; one fire-cell-day per (sensor family, cell, UTC day): Terra and Aqua merged into `modis` from 2002-07 (Terra-only era kept separate per the method note, default: excluded from R, shown as MODIS Terra-only in B), S-NPP only into `viirs`, NOAA-20 into its own `noaa20` family for K (H11), NOAA-21 excluded; monthly aggregation; one year at a time in memory.
- Acceptance: Terra+Aqua same cell/day counted once; points on a cell edge go to the east/north cell; lon +180 equals -180; NOAA-20 rows reach `noaa20`, never `viirs`.
- Tests: unit `pipeline/bin.test.js`, `pipeline/dedupe.test.js`.
- Files: `pipeline/bin.js`, `pipeline/dedupe.js`.

✅ **M1-K3 Tile writer, coarse level, manifest** · M · depends: M1-K2
- Deliverable: `pipeline/write-tiles.js` (columnar, sorted by cell then month, sparse), 1 deg coarse level summed from 0.1 deg, `pipeline/manifest.js` with per-sensor coverage, `last_month`, partial-month marker, citation (FIRMS + LANCE acknowledgment text, DOIs per product), `pipeline/build.js` CLI (`node pipeline/build.js --in raw/ --out data/ --years 2002-2026`).
- Acceptance: build of the fixture CSVs produces tiles byte-identical to golden files; coarse sums equal fine sums per 1 deg cell; manifest passes schema.
- Tests: integration `test/integration/pipeline.test.js` (50-row CSV -> golden tiles).
- Files: `pipeline/write-tiles.js`, `pipeline/manifest.js`, `pipeline/build.js`, `fixtures/golden/*`.

**M1-K4 Full build, publish, data sanity** · M · depends: M1-K3, M0-K1 (b or c) delivered, H5
- Deliverable: full run on the chosen extent; `pipeline/publish.js` uploads to the host chosen in H5 (credentials from env only, never logged); sanity report in `docs/data.md`: per-year detections in vs fire-cell-days out per sensor, rejected-row counts, sizes, a hand-checked cell compared against FIRMS map for one day.
- Acceptance: real manifest + sample tiles pass the contract test; Guilherme's app loads real tiles from `base_url`; numbers in the report reproducible from the command recorded.
- Tests: contract test extended to a real-tile sample (path from env, skipped with a message when absent so CI stays offline).
- Files: `pipeline/publish.js`, `docs/data.md`, `test/integration/contract.test.js`.

✅ **M1-K5 Tile reader and AOI aggregation** · M · depends: S0
- Deliverable: `core/tiles.js` (decode columnar tile into lookups), `core/aggregate.js` `seriesForAoi(bbox, tiles, manifest)`: cells whose centers fall inside bbox, coarse level when AOI exceeds a cell-count threshold (default: > 20,000 fine cells), antimeridian-safe, returns `modis` and `viirs` Series with null outside each sensor's coverage and 0 inside it; `tilesForBbox(bbox, manifest)` so the web loads only what is needed.
- Acceptance: fixture AOI totals equal the hand-computed totals in `fixtures/README.md`; months before S-NPP start are null for viirs, not 0; coarse and fine give the same totals for a whole-degree AOI.
- Tests: unit `core/tiles.test.js`, `core/aggregate.test.js`.
- Files: `core/tiles.js`, `core/aggregate.js`.

✅ **M1-K6 Harmonization** · L · depends: M1-K5, M0-K5 answers
- Deliverable: `core/harmonize.js`: R = sum(V)/sum(M) over overlap months with zero-MODIS months included; fallback to parent region when AOI MODIS sum < threshold (from Second Foundation, default 129); per-calendar-month R only where each month passes threshold, else annual R; CI by resampling whole years (seeded RNG so tests are deterministic); harmonized Series = VIIRS where VIIRS operates, MODIS x R elsewhere, `estimated:true` on scaled months; result carries R, CI, which level was used, n years.
- Acceptance: V=[0,6,3], M=[0,2,1] gives R=3; harmonized overlap total equals VIIRS total; MODIS sum 0 triggers fallback; per-month vs annual switch at the threshold; CI deterministic for a fixed seed.
- Tests: unit `core/harmonize.test.js` (all mathematician known answers).
- Files: `core/harmonize.js`.
- Slice before starting: (a) R + harmonized series, (b) fallback + per-month, (c) CI.

✅ **M1-K7 Baseline and current month vs median** · S · depends: M1-K5
- Deliverable: `core/baseline.js`: median of the same calendar month over earlier complete years, current year excluded, partial months excluded, years used returned with the value.
- Acceptance: a year never enters its own baseline; even-count median averages the two middles; no complete earlier years returns null with a reason.
- Tests: unit `core/baseline.test.js`.
- Files: `core/baseline.js`.

✅ **M1-K8 Calendar and KPI view-models** · S · depends: M1-K6, M1-K7
- Deliverable: `core/calendar.js` `toCalendar` (status observed | harmonized | no-data | partial, estimated flag, median per cell) and `kpis` (total in range, current month value, median, years used, R and level, sensor era).
- Acceptance: no-data and zero never collapse; partial month labeled; KPI numbers equal the series they come from.
- Tests: unit `core/calendar.test.js`.
- Files: `core/calendar.js`.

✅ **M1-K9 CSV export and caveat catalog** · S · depends: M1-K6
- Deliverable: `core/csv.js` `toCsv(kind, series, meta)`: kinds calendar (year, month, value, status), sensors (year, month, sensor, value with sensor column, raw + harmonized in one schema); `#` metadata header with unit, AOI, sensor set, method id/version, R, data version, citation; text cells starting with `= + - @`, tab or CR prefixed with a single quote (OWASP formula injection guard; numbers untouched); RFC 4180 quoting. `core/caveats.js`: ids, short and long text, `preliminary` flag driven by gate status.
- Acceptance: export of fixture AOI matches golden CSV; injection cases escaped; null exports as empty, 0 as 0.
- Tests: unit `core/csv.test.js`, `core/caveats.test.js`.
- Files: `core/csv.js`, `core/caveats.js`.

✅ **M1-K10 Sensors view (B)** · L · depends: M1-K6, M1-G1, M1-G10 (DataTable)
- Deliverable: `web/src/components/sensor-chart.js`: hand-built SVG, three series (MODIS #0072B2, VIIRS #E69F00, harmonized black thick), dash patterns + direct labels, era line at 2012-01-20 and at 2026-11-02, toggles per series, keyboard focus on points with readable value, R + level + CI shown with plain method note, sparse-overlap warning chip, `DataTable` alternative, export buttons wired to `core/csv` through Guilherme's export menu.
- Acceptance: each series toggles independently; screen reader reads month, sensor, value; low-confidence chip appears when fallback was used; renders at 400px without horizontal page scroll.
- Tests: unit on the scale/path builder (`sensor-chart.test.js`, pure functions); integration view-model on fixtures.
- Files: `web/src/components/sensor-chart.js`.

✅ **M1-K11 Science gate V1** · S · depends: M1-K6, M1-K7, M1-K9, M1-K4
- Deliverable: `docs/method.md` v1 + known-answer tests + real-data R for the demo AOIs submitted to `second-foundation:validate`; fixes applied; `caveats.js` `preliminary` flags cleared for what passed.
- Acceptance: written verdict per item (unit, binning, R, fallback, CI, median, caveat wording); anything not passed stays labeled or is cut per the gate rule.
- Files: `docs/method.md`, `core/caveats.js`.

### Guilherme (web app, deploy)

✅ **M1-G1 App shell, tabs, layout, themes** · M · depends: M0-G2, M0-G5
- Deliverable: `web/index.html`, `app-shell.js` (top bar: name, tabs from VIEWS, Method, Export), Query bar slot, caveat strip slot, main view slot; desktop and phone layouts (view select on phone); light + dark from tokens; `rem` everywhere; reduced motion respected. DOM built with `textContent`, no `innerHTML`.
- Acceptance: tab switch updates hash and back button works; disabled views absent; layout holds at 400px and 1440px.
- Tests: unit on any pure layout helpers; e2e smoke covers it (M1-G12).
- Files: `web/index.html`, `web/styles/app.css`, `web/src/components/app-shell.js`, `web/src/main.js`.

✅ **M1-G2 AOI form and presets** · M · depends: M1-G1
- Deliverable: `aoi-form.js`: lat/lon inputs (full keyboard path), inline validation messages from `state.js`, area cap message, presets (demo AOIs from H3), explicit Apply on phone.
- Acceptance: every invalid input shows a specific message bound with `aria-describedby`; Apply disabled while invalid; presets set hash.
- Tests: unit on input-to-bbox parsing; integration on fixtures.
- Files: `web/src/components/aoi-form.js`, `query-bar.js`.

✅ **M1-G3 Map picker** · M · depends: M0-G4, M1-G2
- Deliverable: `map-picker.js` on the base chosen in H8: draw/redraw one rectangle, sync both ways with the form, collapsible on desktop, full screen from the Area sheet on phone, attribution shown.
- Acceptance: drawn bbox equals form values to 0.1 deg; keyboard users can skip the map entirely; tile host in CSP.
- Tests: unit on projection math (SVG) or on the bbox snapping helper.
- Files: `web/src/components/map-picker.js`, `vercel.json` (CSP).

✅ **M1-G4 Date range picker** · S · depends: M1-G1
- Deliverable: `date-range.js`: from/to month inputs bounded to manifest span, presets All / last 10 years / this year.
- Acceptance: from > to rejected; presets clamp to coverage.
- Tests: unit.
- Files: `web/src/components/date-range.js`.

✅ **M1-G5 Data source** · M · depends: M0-K3, M0-G3
- Deliverable: `data-source.js`: load manifest, `tilesForBbox`, fetch with in-memory cache and concurrency limit, fixture mode (`?fixtures=1` or test flag), abort on new query, typed errors (network, schema-invalid, out-of-coverage); validates every tile with `core/schema.js` before use.
- Acceptance: invalid tile surfaces an error state, never a wrong number; switching AOI cancels stale requests; first result under 3 s on the demo AOI on a cold cache (measured, recorded).
- Tests: unit with injected `fetch`; integration against fixtures served from disk.
- Files: `web/src/data-source.js`.

✅ **M1-G6 Calendar grid and legend (A)** · L · depends: M1-G1, M0-K3 (stubs), M0-G5
- Deliverable: `calendar-grid.js`: year x month grid, `role="grid"` with roving tabindex, arrow/Home/End navigation, `aria-label` per cell (month, year, value, status, estimated), sticky year column, viridis 7 log bins, zero distinct label, no-data hatch, estimated corner mark, partial month mark; `legend.js` with bins and the unit; table view toggle.
- Acceptance: no-data never painted as zero; all keys work; 1.6rem cells on phone; contrast tokens from D0.
- Tests: unit on binning (`bins.test.js`) and cell label builder; integration on fixture calendar.
- Files: `web/src/components/calendar-grid.js`, `legend.js`, `web/src/bins.js`.
- Slice before starting: (a) static render + bins + legend, (b) keyboard + aria, (c) phone layout.

✅ **M1-G7 Cell detail** · M · depends: M1-G6
- Deliverable: `cell-detail.js`: side panel on desktop, bottom sheet on phone: value, status, source sensor, R applied if estimated, median and years used, caveats relevant to that cell.
- Acceptance: opens on Enter/tap, closes on Escape, focus returns to the cell; all content via `textContent`.
- Tests: unit on the detail view-model; e2e covers open/close.
- Files: `web/src/components/cell-detail.js`.

✅ **M1-G8 KPI strip** · S · depends: M1-G1, M0-K3
- Deliverable: `kpi-strip.js` from `core.kpis`: current month vs median (number and years used), total in range, sensor era; swipe cards on phone.
- Status: replaced in design 3 by `verdict-row.js` (latest month vs median, peak month, busiest year, total in range).
- Acceptance: median shown with n years; null shows "not enough history", not 0.
- Tests: unit on formatting.
- Files: `web/src/components/kpi-strip.js`.

✅ **M1-G9 Caveats, Method drawer, states** · M · depends: M1-G1, M1-K9 (catalog; stubs until then)
- Deliverable: `caveat-strip.js` (persistent, non-dismissible), `method-drawer.js` (focus-trapped, renders `docs/method.md` content via `core/caveats.js` texts and citation from manifest), `states.js` (empty with example AOI chips, zero detections, skeleton with `aria-busy`, inline error with retry).
- Acceptance: caveats visible without a click on every view; "preliminary" label shown while the gate flag is set; drawer traps and restores focus.
- Tests: unit on focus-trap helper; e2e covers drawer.
- Files: `web/src/components/caveat-strip.js`, `method-drawer.js`, `states.js`.

✅ **M1-G10 Data table and export menu** · S · depends: M1-G1, M0-K3
- Deliverable: `data-table.js` (generic accessible table used by the calendar table view and the sensors view), `export-menu.js` (calls `core.toCsv`, downloads via Blob with a filename named after the selected range).
- Acceptance: table headers scoped; export file equals `core.toCsv` output byte for byte.
- Tests: unit on filename and table model.
- Files: `web/src/components/data-table.js`, `export-menu.js`.

✅ **M1-G11 End-to-end smoke tests** · M · depends: M1-G6, M1-K10, decision H9
- Deliverable: two or three e2e tests on fixtures served locally: open default, enter AOI via form, see calendar, open a cell, switch to Sensors, export CSV and compare with golden; one phone-width run.
- Acceptance: run offline in CI; no live network.
- Tests: `test/e2e/*.test.js`.
- Files: `test/e2e/`, `.github/workflows/ci.yml`.

**M1-G12 Deploy, security pass, demo script** · M · depends: M1-K4, M1-G11, gates V1 D1 Q1
- Deliverable: production deploy on the H5 path, headers rechecked with `curl -I`, `npm audit` (or "no dependencies: nothing to audit" stated with the lockfile shown), secret grep over repo and built site, CSP violations checked in the console, `docs/deploy.md` true, `README.md` true (what is built vs planned), 3-minute demo script in `docs/demo.md`.
- Acceptance: public URL serves A+B on real data; demo script walks one AOI end to end.
- Tests: headers integration test green against `vercel.json`.
- Files: `docs/deploy.md`, `docs/demo.md`, `README.md`.

### M1 load balance

K: 2+2+2+2+2+3+1+1+1+3+1 = 20. G: 2+2+2+1+2+3+2+1+2+1+2+2 = 22. Balanced within one M.

### M1 parallel tracks

| Kaue | Guilherme |
|---|---|
| M1-K1 reader (if spike data arrived) or M1-K5 aggregation (if not) | M1-G1 shell (on stubs) |
| M1-K2 binning + dedupe | M1-G6 calendar grid (on stubs) |
| M1-K5 aggregation | M1-G2 AOI form, M1-G4 dates |
| M1-K3 tiles + manifest | M1-G5 data source (fixtures) |
| M1-K6 harmonization (a, b, c) | M1-G3 map picker |
| M1-K7 baseline, M1-K8 view-models | M1-G7 cell detail, M1-G8 KPI strip |
| M1-K4 full build + publish | M1-G9 caveats, drawer, states; M1-G10 table + export |
| M1-K9 CSV + caveat catalog | (S1: switch data source to real tiles) |
| M1-K10 sensors view | M1-G11 e2e |
| M1-K11 gate V1 | M1-G12 deploy, security, demo |

Sync points:
- **S1 real data**: M1-K4 publishes; Guilherme points `data-source` at `base_url`; both run the app on the demo AOIs. Contract test on real tiles green.
- **S2 real science**: stubs in `core/index.js` replaced by M1-K5..G9; Guilherme's views unchanged by construction (same shapes). Any visual surprise (bins vs real ranges) fixed by the owner of the view.
- **S3 M1 release**: V1 verdict in, D1 designer review on the running preview at 400px and desktop, Q1 QA sign-off, then M1-G12 deploys. Integration owner: Guilherme.

## 6. M2: C anomalies

### Kaue

✅ **M2-K1 Anomaly core** · M · depends: M1-K7, V1
- Deliverable: `core/anomaly.js`: percentile rank of a month against its baseline with ties split evenly, year rank by total, flag when rank >= 90th percentile (threshold from V2, default 0.9) and n >= 9 baseline years; Series `id:"anomaly"`; KPI additions: count, rank of year, current-month anomaly.
- Acceptance: mathematician known answers (MAD 0 sparse case handled, ties split, n < 9 never flagged, year excluded from own baseline).
- Tests: unit `core/anomaly.test.js`.
- Files: `core/anomaly.js`, `core/calendar.js`, `core/index.js`.
- Status: built with the V2 fixes A1-A6 (S-NPP outage months filled from NOAA-20 x K, single-sensor confirmation, scaled year ranks, sparse-baseline labels).

**M2-K2 Flagged periods list and figures** · M · depends: M2-K1, M1-G10
- Deliverable: `flag-list.js` (flagged months grouped into consecutive periods, rule stated on screen, keyboard selectable, selects the cell in the grid via QueryState), rank-of-year cards reusing KPI strip patterns.
- Acceptance: selecting a period focuses the first cell; rule text matches `docs/method.md`.
- Tests: unit on period grouping; integration on fixture.
- Files: `web/src/components/flag-list.js`.
- Status: in progress. Built: `core/periods.js` (`flaggedPeriods`, `flagRuleText`) with unit tests. Planned: `flag-list.js` and the rank-of-year cards.

✅ **M2-K3 Science gate V2** · S · depends: M2-K1
- Deliverable: baseline + anomaly section of `docs/method.md` validated; caveat for small n and sparse areas.
- Acceptance: written verdict; unvalidated items stay "preliminary".
- Files: `docs/method.md`, `core/caveats.js`.
- Status: passed with caveats on the re-check of 2026-11-15 (`docs/gates/V2.md`).

### Guilherme

✅ **M2-G1 Anomaly layer in the grid** · M · depends: M2-K1 (stub first), M1-G6
- Deliverable: `anomaly-layer.js`: layer toggle "Counts | vs median" (QueryState `layer`), PuOr 11 diverging centered on median, flag marker independent of color, legend for the diverging ramp, cell labels include percentile rank.
- Acceptance: colorblind-safe check; flag readable without color; no-data stays hatch.
- Tests: unit on diverging bin mapping and labels.
- Files: `web/src/components/anomaly-layer.js`, `legend.js`.

**M2-G2 Anomalies tab, e2e, release** · S · depends: M2-G1, M2-K2, V2
- Deliverable: enable `anomalies` in VIEWS, e2e test for toggle + flag list, D2 review, Q2, deploy, docs true (README marks C built).
- Acceptance: gates passed; demo script extended.
- Tests: `test/e2e/anomalies.test.js`.
- Files: `web/src/views.js`, `test/e2e/`, `docs/demo.md`, `README.md`.

Load: K 2+2+1 = 5, G 2+1 = 3. Guilherme absorbs M1 polish from D1/Q1 findings here; if none, Guilherme starts M3-G1.

| Kaue | Guilherme |
|---|---|
| M2-K1 anomaly core | M2-G1 anomaly layer (on stub) |
| M2-K2 flag list | M1 polish backlog / M3-G1 early |
| M2-K3 gate V2 | M2-G2 tab, e2e, release |

Sync **S4**: anomaly stub replaced by real core; V2, D2, Q2; deploy.

## 7. M3: D live

### Kaue

✅ **M3-K1 NRT gridding** · M · depends: M1-K3
- Deliverable: `pipeline/live.js`: reads FIRMS global NRT CSVs or the NRT Shapefile `.dbf` (keyless; MODIS, S-NPP and NOAA-20, 7-day default), same grid and cell rules, no type filter possible (NRT has no `type`), daily tiles in `data/live/` with `day[]`, live manifest with fetch time and source files.
- Acceptance: fixture NRT CSV -> golden live tiles; missing `type` column handled; provenance in manifest.
- Tests: unit + integration `test/integration/live.test.js` on fixtures (no network).
- Files: `pipeline/live.js`, `fixtures/nrt-*.csv`.

**M3-K2 Daily GitHub Action** · M · depends: M3-K1, H5
- Deliverable: `.github/workflows/live.yml` on a daily cron: download NRT CSVs, run `pipeline/live.js`, publish live tiles to the H5 host (R2 upload, or redeploy if tiles ship with the site); upload credentials as GitHub secrets only; failure keeps the previous live data and marks `fetched_at`.
- Acceptance: a manual `workflow_dispatch` run publishes; a failed download leaves the last good data in place.
- Tests: pipeline tests cover logic; the workflow is checked by one manual run, recorded in `docs/deploy.md`.
- Files: `.github/workflows/live.yml`, `docs/deploy.md`.

**M3-K3 Live comparison model and gate V3** · S · depends: M3-K1, M1-K7
- Deliverable: `core` function for current season vs historical band (per-day cumulative or monthly to date vs median and interquartile band of earlier years, method from V3), Series `live` with `comparable:false` unless V3 says otherwise; caveat "near-real-time, not yet harmonized, unfiltered by type".
- Acceptance: V3 verdict written; wording on screen matches it.
- Tests: unit on band computation.
- Files: `core/live.js`, `core/caveats.js`, `docs/method.md`.
- Status: in progress. `core/live.js` is built and the V3 verdict is written (`docs/gates/V3.md`: rejected until fixes L1-L6 land). The fixes are in the code (daily share table `core/data/daily-share.json`, partial days, NOAA-20 x K series, VIIRS-era band, type-0 share, live caveats); the V3 re-check is not recorded yet, so the live view stays preliminary.

### Guilherme

✅ **M3-G1 Live view** · M · depends: M3-K3 (stub first), M1-G5
- Deliverable: `live-view.js`: current season line vs historical band, current month overlay in the calendar with a "provisional" badge, `fetched_at` shown, "Live unavailable" state when live data is missing or stale (default: older than 48 hours).
- Acceptance: never mixed into harmonized totals; stale and missing both degrade cleanly.
- Tests: unit on staleness rule and band path; integration on fixture live tiles.
- Files: `web/src/components/live-view.js`, `data-source.js`.

✅ **M3-G2 Keyed proxy api/live (cuttable)** · M · depends: M3-G1, H10
- Deliverable: `api/live.js` Vercel function: `MAP_KEY` from env (set in the Vercel dashboard by the account owner, Guilherme), bbox validated and snapped to 0.5 deg, days 1-2, whitelisted sources, `Cache-Control: s-maxage=900, stale-while-revalidate`, `fetch` injected for tests, errors never echo the upstream URL (it contains the key); WAF rate-limit rule if Hobby allows it (unverified).
- Acceptance: key never in response, logs or client bundle (grep of built site and a response capture); invalid bbox 400.
- Tests: unit with stubbed fetch, including an upstream error containing the key.
- Open (gate V3): `api/live.js` counts a fire-cell-day from the union of NOAA-20, NOAA-21 and MODIS NRT, which is not comparable to the single-sensor band and includes NOAA-21, which the archive excludes. Align it with `core/live.js` (NOAA-20 x K) before the live view uses the proxy.
- Files: `api/live.js`, `vercel.json`.

**M3-G3 Live release** · S · depends: M3-G1, M3-K2, V3
- Deliverable: enable `live` in VIEWS, e2e on fixture live data, secret scan, audit, D3, Q3, deploy, README and demo true.
- Tests: `test/e2e/live.test.js`.
- Files: `web/src/views.js`, `test/e2e/`, `README.md`, `docs/demo.md`.

Load: K 2+2+1 = 5, G 2+2+1 = 5.

| Kaue | Guilherme |
|---|---|
| M3-K1 NRT gridding | M3-G1 live view (on fixtures) |
| M3-K2 daily Action | M3-G2 keyed proxy (if not cut) |
| M3-K3 comparison model, V3 | M3-G3 release |

Sync **S5**: first real Action run feeds the preview; V3, D3, Q3; integration owner Kaue (owner of the Action); Guilherme, as Vercel account owner, runs the production deploy.

## 8. Whole-project load

| | M0 | M1 | M2 | M3 | Total |
|---|---|---|---|---|---|
| Kaue | 8 | 20 | 5 | 5 | 38 |
| Guilherme | 6 | 22 | 3 | 5 | 36 |

Guilherme's slack in M0 and M2 is the buffer for D1/Q1 findings, which land mostly on the web side.

## 9. Critical path

M0-K1 archive request (email lag) -> M0-K4 spike -> H3/H5 decisions -> M1-K1..G3 pipeline -> M1-K4 full build + publish (S1) -> M1-K6 harmonization on real data -> M1-K11 gate V1 -> D1 + Q1 -> M1-G12 deploy.

Off the critical path thanks to the contract: the whole web track (runs on fixtures and stubs until S1/S2), M1-K5..G9 (run on fixtures), M2 and M3.

## 10. Risks and mitigations

| Risk | Effect | Mitigation |
|---|---|---|
| Archive delivery by email is slow | Pipeline and V1 starve | Request on day 1 (M0-K1), smallest request first; all pipeline code built on fixtures; demo region before global |
| Tile volume too big for Vercel Hobby or the browser | No global coverage | Spike measures first; demo region; coarse 1 deg level; R2 host (H5) |
| Node pipeline too slow or memory-heavy | Build does not finish | One year at a time; per-year dedupe set; Python + DuckDB fallback for the pipeline only |
| V1 rejects harmonization or R too unstable | B's main line cannot ship | Raw-only toggle + MODIS-only units for A (mathematician's simple route); A+B still complete |
| Small or zero ratio in sparse AOIs | Absurd harmonized numbers | Threshold + parent-region fallback; sparse chip; CI shown |
| null vs 0 confusion at era edges | Wrong numbers on screen | Hard rule in schema; tests at S-NPP start and end; distinct no-data hatch |
| S-NPP ended 2026-11-02 | VIIRS series stops; current months have no VIIRS | Post-S-NPP months use NOAA-20 x K (estimated mark, H11); K needs NOAA-20 archive data for every extent served |
| Archive standard product lags NRT by weeks to months (unverified) | "Current month" in A is not the calendar month | Manifest `last_month` drives the label "latest archived month"; D fills the gap |
| Two humans editing shared files | Merge conflicts | Directory ownership (section 1); shared files (`package.json`, `README.md`, `core/schema.js`, `vercel.json`) changed only in small dedicated commits |
| Map tile policy or library advisory | Map picker blocked | H8 check in M0; SVG fallback; form path always complete |
| API key leak in D | Security incident | Cron path needs no key; proxy cuttable; key tests in M3-G2; secret scan in M3-G3 |
| GitHub Action cron delay or failure | Stale live data | Stale threshold + "Live unavailable" state; last good data kept |
| CSV formula injection | Spreadsheet attack | Guard in `core/csv.js`, tested |

## 10a. After M3: global extent

**M4-K1 Chunked pipeline for a global build** · L · depends: M1-K4, H3 changed to global
- Why: the R2 side is not the limit (global tiles are estimated near 660 MB, two versions kept, against 10 GB free), the build is. Global raw CSVs are estimated near 40 GB, likely more than the free disk of a GitHub-hosted runner, and the Brazil build already peaks near 1 GB of memory.
- Deliverable: the build processes the input in parts (by year, or by region and year), downloads one file, folds it into the running tile totals and deletes it before the next, so disk holds one raw file at a time and memory stays bounded; `tools/fetch-country.mjs` and the `publish-data` workflow follow the same loop; the global source (all country files or an archive request) chosen and recorded in `docs/data.md`.
- Acceptance: a chunked build of the Brazil files gives tiles byte-identical to today's one-pass build; peak disk and memory recorded for one global year; the workflow fits in the runner's disk and time limits, or the build moves off Actions with the reason recorded.
- Gate: global extent goes through a Second Foundation check before it ships (V1 was validated on Brazil).
- Tests: integration test that chunked and one-pass builds agree on the fixtures.
- Files: `pipeline/build.js`, `tools/fetch-country.mjs`, `.github/workflows/publish-data.yml`, `docs/data.md`.

**M4-G1 Rank named regions in the place picker** · M/L · depends: place picker step 1, polygon AOIs
- Status: proposed 2026-11-15, after step 1 (which ranks 1 deg squares labeled with country and state).
- Deliverable: the pipeline sums fire-cell-days per state or province (Natural Earth admin-1, global, public domain) into `overview.json`; the drawer lists the hottest regions by total, with density (per 1,000 cells) as a second column and a later sort toggle; opening a region uses its polygon as the area, not its bounding box (today an area is a bbox, which would pull in the neighbors), so polygon AOIs in `core/` come first. Biomes or ecoregions after that, once a source with a checked license is chosen.
- Gate: a Second Foundation check of the per-region sums and of density as a ranking.

**M4-K2 Fire outlook (machine learning), proposed, not decided** · L · depends: M2 (C) done, a decision by the humans on scope and stack
- Status: idea under discussion (2026-11-15), nothing built. To be discussed before it is sliced.
- What it would predict: not individual ignitions (in Brazil most are human), but expected activity per 0.1 deg cell and per month, for example the chance that next month lands above the cell's median. Shown as an experimental layer on the calendar and the map.
- Simplest route first: climatology (the calendar's median) is the baseline any model must beat; then logistic regression or gradient-boosted trees (LightGBM or XGBoost) on our lagged fire-cell-days plus free drivers (CHIRPS rainfall, ERA5 temperature and humidity, MODIS NDVI). A spatiotemporal neural network only if the simple model falls short.
- Cost: money near zero (training fits a laptop; predictions precomputed monthly and published as tiles to R2, so serving stays static). Time: L at least, mostly in aligning the climate data to our grid and in validation without leakage (train on the past, test on the future, spatial blocks).
- Open for the humans: training needs Python (scikit-learn or LightGBM) outside the app, while the repository is JavaScript with zero dependencies; the browser would only read precomputed tiles.
- Gate: a Second Foundation gate before anything is shown, with the skill score against climatology visible next to the layer. Check first what INPE (Risco de Fogo) and GWIS already publish.

## 11. Cut list (in order, A and B stay complete)

1. M3-G2 keyed proxy (cron path covers D).
2. D entirely, if M2 runs late (C before D, as the humans ordered).
3. Per-calendar-month R (annual R only); CI by resampling (show R and level only, if V1 agrees).
4. Global extent (demo region only).
5. Coarse 1 deg level (only if AOI cap is lowered to match).
6. KPI swipe cards and bottom sheets on phone (stacked layout instead; phone must still work).
7. Dark theme (light only; tokens keep the door open).
8. Date presets beyond All.
9. Product ideas not in scope: MODIS continuity timeline, before/after 2012 proof (add only with slack).

Never cut: AOI by form and map, calendar with accessible ramp and no-data distinction, current month vs median, CSV export, sensor toggle with method note and caveats, tests, gates.

## 12. Open decisions for the humans (default assumed until they say otherwise)

| ID | Decision | Default |
|---|---|---|
| H1 | Who owns which track | Kaue data/science, Guilherme web; swap is free |
| H2 | Granularity | Monthly; current partial month labeled partial |
| H3 | Grid extent and demo region | Decided 2026-11-14: Brazil full history (FIRMS yearly country CSVs, 2000-2025) + global 2026 from archive Shapefiles (`docs/data.md`); the pipeline reads CSV and DBF. Global history only if added later |
| H4 | Max AOI size | 0.1 deg for AOI up to 20,000 cells, coarse 1 deg above, hard cap at continent scale (exact number after spike) |
| H5 | Where tiles live | Decided 2026-11-15: Cloudflare R2 bucket `prime-radiant-data` behind `data.primeradiantdata.com`, served same-origin through a Vercel rewrite of `/data/`; published by `pipeline/publish.js` from the `publish-data` workflow (`docs/deploy.md`, Data hosting) |
| H6 | Repository owner | Decided 2026-11-14: Guilherme's personal GitHub (`Guillhermm/prime-radiant`), Vercel project on Guilherme's Hobby account, Kaue collaborator |
| H7 | Domain | Bought after M1 is live on `*.vercel.app`; name to choose |
| H8 | Map base | Vendored Leaflet + OSM if policy and advisory checks pass, else SVG Natural Earth outline |
| H9 | e2e tool | Decided: headless Chrome driven over the DevTools Protocol with Node built-ins (no dependency); tests skip when Chrome is absent |
| H10 | D scope | Cron path only; keyed proxy built only with slack |
| H11 | Post-S-NPP VIIRS | Decided 2026-11-14: after 2026-11-02 VIIRS continues as NOAA-20 x K, K = sum(S-NPP)/sum(NOAA-20) per AOI over full months 2018-04 to 2026-10 (`docs/method.md` 4.4), marked estimated; needs NOAA-20 binned as its own family in M1-K2 and gate V1 |
| H12 | CSV export content | AOI aggregates, not raw detection rows |
| H13 | Harmonization route | R per AOI with fallback; MODIS-only route kept as the V1 fallback |

## 13. Notes from slicing (seams found)

- The first plan had the live cron writing `data/live` tiles and redeploying. Tiles are generated files and cannot be committed, so a git-triggered redeploy cannot see them. H5 resolves this: R2 (Action uploads, no redeploy) or a CLI deploy from the Action that rebuilds history tiles too, which needs the raw archive in CI. R2 is the simpler of the two for D.
- "Parent region" for the fallback was undefined during planning. Default in M0-K5: enclosing 10 x 10 deg tile, then a continent box; the Second Foundation decides.
- Vercel Hobby is single-user: account-dashboard actions (env vars, domain) sit with the account owner (Guilherme under H6), so the Vercel project creation in M0-K6 and the M3 `MAP_KEY` setup are done by Guilherme; Kaue keeps `vercel.json` and the headers test.
- Each human drives their own Foundation sessions on their track; the dev master reviews both, and the senior-dev seats are briefed per slice from this document.
