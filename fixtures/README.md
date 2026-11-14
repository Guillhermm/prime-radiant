# Fixtures

Hand-built data for the contract. Not real detections. `manifest.json` has `month0` 2000-01
and `last_month` 2012-12 (month index 151 = 2012-08, 152 = 2012-09, 153 = 2012-10).
Coverage: MODIS 2000-11 to 2012-12, VIIRS 2012-02 to 2012-12.

Unit: fire-cell-days, the number of distinct (cell, UTC date) pairs with at least one
detection. Two detections in one cell on one day count once.

## Files

- `firms-modis-50.csv`, `firms-viirs-50.csv`: 50 detection rows each, FIRMS archive columns.
- `tiles/0.1/x12y7.json`: Mato Grosso (lon -60..-50, lat -20..-10). Month 153 has no rows, so every cell is 0 there.
- `tiles/0.1/x0y13.json`: antimeridian side (lon -180..-170, lat 40..50). The row at lon 180.0, lat 45.0 lands in cell 5000 (lon wraps to -180), merged with the detections at lon -179.95.
- `tiles/1/x12y7.json`: the Mato Grosso tile at 1 degree. Cells A and B share a 1 degree cell, so their same-day detections collapse.

## Cells (0.1 degree)

| Name | lat, lon | Tile | Cell |
|---|---|---|---|
| A (+ A2 at -15.04, -55.04, same cell) | -15.05, -55.05 | x12y7 | 4949 |
| B | -15.15, -55.05 | x12y7 | 4849 |
| C | -12.35, -52.45 | x12y7 | 7675 |
| D (VIIRS only) | -18.25, -58.35 | x12y7 | 1716 |
| W | 45.05, -179.95 | x0y13 | 5000 |
| Z | 45.15, -179.85 | x0y13 | 5101 |
| E (edge: lon 180.0, lat 45.0) | 45.0, 180.0 | x0y13 | 5000 (same as W) |

## Expected totals (fire-cell-days at 0.1 degree)

| Sensor | Rows | 2012-08 | 2012-09 | 2012-10 | Total |
|---|---|---|---|---|---|
| MODIS | 50 | 13 (x12y7: 8, x0y13: 5) | 23 (18 + 5) | 10 (0 + 10) | 46 |
| VIIRS | 50 | 16 (12 + 4) | 19 (19 + 0) | 10 (0 + 10) | 45 |

Per cell and month (MODIS / VIIRS), x12y7: A 5/6 (Aug), 10/8 (Sep); B 2/3, 5/6; C 1/2, 3/3;
D 0/1, 0/2. x0y13: W 5/4 (Aug), 3/4 (Oct); Z 5/0 (Sep), 7/6 (Oct).

At 1 degree (`tiles/1/x12y7.json`, Mato Grosso only): MODIS 19, VIIRS 22. Cells A and B
collapse into 1 degree cell 404: MODIS 5 (Aug), 10 (Sep); VIIRS 6, 8. Cell 707 (C): MODIS 1, 3;
VIIRS 2, 3. Cell 101 (D): MODIS 0, 0; VIIRS 1, 2.

AOI check used by the tests: bbox `[-60, -20, -50, -10]` gives MODIS 8 (Aug) and 18 (Sep),
VIIRS 12 and 19; null for MODIS before 2000-11 and for VIIRS before 2012-02.
