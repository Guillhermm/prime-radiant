# Method note

Version 0, 2026-11-14. Draft for the Second Foundation gates V1 (unit, binning, harmonization, median, caveats) and V2 (anomalies). Nothing in this note is validated yet; until a gate passes, every number it governs is shown as preliminary.

Each item carries a status and a source:

- **verified**: checked against a primary source or recomputed.
- **supported**: consistent with sources, not checked end to end.
- **assumption**: a choice the team made; it can change without new evidence.
- **unverified**: a factual claim nobody has checked yet.

## 1. Unit: fire-cell-days

One fire-cell-day is one grid cell with at least one detection on one UTC day, counted once per sensor family. A monthly value for an area of interest (AOI) is the number of distinct (cell, UTC day) pairs inside the AOI in that month:

    C_s(AOI, month) = | { (c, d) : c in AOI, d in month, at least one detection of family s in c on d } |

| Item | Status | Source |
|---|---|---|
| Raw pixel counts are not comparable across MODIS and VIIRS (375 m VIIRS detects more and smaller fires), so the unit is presence per common cell per day | supported | VIIRS C2 375 m User Guide v1.2 (Schroeder, Giglio, Hall 2025), p.13-14; Schroeder et al. 2014, RSE 143:85-96 |
| Only detections with `type = 0` (presumed vegetation fire) are kept; 1 volcano, 2 other static land source, 3 offshore are dropped | supported | FIRMS archive attribute documentation; `type` exists in MCD14ML and VNP14IMGML (VIIRS guide p.8) |
| FIRMS near-real-time files have no `type` field, so live data (D) cannot be filtered the same way | supported | FIRMS FAQ |
| Grid resolution 0.1 deg, cells half-open `[lon, lon + 0.1) x [lat, lat + 0.1)` from `floor(lon * 10)`, `floor(lat * 10)`; a point on a cell edge belongs to the cell east/north of it; lon 180 E wraps to -180 (the first column) and lat 90 N clamps into the last row | assumption | Team choice; 0.1 deg is about 11 km at the equator, coarser than either pixel at nadir |
| A cell belongs to the AOI when its center lies inside the bounding box | assumption | Team choice, implemented in `core/grid.js` |
| `acq_date` and `acq_time` are UTC | unverified | To re-read on the FIRMS attribute page; the FAQ pages read on 2026-11-14 do not say it for MODIS or VIIRS |
| No confidence filter on either sensor: every `type = 0` detection counts | assumption | Default pending open question 4 |
| MODIS Collection 6 and 6.1 are mixed freely in one series | supported | MODIS C6/C6.1 Fire User Guide v1.0 (2021), p.8 |

Cells near the poles shrink in area (0.1 deg of longitude is about 5.6 km at 60 deg latitude). Fire-cell-days are compared only within the same AOI, so this does not bias a ratio or a baseline, but totals from AOIs at different latitudes are not comparable per unit area. Status: assumption about use, stated as caveat C5.

## 2. Deduplication

| Rule | Status | Source |
|---|---|---|
| One fire-cell-day per (sensor family, cell, UTC day), whatever the number of pixels, overpasses or satellites | assumption | Team choice; removes overlap-swath and multi-pixel double counting by construction |
| Family `modis` = Terra and Aqua merged: a cell-day seen by both counts once | assumption | Team choice |
| Family `viirs` = S-NPP only; NOAA-20 and NOAA-21 are excluded until open question 3 is answered | assumption | Team choice |
| MODIS and VIIRS are never merged into one count; they meet only through R (section 4) | assumption | Team choice |

Day and night detections of the same cell on the same UTC day count once. A fire burning across UTC midnight counts on both days. Status: assumption, consequence of the definition.

## 3. Eras

| Era | Span | Treatment | Status | Source |
|---|---|---|---|---|
| MODIS Terra-only | 2000-11-01 to 2002-07-03 | Shown separately as "MODIS Terra-only"; excluded from R, from the harmonized series and from baselines, because one satellite sees fewer cell-days than two | dates supported, treatment assumption | FIRMS FAQ: Terra from 1 November 2000, Aqua from 4 July 2002 |
| MODIS Terra + Aqua | 2002-07 onward; first full month 2002-08 | The `modis` series | supported | FIRMS FAQ |
| VIIRS S-NPP | 2012-01-20 to 2026-11-02 | The `viirs` series; null outside this span, never 0 | supported | VIIRS C2 guide p.9 (record start 20 Jan 2012); FIRMS FAQ (S-NPP production ceased 2026-11-02 15:40 UTC) |
| After S-NPP | 2026-11-03 onward | Harmonized value is MODIS x R, marked estimated | assumption | Roadmap decision H11 |

