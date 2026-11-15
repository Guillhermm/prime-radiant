# Data

Raw downloads go to `raw/`, which is gitignored. Only request ids and public URLs are
recorded here; never credentials.

## Sources (decided 2026-11-14, global added 2026-11-15)

- **Global, full history (H3 changed 2026-11-15, the `publish-data` default):** the FIRMS
  yearly all-countries zips, public, no login:
  `https://firms.modaps.eosdis.nasa.gov/data/country/zips/{dir}_{year}_all_countries.zip`, same
  `dir` and years as the Brazil table below (48 zips). Listed in FIRMS's own index
  `https://firms.modaps.eosdis.nasa.gov/data/country/yearly_summary_files.txt` (read 2026-11-15:
  238 countries and territories, 10,095 CSVs, 43.5 GB uncompressed; zips 9.75 GB, the largest
  `viirs-jpss1_2024_all_countries.zip` at 401 MB, files dated 2025-06-23). Each zip holds one CSV per
  country with the same columns as the Brazil files (checked on `modis_2000`, 165 CSVs). The build reads
  the CSVs straight out of the zip (`pipeline/zip.js`) and clips nothing. Not verified: whether
  detections outside every country (open ocean) are in any country file.

Earlier extent, two-tier (still buildable with `--scope brazil`):

- **Brazil, full history (calendar, R, baseline):** FIRMS yearly country CSV files,
  public, no login: `https://firms.modaps.eosdis.nasa.gov/data/country/{dir}/{year}/{dir}_{year}_Brazil.csv`.
  Verified on 2026-11-14 (HTTP 200, header read):

  | dir | Sensor | Years | Has `type` |
  |---|---|---|---|
  | `modis` | MODIS Terra + Aqua | 2000-2025 | yes |
  | `viirs-snpp` | VIIRS S-NPP 375 m | 2012-2025 | yes |
  | `viirs-jpss1` | VIIRS NOAA-20 375 m | 2018-2025 | yes (satellite code `N20`) |

  2026 is not published as a country file yet (404 on 2026-11-14).
  **To verify**: the MODIS country file shows `version` 6.2 in its first rows, while the
  archive Shapefile shows 61.03 (Collection 6.1). Which collection the country files
  carry is a question for the Second Foundation.
- **Global, 2026 (size spike, 2026 months for Brazil):** FIRMS Archive Download Tool
  requests delivered as Shapefile zips (the `.dbf` attribute table is read; `.shp` is
  not needed because lat/lon are attributes). Extracted to `raw/firms-2026/`.

  | Request id | Zip | Sensor | Standard (with `type`) | NRT (no `type`) | Records (std / NRT) |
  |---|---|---|---|---|---|
  | 849178 | `DL_FIRE_M-C61_849178.zip` | MODIS C6.1 (61.03) | 2026-01-01 to 2026-08-31 | 2026-09-01 to 2026-11-14 | 2,302,480 / 800,388 |
  | 849181 | `DL_FIRE_SV-C2_849181.zip` | VIIRS S-NPP C2 | from 2026-01-01 | from 2026-08 | 8,859,653 / 6,602,259 |
  | 849179 | `DL_FIRE_J1V-C2_849179.zip` | VIIRS NOAA-20 C2 | from 2026-01-01 | from 2026-08 | 9,559,961 / 7,484,871 |
  | 849180 | `DL_FIRE_J2V-C2_849180.zip` | VIIRS NOAA-21 C2 (not used) | from 2026-01-01 | from 2026-08 | 9,164,378 / 7,191,002 |
  | 849177 | `DL_FIRE_LS_849177.zip` | Landsat NRT, North America (not used) | none | 2026 | 0 / 1,458,735 |

  MODIS spans were measured over every record; VIIRS spans are from the first records
  only and are to be measured by the size spike. MODIS 2026 standard `type` counts:
  0 = 2,163,458, 1 = 6,484, 2 = 120,369, 3 = 12,169.

