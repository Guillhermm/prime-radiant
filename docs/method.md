# Method note

Version: v0 draft (M0-K5), with the first answers of the Second Foundation
(2026-11-14). Nothing here has passed the V1 gate. Every statement carries a status:
**verified** (checked against a primary source), **supported** (consistent with sources,
not checked end to end), **assumption** (a choice the team made) or **unverified**.

## 1. Unit: fire-cell-days

- One fire-cell-day = one 0.1 x 0.1 degree grid cell with at least one hotspot on one
  UTC day, for one sensor family. Monthly values are sums of fire-cell-days.
- **Assumption, unverified**: 0.1 degree reduces the effect of the MODIS (~1 km) and
  VIIRS (375 m) pixel-size difference compared with raw detection counts. No source
  found yet.
- Only FIRMS `type = 0` (presumed vegetation fire) counts. **Verified** codes: 0 =
  presumed vegetation fire, 1 = active volcano, 2 = other static land source, 3 =
  offshore (FIRMS product pages for MCD14DL and VJ114IMGTDL). `type` exists only in the
  standard (archive) product, not in near-real-time data.
- **Unverified lead**: VIIRS monthly archive files before version 3 (reprocessed in
  May 2025) labeled some static sources as type 0. Check that downloads are version 3.
- **Verified** (physicist, MODIS C6/C6.1 Fire User Guide 1.0, Giglio et al. 2021, sec.
  2.1 and 5.5): FIRMS MODIS `version` 6.2 / 6.03 / 61.03 are standard MCD14ML
  Collection 6 and 6.1 files; C6.1 made no change to active fire detection, so
  2000-2026 is one series for counts and R. VIIRS `version` 2 is Collection 2 standard.
- **Caveat, verified on Brazil data**: MCD14ML v03 (2018 onward) improved hotspot
  typing. Type 2 (static sources) rises from about 0.2-0.9% of MODIS rows (2008-2017)
  to 1.2-2.7% (2018-2025), so the `type = 0` filter puts a small labeling step in the
  MODIS series at 2018 that is not a change in burning. Default kept: `type = 0`, step
  stated. Option for V1: a static-source cell mask built from 2018+ type 2 and applied
  to every year.
- No confidence filter. **Supported**: FIRMS gives no fixed cutoff, and the MODIS 0-100
  score and VIIRS l/n/h classes come from different tests (FIRMS FAQ). R absorbs a
  steady false-alarm excess over the overlap. Optional sensitivity check at V1:
  recompute R with MODIS confidence >= 30.

## 2. Binning and dedupe

- Cell assignment uses `core/grid.js`: a point on a cell edge belongs to the cell to its
  east/north; longitude 180 is the same as -180.
- Day is the UTC acquisition date (`acq_date`).
- MODIS family = Terra + Aqua merged: one fire-cell-day per (cell, UTC day).
- VIIRS family = S-NPP only. NOAA-20 is binned as its own family, used only for K
  and after S-NPP (section 4.4).

## 2b. Spatial domain

- Every input, history and 2026 alike, is clipped by point-in-polygon to one Brazil
  outline (Natural Earth admin-0 10m, v5.1.2, public domain; `pipeline/domain/`). A
  0.1 degree cell is in the domain when it intersects the outline; outside, every value
  is null (no data), never 0. **Assumption**: the FIRMS country files use a border close
  to Natural Earth's; detections between the two lines are dropped and counted.

## 3. Eras

**Verified** against the FIRMS FAQ and the NASA outage alert of 2026-11-02.

| Era | Span | Use |
|---|---|---|
| MODIS Terra only | 2000-11-01 to 2002-07-03 | Shown in Sensors as Terra-only; excluded from R, from MODIS x R and from the baseline |
| MODIS Terra + Aqua | 2002-07-04 onward | MODIS series and R overlap |
| VIIRS S-NPP | 2012-01-20 to 2026-11-02 15:40 UTC | VIIRS series and R overlap |
| VIIRS NOAA-20 | 2018-04-01 onward | K overlap, and VIIRS continuation after S-NPP (section 4.4) |

