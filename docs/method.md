# Method note

Version: v1, passed gate V1 with caveats (`docs/gates/V1.md`); started as v0 draft (M0-K5), with the first answers of the Second Foundation
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

Partial months (2002-07, 2012-01, 2026-11, any outage month: a satellite with fewer
acquisition days than days in the month) are excluded from R and K when partial for
either sensor of the ratio. For the baseline and anomalies, a month is partial when it is
partial for the sensor that supplies it: S-NPP for observed months, MODIS for MODIS x R
months, NOAA-20 for NOAA-20 x K months (`core/partial.js`).

## 4. Harmonization

### 4.1 Ratio R

- R = sum(VIIRS) / sum(MODIS) over full overlap months (both sensors complete) for the
  area of interest (AOI), zero-MODIS months included: a ratio of sums.
- Harmonized series = VIIRS where VIIRS operates; MODIS x R from 2002-07 to 2012-01,
  flagged `estimated`. The Terra-only era is not scaled.
- Per-calendar-month R where each month passes the usability rule; otherwise annual R.
- Confidence interval by resampling whole overlap years (seeded). A draw whose MODIS sum
  is 0 has no R and is counted as a failed draw.
- **Supported, indirect precedent** (reviewer, V1): Chen et al. 2026 (ESSD 18,
  7535-7555, doi:10.5194/essd-18-7535-2026) calibrate VIIRS counts against MODIS-based
  burned area (GFED5) over the 2012-2022 overlap, with regional coefficients at 0.25 deg
  and type = 0. They do not scale VIIRS to MODIS counts. **Assumption**: our exact
  method (fire-cell-days, 0.1 deg, ratio of sums) is not published.
- R window (decided by the humans after V1, 2026-11-14): R uses full overlap months
  from 2012-02 to 2021-12 only, before the MODIS Terra and Aqua orbit drift seen in the
  data from 2022 (physicist, V1; NASA Terra drift notices). For Brazil this moves R
  from 2.44 to about 2.52. K is not affected (both VIIRS satellites keep their orbits).

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
  passes the same usability rule (4.2) and fallback (4.3) as R.
- What the first build actually does (V1, physicist): the S-NPP and NOAA-20 archives
  both end at 2026-07, so 2026-08 (the last archived MODIS month) is MODIS x R,
  flagged `estimated` and `viirs-not-archived`; 2026-09 and 2026-10 are not in the
  series until the archive catches up. NOAA-20 x K applies to months NOAA-20's
  archive covers after S-NPP stops.

### 4.5 Implementation choices (core/harmonize.js)

- The 95% CI is the 2.5th and 97.5th percentiles (linear interpolation) of the successful
  draws, from resampling whole overlap years, as many years per draw as the overlap has.
- A level is usable when all twelve per-calendar-month ratios pass 4.2 (then per-month R
  is applied) or, failing that, the annual ratio passes. Per-month usability counts years
  with MODIS above 0 in that calendar month.
- R and K come from the first usable level; the harmonized series always takes its counts
  from the AOI level. MODIS x R also fills months after S-NPP ends when NOAA-20 is null.
- 2002-07 (partial MODIS) is scaled in the harmonized series but excluded from R.
- Flags on the harmonized series: `estimated` (MODIS x R or NOAA-20 x K);
  `viirs-not-archived` (months after the S-NPP archive ends but before S-NPP stopped,
  2026-08 to 2026-10 in the first build: estimated, not observed); `terra-only`
  (before 2002-07: MODIS operated but the value is null, not scaled); `low-confidence`
  (an applied R or K failed 4.2 at every level); `viirs-outage-filled` (see below).
- S-NPP outage months (gate V2 A1): a month partial for S-NPP (`partial_months.viirs`) that
  falls inside NOAA-20 coverage and is not partial for NOAA-20 is NOAA-20 x K (per-month K
  when K is per-month, else annual), flagged `estimated` and `viirs-outage-filled`, instead
  of the undercounted S-NPP value. R and K fits keep excluding these months. If K is not
  usable or NOAA-20 is missing, the month stays observed (and partial). The supplier of such
  a month is NOAA-20, so the baseline treats it as complete.
- Validated values (gate V1, Brazil build of 2026-11-14 with outage months excluded,
  R window 2012-02..2021-12): Brazil R = 2.516 (95% CI 2.46-2.58, per-month), K = 0.984
  (0.978-0.991); Pantanal box R = 1.89; Amazon arc box R = 2.22 (annual); a small Sao
  Paulo box R = 4.07 (annual).

## 5. Baseline

- Median of the same calendar month over earlier years in which that month is complete.
  A year never enters its own baseline; Terra-only years and partial months are
  excluded; an even count averages the two middle values (**verified**, mathematician).
- At least 5 years are required, else no median is shown.
- With an all-zero history the median is 0: compare by difference or percentile rank,
  never by ratio.

## 5b. Anomalies (M2-K1, gate V2 pending)

- **Assumption**: a month's anomaly is its percentile rank against the same calendar
  month in earlier years only, with the baseline's exclusions (partial months for the
  supplying sensor, Terra-only months, null): rank = (below + equal / 2) / n, so ties
  split evenly and 0.5 is the median. No rank when n < 9 earlier years.
- **Assumption**: a month is flagged when rank >= 0.9 and n >= 9.
- All-zero history: 0 gives rank 0.5 (not flagged); any value above 0 gives rank 1
  (flagged). In sparse areas one fire-cell-day after nine zero years is flagged.
- Year rank: complete years ranked by harmonized total (1 = most; ties share the better
  rank). A year containing a partial or missing month is excluded, with its reason.
- Implementation: `core/anomaly.js` (`anomaly`, `yearRank`); KPIs in `kpis().anomaly`.

## 6. Caveats (shown on screen)

1. Counts are fire-cell-days, not fires or burned area.
2. Values before VIIRS are estimates scaled to VIIRS-equivalent (MODIS x R). R is
   fit on 2012-2021, when fires were fewer than in 2002-2007; applying it to those
   larger fire years is an extrapolation that likely overestimates them (in the overlap
   R falls as burning rises, from 2.75 in 2013 to 2.01 in 2024).
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
| Q5 | Is the method published | Not as such; indirect precedent (4.1) |
| Q6 | Group R by biome instead of tiles | Open, physicist |
| Q7 | 25% CI half-width and 5-year minimums | Kept at V1; results near the line depend on the draws |
| Q8 | Static-source mask vs the 2018 typing step | Open, V1 |
| Q9 | VIIRS C2 v2 type-0 mislabeling (unverified lead) | Open, reviewer |
