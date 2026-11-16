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
- **Static-source mask (gate G2, docs/gates/G2.md, accepted with caveats; thresholds are an
  assumption)**: type 0 still holds gas flares (gate G1). Every build drops type-0 records in
  0.01 degree cells that hold or neighbor a VIIRS type 1 or 2 detection, or where VIIRS type 0
  falls on at least 10 days of a year in at least 2 years (`pipeline/static-mask.js`). MODIS
  does not seed the mask; the mask applies to every sensor and year.
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
  the level used and the UI shows a low-confidence chip. "Global" is everything the build
  holds (Brazil for a Brazil build, the world for a global one); the build precomputes it as
  `global.json` with the same function, so the app does not load every tile.
- In a build with no domain, an R taken from the global level (the whole world, about 2.4)
  is applied but never usable: it mixes biomes and is wrong for boreal forests (Yakutia
  1.31, gate G1), so the series is flagged low confidence. K is not affected (same
  instrument on both satellites).

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

## 5b. Anomalies (M2-K1, gate V2 fixes A2-A6 applied, re-check pending)

- **Rank (displayed)**: the percentile rank of a month against the same calendar month in
  earlier years only, with the baseline's exclusions (partial months for the supplying
  sensor, Terra-only months, null): rank = (below + equal / 2) / n, so ties split evenly
  and 0.5 (50%) is typical. No rank when n < 9 earlier years. The rank is relative to this
  archive and its years, not a standard climatology.
- **Flag rule (A2)**: p = (count of earlier values >= v, plus 1) / (n + 1); a month is a
  candidate when p <= 0.1 and n >= 9. Ties count against, so the false-flag rate is at
  most 10% for every n. At n = 9 only a strict record passes; at 9-10 years a flag means a
  record or near-record.
- **Single-sensor confirmation (A3)**: a candidate is flagged only when the same p rule
  also holds on the raw MODIS series alone (2002-08 on, months partial for MODIS excluded)
  or on the raw VIIRS series alone (months partial for S-NPP excluded, n >= 9). Otherwise
  the month is labeled `cross-era`: rank kept, flag false. Without the raw series
  (`opts.sensors`) nothing can be confirmed, so every candidate is labeled `unconfirmed`.
- **VIIRS-era record**: a month that is not flagged but passes the same p rule on the VIIRS
  series alone (n >= 9; S-NPP partial months excluded, except outage months filled from
  NOAA-20 x K, `viirs-outage-filled`, which count with their filled value) carries the non-flag label
  `viirs-era-record` ("Record since 2012"): a record or near-record of the VIIRS era, not
  against 2002-2011, which are scaled MODIS estimates.
- **Sparse baseline (A5)**: a flag whose earlier pool has median 0 carries the label
  `sparse-baseline` (one fire-cell-day after nine zero years flags).
- All-zero history: 0 gives rank 0.5 (not flagged); any value above 0 gives rank 1.
- **Year rank (A4)**: complete years ranked on two totals, as observed and with each
  partial month multiplied by days in month / days observed (`manifest.acquisition_days`;
  the supplying sensor's satellites, the minimum over them, a satellite month missing
  inside its span counts 0 days). A year is ranked when both totals give the same rank
  (1 = most; ties share the better rank), else it shows `rankRange` [best, worst] with its
  reason. A year is excluded only for a null month, a Terra-only month, or a partial month
  with no acquisition days.
- `confirmedBy: ('modis'|'viirs'|null)[]` names the single sensor that confirmed each flag
  (MODIS checked first). The same filled months count in the VIIRS pool of the A3 check.
- Labels travel in `labels: string[][]` parallel to `values` on the anomaly Series;
  `values` and `flags` keep the contract of the web layer. Caveats: `anomaly-*` items and
  the labels `cross-era`, `unconfirmed`, `viirs-era-record`, `sparse-baseline` in `core/caveats.js`.