Partial months for either sensor (2002-07, 2012-01, 2026-11, any outage month) are
excluded from R and from the baseline.

## 4. Harmonization

### 4.1 Ratio R

- R = sum(VIIRS) / sum(MODIS) over full overlap months (both sensors complete) for the
  area of interest (AOI), zero-MODIS months included: a ratio of sums.
- Harmonized series = VIIRS where VIIRS operates; MODIS x R from 2002-07 to 2012-01,
  flagged `estimated`. The Terra-only era is not scaled.
- Per-calendar-month R where each month passes the usability rule; otherwise annual R.
- Confidence interval by resampling whole overlap years (seeded). A draw whose MODIS sum
  is 0 has no R and is counted as a failed draw.
- **Supported**: scaling VIIRS against MODIS over the overlap with regional ratios has
  precedent (Chen et al. 2026, ESSD 18, 7535-7555, doi:10.5194/essd-18-7535-2026;
  they scale to burned area at 0.25 deg with type = 0). **Assumption**: our exact
  method (fire-cell-days, 0.1 deg, ratio of sums) is not published; labeled
  "preliminary" until V1.

### 4.2 Usability rule (replaces the 129 threshold)

- **Assumption** (mathematician): R is usable when the 95% CI half-width is at most 25%
  of R and at least 5 overlap years have MODIS above 0. The earlier 129 fire-cell-days
  had no source.

### 4.3 Fallback for sparse areas

- **Assumption** (mathematician): when the AOI R is not usable, use in order (1) the
  union of the 10 x 10 degree tiles the AOI touches, (2) that union plus the
  surrounding ring of tiles, (3) global. Each level must pass 4.2; the result reports
  the level used and the UI shows a low-confidence chip.

### 4.4 After S-NPP

- Decided by the humans (2026-11-14, roadmap H11), **supported** (physicist): months
  after 2026-11-02 continue VIIRS with NOAA-20 x K, marked estimated, where
  K = sum(S-NPP) / sum(NOAA-20) over full months 2018-04 to 2026-10 per AOI. Same
  instrument and orbit; MODIS is ending. K is computed, never assumed to be 1; it
  passes the same usability rule (4.2) and fallback (4.3) as R. Validated at V1.

## 5. Baseline

- Median of the same calendar month over earlier years in which that month is complete.
  A year never enters its own baseline; Terra-only years and partial months are
  excluded; an even count averages the two middle values (**verified**, mathematician).
- At least 5 years are required, else no median is shown.
- With an all-zero history the median is 0: compare by difference or percentile rank,
  never by ratio.

## 6. Caveats (shown on screen)

1. Counts are fire-cell-days, not fires or burned area.
2. Harmonized values before VIIRS are estimates (MODIS x R).
3. No confidence filter is applied.
4. Clouds, smoke and overpass timing hide fires; zero means none detected, not none
   burning.
5. The latest archived month may lag the calendar month.
6. Sparse areas use a regional ratio (low confidence).
7. Near-real-time data cannot be filtered by type (planned, M3).
8. Method not yet validated (preliminary) until gate V1.
9. Data cover Brazil only (Natural Earth 10m outline, v5.1.2). Areas outside read as
   no data; border cells hold only detections inside the outline, so they undercount.

## 7. Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Parent region for the fallback | Answered (assumption): 4.3 |
| Q2 | Usability of R | Answered (assumption): 4.2 |
| Q3 | NOAA-20 after S-NPP | Decided: NOAA-20 x K (4.4) |
| Q4 | MODIS confidence cutoff | Answered (supported): none |
| Q5 | Is the method published | Not as such; precedent exists (4.1) |
| Q6 | Group R by biome instead of tiles | Open, physicist |
| Q7 | 25% CI half-width and 5-year minimums | Open, to set at V1 |
| Q8 | Static-source mask vs the 2018 typing step | Open, V1 |
| Q9 | VIIRS C2 v2 type-0 mislabeling (unverified lead) | Open, reviewer |
