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

Planned: measured on the global 2026 standard data once the reader (M1-K1) and binning
(M1-K2) exist.
