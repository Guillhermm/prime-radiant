# Fixtures

Hand-built test data with known answers. Not real detections. Span: 2023-01 to 2023-06
(month index 0..5). MODIS covers all six months; VIIRS covers 2023-03 onward, so VIIRS is
`null` (sensor not operating) for indexes 0 and 1. Month index 3 (2023-04) has no detections
in any fixture: an empty month, `0` where a sensor operated.

Tile layout mirrors `data/tiles/{res}/x{tx}y{ty}.json`. Cell id = `row * perSide + col`
(perSide 100 at 0.1 deg, 10 at 1 deg). Absent rows mean `0` for a covered sensor and `null`
for an uncovered one. Present rows follow the same rule: `null` exactly outside the sensor's
coverage, an integer count inside it (`validateTile` checks this when given the manifest).

| File | What |
|---|---|
| `manifest.json` | Span, coverage, tile list (0.1 tile ids). Coarse tiles reuse the same ids under `tiles/1/`; the fixtures ship only `1/x17y13`. |
| `tiles/0.1/x0y15.json` | Antimeridian tile (lon -180..-170, lat 60..70). Cell 0 holds lon -180 and lon 180. |
| `tiles/0.1/x17y13.json` | Empty month tile (lon -10..0, lat 40..50), built from the two CSVs. |
| `tiles/1/x17y13.json` | Coarse (1 deg) tile: the sum of the 0.1 deg fire-cell-days of `0.1/x17y13` per 1 deg cell and month (coarse cell = `floor(row/10)*10 + floor(col/10)`). A coarse count is a sum of fine fire-cell-days, not a distinct (coarse cell, day) count. |
| `firms-modis-50.csv`, `firms-viirs-50.csv` | 50 rows each, all inside tile x17y13. |

## Expected totals

Unit: fire-cell-days = distinct (cell, acquisition date) per sensor. Duplicate rows of the same
cell and date (two overpasses) count once.

CSV cells (row, col) -> cell id: (0,0)=0, (0,1)=1, (10,20)=1020, (50,49)=5049, (99,99)=9999.
Cell centers are lon `-9.95 + 0.1*col`, lat `40.05 + 0.1*row`.

- MODIS: 50 rows, 35 fire-cell-days. 7 per month in indexes 0, 1, 2, 4, 5; 0 in index 3.
  Per cell per month: cell 0 = 3, cell 1 = 2, cell 1020 = 1, cell 5049 = 1, cell 9999 = 0.
- VIIRS: 50 rows, 35 fire-cell-days. Index 2: 15 (3 per cell), index 4: 10, index 5: 10 (2 per cell); index 3: 0;
  indexes 0 and 1: `null`.
- Tile `x17y13` (0.1): 23 rows; modis sum 35, viirs sum 35 (nulls excluded).
- Tile `x0y15` (0.1): 3 rows; modis sum 3, viirs sum 4.
- Tile `1/x17y13` (coarse): 18 rows; modis sum 35, viirs sum 35, equal to the fine tile. Fine cells 0 and 1
  merge into coarse cell 0 (modis 3+2 = 5 per month); 1020 -> 12; 5049 -> 54; 9999 -> 99.
  VIIRS per month: index 2 = 6, 3, 3, 3 (cells 0, 12, 54, 99), indexes 4 and 5 = 4, 2, 2, 2.

## FIRMS archive CSV columns

MODIS: `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type`
VIIRS: `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type`

Verification: the attribute NAMES were checked online against the FIRMS attribute page
(earthdata.nasa.gov, MODIS and VIIRS active fire attributes), which lists Latitude, Longitude,
Brightness/Bright_ti4, Scan, Track, Acq_Date, Acq_Time, Satellite, Confidence, Version,
Bright_T31/Bright_ti5, FRP, Type (MODIS standard only), DayNight. NOT verified: the exact header
row of a real archive download (column order, lower-case spelling, the `instrument` column, and
`type` for VIIRS). Those come from memory; confirm against the first real download (M0-K1/K4).