Partial months at era edges (2002-07 for Aqua, 2012-01 and 2026-11 for S-NPP) are excluded from R and from baselines, and the harmonized series uses MODIS x R there, marked estimated. Status: assumption.

Terra and Aqua are near end of mission (science end projected for 2027) and Terra's orbit has drifted since 2020, which changes its overpass time and may change its counts. Status: unverified, physicist to check (caveat C4).

## 4. Harmonization ratio R

R scales MODIS fire-cell-days to VIIRS-equivalent fire-cell-days for one AOI, estimated on the overlap months O (complete months where both `modis` and `viirs` operate: 2012-02 to 2026-10):

    R = sum_{m in O} V_m / sum_{m in O} M_m

| Item | Status | Source |
|---|---|---|
| Ratio of sums, not mean of monthly ratios: months with zero MODIS count stay in both sums instead of making a ratio undefined or infinite | verified | Recomputed by hand: V = [0, 6, 3], M = [0, 2, 1] gives R = 9 / 3 = 3, while the mean of ratios is undefined at the first month |
| Harmonized series = VIIRS where VIIRS operates for the full month, MODIS x R elsewhere (2002-08 to 2012-01, 2026-11 onward), with `estimated: true` on scaled months | assumption | Team choice; consequence: the harmonized overlap total equals the VIIRS total exactly |
| R is constant in time over the whole record | assumption | Team choice; sensor drift and land-cover change would violate it (caveat C3) |
| R varies by region, so it is estimated per AOI | supported | VIIRS C2 guide p.13-14 (ratios vary by region) |

### Threshold and fallback

R is used for the AOI only when the AOI MODIS sum over O is at least T = 129 fire-cell-days. Otherwise R comes from the parent region, and the level used is reported with R.

    level 0: AOI                   if sum M(AOI) >= T
    level 1: parent region         if sum M(parent) >= T
    level 2: grandparent region    if sum M(grandparent) >= T
    otherwise: no harmonized line; raw MODIS and VIIRS only

The value 129 reproduces from this rule: treat both sums as Poisson, so Var(ln R) is about 1/V + 1/M; with V = kM, require the approximate 95% half-width of ln R to be at most 0.2:

    1.96 * sqrt((1 + 1/k) / M) <= 0.2   =>   M >= (1.96 / 0.2)^2 * (1 + 1/k)

For k = 3 this gives M >= 128.05, so T = 129 (k = 2 gives 145, k = 5 gives 116). Status: assumption. The Poisson model ignores overdispersion (fires cluster in space and time, so the true variance is larger) and k = 3 is a planning guess, not a measured ratio. Open question 2.

Parent region: open question 1.

### Per-month and annual R

    R_k = sum_{m in O, month(m) = k} V_m / sum_{m in O, month(m) = k} M_m,   k = 1..12

Calendar month k uses R_k when its MODIS sum passes T at the level already chosen; otherwise it uses the annual R at that level. Status: assumption. Rationale: fire seasons shift the sensor ratio across the year (VIIRS sees relatively more of the small, cool fires that dominate some seasons), but each R_k uses about one twelfth of the data, so it needs its own threshold. Status of the rationale: unverified, physicist.

### Confidence interval

Resample whole overlap years with replacement (B = 2000 draws, seeded generator), recompute R on each draw, report the 2.5th and 97.5th percentiles. Resampling years, not months, keeps the within-year seasonal dependence. Status: assumption.

Caveat: with 14 complete overlap years (2012 to 2025, plus 2026-01 to 2026-10 as a partial fifteenth block) the percentile bootstrap tends to give intervals that are too narrow. The interval is shown as a guide to stability, not as exact 95% coverage. Status: supported (known small-sample behavior of the percentile bootstrap), not recomputed on our data.

## 5. Baseline

For a month (y, k), the baseline is the median of the same calendar month k over earlier complete years of the same series:

    baseline(y, k) = median { X(y', k) : y' < y, year y' complete for month k, X(y', k) not null }

