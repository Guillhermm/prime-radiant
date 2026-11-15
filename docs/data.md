# Data

Raw downloads go to `raw/`, which is gitignored. Only request ids and public URLs are
recorded here; never credentials.

## Sources (decided 2026-11-14)

The extent is two-tier:

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