NRT months (2026-09 onward) have no `type` field, so they cannot be filtered to
vegetation fires; they are not mixed into the archive series (method note, caveat 7).

## Reproduce

- Country files: one `curl -f` per URL above into `raw/country/`.
- Shapefiles: extract only the `.dbf` members of each zip into `raw/firms-2026/`.

## Size spike (M0-K4)

Measured 2026-11-14 on the global 2026 standard (archive) files: MODIS 849178, S-NPP
849181, NOAA-20 849179 (NOAA-21 and NRT not used). Command:
`/usr/bin/time -v node pipeline/build.js --in raw/spike-2026 --out data/spike-2026`
(`raw/spike-2026` holds links to the three `fire_archive_*.dbf` files). WSL2, Node 24.9.

| Measure | Value |
|---|---|
| Archive coverage found | MODIS 2026-01 to 2026-08; S-NPP and NOAA-20 2026-01 to 2026-07 |
| Detections in / kept (`type = 0`) | 20,722,094 / 19,002,112 (1,719,982 other types) |
| Fire-cell-days out | MODIS 1,055,380; S-NPP 2,566,122; NOAA-20 2,829,819 |
| Tiles (0.1 deg and 1 deg) | 301 each |
| Size 0.1 deg, raw / brotli | 16.9 MB / 2.15 MB |
| Size 1 deg, raw / brotli | 1.0 MB / 0.22 MB |
| Largest 0.1 deg tile | `x20y8` (Central Africa), 634 KB raw, 77 KB brotli |
| Wall time / peak RSS | 95 s / 909 MB |

Extrapolation (not measured): the full span is about 39 times these 8 months by
month count (2000-11 to 2026-08), so global history would be about 660 MB raw and
85 MB brotli at 0.1 deg, with the largest tiles near 25 MB raw. Fire-cell-days per
month vary by season and by the sensors operating, so this is an order of magnitude only.

Decision (H3, recorded): Brazil full history plus global 2026, as decided by the humans.
Changed on 2026-11-15 to global full history (see "Global build" below).
Node is fast enough for the pipeline; the Python fallback is not needed. Hosting (H5)
is the web owner's spike (M0-G3) and uses these numbers.

## First Brazil build (2026-11-14)

Command: `/usr/bin/time -v node pipeline/build.js --in raw/country --in raw/spike-2026 --out data/brazil --domain pipeline/domain/brazil.geojson`

| Measure | Value |
|---|---|
| Coverage | MODIS 2000-11 to 2026-08; S-NPP 2012-01 (partial) to 2026-07; NOAA-20 2018-04 to 2026-07 |
| Detections in / kept / other types | 60,764,285 / 58,540,429 / 2,223,856 |
| Clipped by the domain | 18,666,530 (almost all from the global 2026 files; MODIS 2010 is identical with and without the clip) |
| Fire-cell-days | MODIS 4,384,498 + Terra-only 104,509; S-NPP 5,492,486; NOAA-20 3,108,635 |
| Tiles | 17; 0.1 deg 62.7 MB raw / 5.2 MB brotli; 1 deg 3.1 MB / 0.35 MB |
| Wall time / peak RSS | 427 s / 1.4 GB |

Sanity check: Brazil January-August monthly MODIS and S-NPP fire-cell-days for 2026
(global Shapefile source) sit in the same range as 2023-2025 (country CSV source), so
the source switch at 2026-01 shows no visible step. Not yet compared against the FIRMS
map for a hand-picked cell and day (planned in M1-K4).

## Partial months and acquisition days (gate V1, F1)

The pipeline derives `manifest.partial_months` per sensor family (`modis` = Terra and
Aqua, `viirs` = S-NPP, `noaa20` = NOAA-20) from acquisition days. An acquisition day is a
distinct UTC day with at least one archive record of that satellite in the whole input:
any `type` value, before the bbox and domain clip. NRT files never count. A month is
partial for a family when any of its satellites, between its first and last archive month,
has fewer acquisition days than days in that month. The start and end rules (coverage
begins after day 1, ends before the last day) still apply. Aqua's first month (2002-07)
is partial because it starts on the 4th.
`manifest.acquisition_days` (`{Terra: {"YYYY-MM": n}, Aqua, SNPP, NOAA20}`) lists the
counts; it is optional and the schema does not require it.