| Item | Status | Source |
|---|---|---|
| Median, not mean: monthly fire-cell-days are discrete, right-skewed and often zero | assumption | Team choice |
| A year never enters its own baseline; partial months are excluded | assumption | Team choice |
| Even count: average of the two middle values | assumption | Standard median convention |
| No earlier complete year: baseline is null with a reason ("not enough history"), never 0 | assumption | Team choice |
| The number of years used is always shown with the median | assumption | Team choice |
| Baselines of the harmonized series mix observed VIIRS months with estimated MODIS x R months | assumption | Consequence of section 4; a cell can show how many of its baseline years were estimated |
| Terra-only years (2000 to 2002-07) never enter a baseline | assumption | Section 3 |

## 6. Anomaly

Percentile rank of the current value x against its n baseline values, with ties split evenly:

    PR(x) = (count{ b < x } + 0.5 * count{ b = x }) / n

A month is flagged when PR >= 0.9 and n >= 9. The year rank orders years by their total over the selected range.

| Item | Status | Source |
|---|---|---|
| Percentile rank rather than z-score: no mean or standard deviation on skewed, zero-heavy counts; a zero median absolute deviation does not break it | assumption | Team choice |
| Ties split evenly, so a zero against an all-zero baseline gets PR = 0.5 and is never flagged | verified | Recomputed by hand: x = 0, baseline nine zeros gives (0 + 4.5) / 9 = 0.5 |
| n >= 9: if the current month and its n baseline months are exchangeable, the chance that it is the largest of the n + 1 is 1 / (n + 1), which is at most 0.1 only from n = 9 | verified | Recomputed: 1 / 10 = 0.1 at n = 9, 1 / 9 = 0.11 at n = 8. At n = 9, PR >= 0.9 means x exceeds every baseline value (8 of 9 gives 0.889) |
| Flag threshold 0.9 | assumption | Default pending V2 |

Caveat: in sparse cells a single fire-cell-day against a baseline of nine zeros gives PR = 1.0 and a flag. The sparse-area caveat (C6) applies; V2 decides whether a minimum count is also required.

## 7. Caveats shown in the app

| ID | Text (draft) | Status |
|---|---|---|
| C1 | Counts are days with fire in a 0.1 deg cell, not fires, not burned area. | assumption |
| C2 | Before 2012-02 and after 2026-11-02 the harmonized line is MODIS scaled by R, marked estimated. | assumption |
| C3 | R assumes the MODIS to VIIRS relationship did not change over time. | assumption |
| C4 | MODIS Terra orbit drift and end of mission may change MODIS counts after 2020. | unverified |
| C5 | Totals from AOIs at different latitudes are not comparable per unit area. | supported |
| C6 | Sparse areas: few fire-cell-days make R and anomaly flags unstable; R from a parent region is marked low confidence. | assumption |
| C7 | Near-real-time data has no type field and is not harmonized. | supported |
| C8 | No confidence filter is applied. | assumption |

## Open questions

Each question has an owner in the Second Foundation and a default the code uses until it is answered.

| # | Question | Owner | Default |
|---|---|---|---|
| 1 | Which parent region does the fallback use? | mathematician | The enclosing 10 x 10 deg tile, then a fixed continent bounding box; if both fail the threshold, no harmonized line |
| 2 | Is T = 129 MODIS fire-cell-days right? It rests on Poisson variance and an assumed V / M of 3; overdispersion would push it up. Recompute with the measured ratio and year-to-year variance once the demo-region archive arrives. | mathematician | T = 129 |
| 3 | After S-NPP ended on 2026-11-02, can NOAA-20 continue the VIIRS series, and does it need its own factor against S-NPP on the 2018-04 to 2026-11 overlap? | physicist | VIIRS series stops at 2026-11-02; later months are MODIS x R, marked estimated |
| 4 | Should a MODIS confidence cutoff apply (and the matching VIIRS low-confidence class be dropped)? | physicist, with reviewer for the user-guide thresholds | No confidence filter on either sensor, stated as caveat C8 |
| 5 | Are FIRMS `acq_date` and `acq_time` UTC for both MODIS and VIIRS archive files? | reviewer | Treated as UTC |
| 6 | Does Terra's orbit drift since 2020 change MODIS fire-cell-days enough to break a constant R? | physicist | Constant R, caveat C4 |