- Implementation: `core/anomaly.js` (`anomaly`, `yearRank`, `flagRule`); KPIs in
  `kpis().anomaly` (`flagged`, `crossEra`, `yearRank` with `rankRange`, `reason`).

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
7. Near-real-time data cannot be filtered by type (no `type` field in NRT files). The live view
   states the bias: about 0.4-1.5% extra in Aug-Nov, up to 3-10% in Feb-May (gate V3), unless the
   archive's type-0 share is supplied, in which case live values are scaled by it. The live
   comparison is approximate; see section 6b.
8. Method not yet validated (preliminary) until gate V1.
9. With a domain (the Brazil build), data cover only that outline (Natural Earth 10m, v5.1.2).
   Areas outside read as no data; border cells hold only detections inside the outline, so they
   undercount. A global build has no domain and does not show this caveat.
10. A global build (no domain) shows `global-extent`, tagged preliminary: only Brazil was validated, type 0
   keeps some gas flares and industrial sources, R was not checked by region, cells shrink toward the
   poles, days are UTC (docs/gates/G1.md). The static-source mask (gate G2) removes most flares from the
   next build on; the caveat is revised once that build is published and checked.

## 6b. Live comparison (M3-K3, gate V3 accepted with caveats on 2026-11-15)

- **Series**: NOAA-20 x K for the whole live period (S-NPP units; S-NPP NRT ended 2026-11-02, MODIS is
  never used without x R). `liveSeriesFromTiles` builds it from the live tiles for an AOI and
  declares `units: 'snpp-equivalent'`; `liveComparison` refuses any other unit. Days outside NOAA-20
  coverage, listed in `partial_days`, and the fetch day are null, never 0.
- **Month to date**: from the 1st to the last day with data, the sum of the complete (non-null) days.
  A partial or missing day is skipped, never counted as 0, and later complete days still count;
  `daysCounted` and `daysMissing` are returned, and when more than a third of the days so far are
  missing the result is low confidence. Season: monthly sums of complete days, the same rule for past
  months (a month with partial days gets its increment band, not null), the current month provisional.
  The last complete day is the last complete day in the area. Series id `live`, `comparable: false`,
  never added to harmonized totals.
- **Band**: median and quartiles (type 7) of the same calendar month in earlier years of the VIIRS era
  (2012-02 on, baseline exclusions; at least 5 years, else null) multiplied by the sum of the
  increments (share[d] - share[d-1], share[0] = 0) of exactly the days counted, from the mean cumulative
  share of a month counted by the end of day d (`core/data/daily-share.json`, 12 x 31, from the
  national S-NPP daily data 2012-2025; gate V3 measured leave-one-year-out bias of at most 4% for
  Brazil). This replaces the earlier d/N scaling, which was 20-28% too high in Jun-Aug.
- **Low confidence**: K not usable (method 4.2), more than a third of the days so far missing, fewer than 7 days so far in the month (about 8% error at p90 with one of 7 days missing), or an area under 2,000 in-domain 0.1 degree cells (about 20,000 km2, a Foundation choice not
  yet validated; the Pantanal was 25-30% off either way).
- **Type filter**: with the static-source mask (gate G2) published next to the archive tiles, the live
  job drops NRT records in masked cells instead (manifest `static_mask`), and no type scaling is applied.
  Measured on 2024 VIIRS archive cell-days outside the mask, all types over type 0 only: Algeria 1.0035,
  Iraq 1.0009, Nigeria 1.0003, Angola 1.0000, India 1.0007, Brazil 1.0015 (gate V5). Without the mask,
  live values are multiplied by the archive's type-0 share of their calendar month,
  `core/data/type0-share.json` (S-NPP archive 2012-2025 over Brazil, 0.94 in April to 0.99 in October;
  an assumption, stated on screen). Without either, `liveComparison` keeps the values and states the
  per-month bias (`typeBiasStatement`).
- **Live starting mid-month**: days of the current month before the first live day are not observed
  (`daysNotObserved`), skipped like a missing day, and the band uses only the days counted. Under 7
  counted days (`LIVE_MIN_COUNTED_DAYS`) the month is null with a reason; otherwise it is low confidence.