Assumption: the input is the full archive of the satellite over the whole region the
files cover (country or global), so a day with zero records in the whole input means the
satellite did not acquire. A real acquisition day with no detection anywhere in the input
would read as an outage; at country scale and above this does not happen outside outages.
A build from a small bbox file or a few-day extract marks nearly every month partial.

## Live data (NRT, M3-K1)

`node pipeline/live.js --in <dir|file> --out data/live [--domain pipeline/domain/brazil.geojson]
[--fetched-at ISO] [--download 24h|48h|7d]` turns FIRMS near-real-time files into daily
tiles and a live manifest. `--fetched-at` is the time the files were fetched (default: now);
`--download` fetches the three global files into the first `--in` folder first.

- **Source (verified 2026-11-15, keyless, HTTP 200):** `https://firms.modaps.eosdis.nasa.gov/data/active_fire/`
  `modis-c6.1/csv/MODIS_C6_1_Global_{24h,48h,7d}.csv`, `suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_{...}.csv`,
  `noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_{...}.csv` (NOAA-21: `noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_{...}.csv`, not used).
  Header MODIS: `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight`;
  VIIRS: `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight`.
  No `type`, no `instrument`. Satellite codes: MODIS `T`, `A`; VIIRS `N` (S-NPP), `N20`, `N21`.
  Not verified: the update schedule. On 2026-11-15 the S-NPP 24h and 7d files held a header and no rows
  (S-NPP NRT ends 2026-11-02 in the Shapefile request), so `viirs` coverage can end before the others.
- **Same rules as the archive:** 0.1 degree grid, one fire-cell-day per (family, cell, UTC day), Terra and Aqua merged,
  S-NPP and NOAA-20 separate, NOAA-21 skipped and counted, domain clip. **No type filter is possible**: records enter with
  `allowNoType` and are counted (`records_without_type`); a file with a `type` column is still filtered to `type = 0`
  (`sources[].has_type`). NRT is never mixed into the archive series (method caveat 7).
- **Output** (`data/live/`): `manifest.json`, `domain.json`, `tiles/0.1/x{tx}y{ty}.json` with
  `{cell[], day[], modis[], viirs[], noaa20[]}`; `day` counts from manifest `day0`; `null` outside a sensor's day coverage,
  `0` inside it with no detection. Only the 0.1 degree level is written (no 1 degree). Validators: `validateLiveManifest`,
  `validateLiveTile` in `core/schema.js`. Manifest fields: `fetched_at`, `day0`, `last_day`, `coverage` (first and last day
  per sensor, from every accepted record before the domain clip), `partial_days` (the first day of each coverage, because a
  rolling window starts mid-day, and the last day when it is the fetch day or earlier than `last_day`, i.e. the sensor stopped
  or lags, as S-NPP on 2026-11-02), `sources` (file, records, has_type),
  `skipped`, `duplicates`, `clipped_by_domain`, `fire_cell_days`, `domain`, `citation` (NRT product DOIs), `caveats`.
- **Partial days (gate V3, L2, re-check 2026-11-15):** per sensor and day, all records of the file (before the domain clip, any type) are counted
  separately for the daytime and night-time passes (`daynight` D/N; one pass `A` for a file without the field). A day is
  partial when either pass has under 50% of the median of that pass over the 7 days centered on it, the day itself excluded
  (fewer neighbors at the edges; a day with no records counts 0). The fetch day (day of `fetched_at`) is always partial; so
  is a sensor's last day when it is earlier than the manifest `last_day` (a feed that ended mid-day). The first day is not
  partial by default. Counting before the clip means a day is incomplete only when a feed fails worldwide: a regional gap
  over Brazil shows as a low day, not a missing one (caveat `live-provisional`). The real-run figures below were taken with
  the earlier in-domain rule. Partial days are `null` in the tiles (never 0, never the
  partial count) and listed in `partial_days`; `daily_records` holds `{sensor: {day: {D, N}}}`. Real run (2026-11-14 fetch,
  Brazil): NOAA-20 2026-09-07, 10-27 and 11-05 are partial (daytime pass 0 or almost empty against 2,000-6,700), 10-12 is
  not (day 5,768 against about 5,700-7,200 around it); early August is not flagged. NOAA-20 also lists 10-13 (no night
  pass), 10-18, 10-19, 10-26, 11-03, 11-04, 11-09, 11-10 and the fetch day 11-14; S-NPP 08-03, 08-04, 09-17, 09-25,
  09-26, 10-03, 10-12, 10-13, 10-18 to 10-20, 10-26 and 11-02 (the last day of the feed). MODIS lists 33 days: its passes
  hold few records per day in Brazil and vary between Terra and Aqua, so the 50% test fires often; the live series uses
  NOAA-20 (gate V3, L3).
- **Limit:** coverage is the first to last day with a detection, so an outage day inside the range reads as 0, and
  there is no acquisition-day check as in the archive.
- **Real run (2026-11-15, NRT Shapefiles in `raw/firms-2026/`, Brazil domain):** 22,078,520 records in (every one without
  `type`), 566,140 NOAA-21 skipped, 20,279,616 outside Brazil, 879,968 duplicates. Days 2026-08-01 to 2026-11-14
  (MODIS from 2026-09-01, S-NPP to 2026-11-02, NOAA-20 to 2026-11-14). Fire-cell-days: MODIS 56,330; S-NPP 137,688;
  NOAA-20 158,778. 17 tiles, 3.5 MB raw, 359 KB brotli. 67 s, 420 MB peak RSS, Node 24.

## Daily live job (M3-K2)

`.github/workflows/live.yml` runs once a day (03:30 UTC) and on demand. FIRMS NRT is updated within about 3 hours and its
text files hourly (FIRMS FAQ); the job polls once a day, well under the "at most hourly" limit. It downloads
`J1_VIIRS_C2_Global_7d.csv` (NOAA-20 only, keyless, `User-Agent: prime-radiant-live-job`), builds it with
`pipeline/live.js --domain pipeline/domain/brazil.geojson`, and merges it into the published live data with
`node pipeline/live-merge.js --prev https://data.primeradiantdata.com --next <new build> --out <dir>`: per sensor and day the
new build wins, except its first day (cut mid-day by the rolling window), where the earlier build's day is kept; days
before the 1st of the previous month are dropped; partial days are derived again on the merged daily record counts. A
build over another domain is not merged. The first run has only the last 7 days, so the current month starts with days
not observed (method 6b). Then the tests run and `pipeline/publish.js --live` publishes (docs/deploy.md, "Live data").

## Daily share table (gate V3, L1)