- **Extent**: with the mask, the whole world (gate V5). The share table was measured over Brazil
  (manifest `share_domain`, `share-domain.json`): an area with at least half its 0.1 degree cells in
  Brazil gets the month to date; any other area is compared by whole past months only, because fires
  ramp differently within a month elsewhere (gate V5: an even split reads Punjab's October 2-3 times low).
  Without the mask, Brazil only (the live build is clipped to the Brazil domain). Partial days are found
  on global record counts, before any clip.
- **Wording**: approximate; NOAA-20 scaled to S-NPP; near-real-time; unfiltered by type; last complete
  day; S-NPP NRT ended 2026-11-02; FIRMS documentation says an Earthdata Login is required; the
  archive follows after a 2-3 month lag (FIRMS FAQ). Caveat items `live-*` in `core/caveats.js`.
- Implementation: `core/live.js`.

## 7. Fire outlook (experimental)

M4-K2, gate V4 passed with caveats after fixes O1-O5 (`docs/gates/V4.md`). Not shown in the web app yet. Code: `core/outlook.js` (features, logistic regression, scores, bootstrap), `core/outlook-gbt.js` (boosted trees), `pipeline/outlook.js` (CLI), the shipped model and its metrics in `core/data/outlook-model.json` (field `model` says which).

- **What it predicts**: per 1 deg cell, the probability that the target month's fire-cell-days are above the cell's baseline median (section 5) for that calendar month. Not ignitions, not fire danger. It uses no rainfall, weather or drought data, so the default model cannot see rain onset, ENSO or policy changes and misses turning points. For fire danger see INPE Risco de Fogo or GWIS.
- **Required UI wording (V4)**: "Experimental. Chance that next month's hotspot activity in this 1 deg cell is above its usual (median) level, learned only from past satellite hotspot counts. No rainfall, weather or drought data. Not a fire-danger rating or a count of fires. For fire danger, see INPE Risco de Fogo or GWIS." Add to it: "Less reliable in transition months (Oct-Dec, Feb-Apr), when rain onset or retreat, which this model cannot see, decides the month." and "Issued <issued_at date>, based on data to <based_on_data_to>." In `hindcast` mode name the target month ("the chance that <target_month>'s ...") instead of "next month's". Never "fire risk" or "fire forecast".
- **Where it is weaker**: persistence is strong in the dry season and weak at the transitions (damped persistence by target month: Jul 0.35, Aug 0.38, Sep 0.39, Nov 0.25, Feb 0.13, Mar 0.17; gate V4 mathematician), so the model is less reliable in Oct-Dec and Feb-Apr.
- **Series**: VIIRS era only, no MODIS x R. S-NPP as observed; NOAA-20 x K where S-NPP is partial or ended (K = 0.984, one scalar); months partial for the supplying sensor are null. Medians come from `baseline()` (5-year minimum), so the first usable target is 2018-02: **3 training years** (2018-02 to 2020-12).
- **Latest months (O3)**: after the archive ends, `--live` adds monthly values from the live tiles: NOAA-20 detections of the counted days, summed per 1 deg cell, x K x the calendar month's type-0 share (`core/data/type0-share.json`), divided by the daily-share increments of the counted days (`core/data/daily-share.json`), so a month with skipped partial days is scaled to a whole month, as `core/live.js`. A month with more than a third of its days missing, or not ended before the fetch day, is not usable. The target is the month after the latest complete month. If the newest usable month is older than that, the output is labeled `hindcast` and says which months it covers. Live months are never mixed into the training or test data (all before 2026).
- **Every output** (manifest, report, each tile) carries `target_month`, `last_observed_month`, `issued_at` (passed in by the CLI, no clock in pure code) and `based_on_data_to` (last day of `last_observed_month`); the manifest also carries `mode` (`forecast` or `hindcast`).
- **Features** (own data only, standardized): this month's anomaly `log1p(v) - log1p(median)`; mean anomaly of the last 3 months; sin and cos of the target month; `log1p` of the target month's median; the target calendar month's anomaly one year earlier. Missing any input drops the sample.
- **Model**: logistic regression, full-batch gradient descent, L2 = 1e-3, 400 iterations, lr 0.5, zero start: deterministic, no random seed needed. Trained on cells with median above 0.
- **Boosted trees (candidate, `--model gbt`)**: gradient-boosted decision trees for binary log loss (`core/outlook-gbt.js`): depth 3, learning rate 0.1, 32 quantile split candidates per feature, Newton leaves (lambda 1, at least 20 samples per leaf), no randomness. The number of rounds is chosen on the last training year (2020) after fitting on the earlier training years, then refit on all training data (38 rounds on the 2026-11 run). Seven features: the six above plus the **neighbour anomaly**, the mean `log1p` anomaly this month of the up to 8 surrounding 1 deg cells present in the data (0 when none; month t only, so no leakage). Same split, references and crossed bootstrap as the logistic model.
- **Default model (decided 2026-11-15)**: boosted trees. The humans asked for a more sophisticated model, and a paired comparison on the same test samples (crossed tile and year bootstrap, 2000 draws; mathematician) shows GBT consistently better: Brier difference GBT minus logistic -0.0026 (95% CI -0.0062 to +0.0004) on median above 1, -0.0037 (-0.0080 to -0.0005) on all samples, -0.016 (-0.031 to -0.004) on median 1 or less; GBT better in all 4 test years and 11 of 16 tiles. The gain is about 1 BSS point and, on the headline set, its interval touches zero. Overlapping marginal intervals are not the right test for two models scored on the same samples, so the earlier `auto` rule is kept only as an option. `--model logistic|auto` selects the alternatives.
- **ENSO candidate (`--model gbt-enso`, not the default; tried 2026-11-15)**: the seven GBT features plus the NOAA CPC detrended Nino 3.4 anomaly at month t and at t-3 (`core/data/nino34.json`, `docs/data.md`) and the cell's center latitude, so trees could learn a regional ENSO sign. Timing: both Nino values are known when the forecast for t+1 is issued after month t ends; nothing after t is read, and no centered mean such as ONI is used. If month t is missing at forecast time the latest available month is used and the output says so (`nino34.fallback`, `month`; the 2026-11 run used 2026-10, no fallback). Tuning on the training period only (validation year 2020): depth {2, 3, 4} x learning rate {0.05, 0.1}, rounds by early stopping on 2020 log loss, lowest validation loss wins (depth 2, lr 0.1, 20 rounds; the grid is in `report.json`). Calibration: Platt scaling (`p = sigmoid(a z + b)` on the log-odds, Newton, deterministic) fit on the 2020 predictions of the model trained on 2018-2019, kept only if it lowers the validation Brier (0.2373 to 0.2272, a = 1.45, b = 0.50: kept), then the model is refit on all training data and the calibrator applied. **Result: worse than the current GBT, so it is not shipped.** Paired Brier difference new minus current GBT (crossed tile x year bootstrap, 2000 draws, same test samples): +0.0095 (95% CI -0.0006 to +0.0213) on all samples, +0.0084 (-0.0042 to +0.0199) on median above 1, +0.0079 and +0.0091 tile-blocked, +0.0216 (+0.0095 to +0.0358) on median 1 or less. Against the logistic model: +0.0058 (-0.0061 to +0.0180) on all samples. Rule: the new model becomes default only if the all-samples difference is negative with its 95% upper bound below 0 and it is not worse on median above 1 and tile-blocked; none holds, so the current GBT stays. Skill of the ENSO candidate, BSS vs calibrated persistence (95% CI), median above 1: 0.023 (-0.028 to 0.076) time split, 0.026 tile-blocked; all samples 0.015 (-0.034 to 0.067); AUC 0.724. A one-off diagnostic on the headline set (Brier 0.2122 for the current GBT) adding only the two Nino features gave 0.2147 and only latitude 0.2150; depth 2 with Platt 0.2206, the same without Platt 0.2182: each piece hurts. **Caveat**: ENSO is one global index and its teleconnection to fire differs by region and season (not tested here by region or season); with only 3 training years the trees have few distinct ENSO states to learn from and can use Nino and latitude to tell years apart, which would not transfer to the test years (a reading of the result, not separately verified). More years of training data, or region and season interactions with data to support them, are the way to retry.
- **No-skill cells (O2)**: cells whose target median is 0 or at most 1 are still given a probability but carry `no_skill = 1` in the tiles; they are not ranked and not counted in the skill below (measured skill there is about zero). On the 2026-11 run 17% of cells are no-skill; in the 2022-2025 test window 26% of cell-months are.
- **Validation** (no leakage): train on targets up to 2020-12, test on 2022-01..2025-12 (2021 is the gap). Spatial check: 5 folds of whole 10 deg tiles held out. References, both fit on training only: a constant base rate (0.451) and a calibrated persistence, P(above next | above now) = 0.578 and P(above next | not above now) = 0.346 (hard 0/1 persistence is not used). Skill = Brier skill score, BSS = 1 - BS / BS_ref; 95% intervals from a seeded **crossed bootstrap** (1000 draws): the 10 deg tiles and the test years are resampled independently with replacement, and a (tile, year) block enters with the product of its two draw counts. This is wider than resampling tile x year blocks, because neighbors and a bad year are shared. The shrunk climatology of the first version is dropped.
- **Result, Brazil** (Brier of the constant 0.2492 and of persistence 0.2258 on the first row):

| Samples (2022-2025 test) | n | BSS vs constant (95% CI) | BSS vs calibrated persistence (95% CI) | AUC |
|---|---|---|---|---|
| Median above 1 (headline), time split | 25,458 | 0.139 (0.107-0.172) | 0.049 (0.032-0.066) | 0.721 (persistence 0.659) |
| Median above 1, tile-blocked | 25,458 | 0.136 (0.105-0.169) | 0.046 (0.028-0.066) | 0.717 |
| All samples (median above 0), time split | 27,832 | 0.124 (0.094-0.156) | 0.040 (0.021-0.059) | 0.707 |
| All samples, tile-blocked | 27,832 | 0.120 (0.091-0.154) | 0.036 (0.011-0.056) | 0.703 |
| Median 1 or less alone, time split | 2,374 | -0.031 (-0.085-0.031) | -0.049 (-0.102--0.006) | 0.596 |

  Side by side with the boosted trees, same samples (BSS vs calibrated persistence, 95% CI; AUC):

| Samples (2022-2025 test) | Logistic (`--model logistic`) | Boosted trees (shipped) |
|---|---|---|
| Median above 1, time split | 0.049 (0.032-0.066); AUC 0.721 | 0.060 (0.045-0.077); AUC 0.724 |
| Median above 1, tile-blocked | 0.046 (0.028-0.066) | 0.061 (0.041-0.080) |
| All samples, time split | 0.040 (0.021-0.059); AUC 0.707 | 0.057 (0.042-0.071); AUC 0.716 |
| All samples, tile-blocked | 0.036 (0.011-0.056) | 0.057 (0.038-0.074) |
| Median 1 or less alone | -0.049 (-0.102--0.006) | 0.020 (-0.010-0.049) |

  The skill over a calibrated persistence is real but small. The first version's 0.37 was against 0/1 persistence and is withdrawn. The V4 gate's own check (mathematician, all samples, other bootstrap) reported 0.040 (0.027-0.054) vs persistence and 0.124 (0.104-0.146) vs constant. In cells with median 1 or less the model is worse than both references, which is why they are labeled `no-skill`.
- **Limits**: one region, one split, 3 training years, a base rate that is not stationary; cells are not independent (the bootstrap blocks by tile x year but not neighbors across tiles); the model is trained once and not refit as months arrive. The 2026-08 month could be checked against MODIS only (V4): one month, not a skill test. **Next step**: climate drivers (rainfall, temperature, humidity, fuel dryness).
- **Run**: `node pipeline/outlook.js --data data/brazil --live data/live --out data/outlook --model-out core/data/outlook-model.json`. Add `--model gbt|logistic|auto` (default `gbt`). Output (manifest and report also carry `model`): `manifest.json`, `report.json`, `tiles/<id>.json` = `{target_month, last_observed_month, issued_at, based_on_data_to, cell[], p[], no_skill[]}`.

## 8. Open questions

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
| Q9 | VIIRS C2 v2 type-0 mislabeling | Verified (VIIRS 375 m guide 1.2, 6.1; fixed in v3); handled by the static-source mask, gate G2 |