`core/data/daily-share.json` is a derived constant, committed: `share[m][d-1]` is the mean, over complete S-NPP months of
calendar month m+1, of the cumulative fire-cell-days by the end of day d divided by the month's total (a day past the end
of a month is 1). Source: FIRMS archive national S-NPP files `raw/country/viirs-snpp_{2012..2025}_Brazil.csv`, `type = 0`,
Brazil domain clip, the archive dedupe; months in `partial_months.viirs` of a Brazil build's manifest (11 months) and empty
months are left out. 14 years, 168 months. Command (2 minutes), after a Brazil build into `raw/build-brazil`:
`node pipeline/daily-share.js --in raw/country --years 2012-2025 --domain pipeline/domain/brazil.geojson --manifest raw/build-brazil/manifest.json --out core/data/daily-share.json`.
Day 14: July 0.350, September 0.471, November 0.501 (the mathematician's check: about 0.36, 0.48, 0.50).

## Global build (M4-K1)

`node tools/fetch-country.mjs --scope global --out raw/global`, then
`node pipeline/build.js --in raw/global --out raw/build --admin1 <ne_10m_admin_1_states_provinces.geojson>`
(the `publish-data` workflow does both, and checks the admin-1 file's sha256 from
`pipeline/domain/README.md`). Memory stays bounded by one year: once a year's files are binned, its
dedupe set is dropped and its counts move into typed arrays (`pipeline/compact.js`, 5 bytes a
row), and tiles are written one at a time. A month that shows up again after its year was compacted
stops the build with an error.

Measured 2026-11-15 on this laptop (Apple silicon, Node 24) with the three 2023 zips (3.81 GB of
CSV): 47,702,999 detections in, 31,984,614 duplicates, 326 tiles, 150 s, peak RSS 1,026 MB; fine
tiles 24 MB, coarse 2.1 MB, `overview.json` 161 KB (13,322 cells), `places.json` 688 KB (every
gazetteer entry, no domain). The full span is about 11 times that input, so roughly 30 minutes here;
the full global build itself has not been run yet. The Brazil build through the same code gives tiles,
`overview.json` and `places.json` byte-identical to production's `20261115`.

The build also writes `global.json`, the whole-world fallback level (method 4.3) computed with
`core/aggregate.js` from the 1 deg tiles, so the app loads only the coarse tiles of the ring around
an area instead of all of them (`core/schema.js` `validateGlobalLevel`).

## Overview for the place picker (overview.json)

`pipeline/build.js` ends by writing `overview.json` (`pipeline/overview.js`; also runnable alone as
`node pipeline/overview.js --in <build dir>` on an existing build). With `--admin1` each hotspot also carries `place: {country, state}` (`pipeline/places.js`): the state holding most of the square's 100 fine-cell centers. It holds the region label the domain file declares (`region: {id, name}`, null without one) and, for the newest calendar
year a VIIRS sensor covers in full (S-NPP on a tie, NOAA-20 once it has the newer full year), that
one sensor's observed fire-cell-days per 1 deg cell (`cells: [west, south, value]`, summed from the
coarse tiles), the sensor's partial months of that year, and up to 10 hotspots ranked by value and
kept at least 3 deg apart on one axis (`hotspots: [{bbox, value}]`). No harmonization factor enters
it. A build with no full VIIRS year writes none, and the app falls back to drawing or typing an area.
`core/schema.js` `validateOverview` checks it, and `pipeline/publish.js` validates it when present.

First real file (data version `20261115`, 2026-11-15): S-NPP 2025, 793 cells, 274,291
fire-cell-days, 10.9 KB; top hotspot the cell at 7°S to 6°S, 45°W to 44°W (Maranhão) with 3,391.

Science check (Second Foundation mathematician, 2026-11-15): correct, with caveats. Recomputed
independently from `raw/country/viirs-snpp_2025_Brazil.csv` (type 0, own point-in-polygon clip, one
count per 0.1 deg cell and UTC day): four 1 deg cells match exactly ((-45,-7) 3,391; (-43,-4) 2,225;
(-56,-2) 1,167; border cell (-61,4) 1,130), total 274,291, no partial 2025 month. Conditions for the
app: a 1 deg value is a sum of 0.1 deg fire-cell-days (up to 36,500 a year), not days with fire in
the square, so the label names the 0.1 deg cells; the ranking is "most fire activity in that year,
one sensor", not a lasting hotspot claim (only the top cell held its rank across 2023 to 2025); and
border squares count only the part inside the domain.

## Place names for the area field (places.json)

`pipeline/build.js` also writes `places.json` (`pipeline/gazetteer.js`): the countries, states or
provinces and geographic regions of Natural Earth (`pipeline/domain/ne-gazetteer.json`, provenance in
`pipeline/domain/README.md`) whose label point lies in the domain, each with the bbox it opens. Without
a domain every entry is kept. `core/schema.js` `validatePlaces` checks it and the publish validates it
when present. Brazil build (2026-11-15): 51 entries (27 states, 22 regions, 2 countries), 5.8 KB.

