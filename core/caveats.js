/**
 * Caveat catalog (docs/method.md section 6, items 1-9, plus flag explanations).
 * `preliminary` is driven by a gate status map: an item is preliminary until its gate entry is
 * 'passed'. Default: every item preliminary until gate V1 (roadmap M1-K11 flips entries).
 */

/** @typedef {{id: string, kind: 'caveat'|'anomaly'|'flag'|'live', short: string, long: string, preliminary: boolean}} Caveat */

const DEFS = [
  ['unit-fire-cell-days', 'caveat', 'Counts are fire-cell-days.',
    'Counts are fire-cell-days (a 0.1 degree cell with at least one detection on a day), not fires, fire size or burned area.'],
  ['estimated-before-viirs', 'caveat', 'Values before VIIRS are estimates.',
    'Values before the VIIRS era (and after S-NPP ends) are estimates scaled to VIIRS-equivalent: MODIS x R or NOAA-20 x K, not observations. R is fit on 2012-2021; applied to the larger fire years of 2002-2007 it likely overestimates them.'],
  ['no-confidence-filter', 'caveat', 'No confidence filter applied.',
    'Detections of every confidence level are counted, so some may be false alarms. Only presumed vegetation fires (FIRMS type 0) are kept.'],
  ['detection-limits', 'caveat', 'Zero means none detected.',
    'Clouds, smoke and overpass timing hide fires. Zero means none detected, not none burning.'],
  ['archive-lag', 'caveat', 'The latest month may lag.',
    'The latest archived month may lag the calendar month, and a partial month is not comparable to a full one.'],
  ['regional-ratio', 'caveat', 'Sparse area: regional ratio, low confidence.',
    'This area has too few detections for its own ratio, so a regional or global ratio was used. Treat harmonized values as low confidence.'],
  ['nrt-unfiltered', 'caveat', 'Near-real-time data cannot be filtered by type.',
    'Near-real-time data cannot be filtered by detection type (planned, M3).'],
  ['not-validated', 'caveat', 'Method not yet validated (preliminary).',
    'The harmonization method has not passed the science gate (V1). Numbers are preliminary.'],
  ['domain-only', 'caveat', 'Data cover the domain outline only.',
    'Data cover only the domain the build was clipped to (a Natural Earth 10m outline, v5.1.2; the Method drawer names it). Areas outside read as no data; border cells hold only detections inside the outline, so they undercount.'],
  ['global-extent', 'caveat', 'Outside Brazil the method is preliminary.',
    'The method was validated for Brazil (gate V1). Elsewhere it is preliminary (global check, 2026-11-15): FIRMS labels some gas flares and industrial heat sources as vegetation fires, so oil and gas fields (the Sahara, Iraq, the Niger Delta) overcount; the MODIS to VIIRS ratio was not checked region by region, and a regional or global fallback ratio is weakest in boreal forests. Counts are per 0.1 degree cell, whose area shrinks toward the poles, so do not compare areas at different latitudes. Days are UTC days.'],
  // anomaly caveats (gate V2 A6), added when anomaly results are present
  ['anomaly-rule', 'anomaly', 'Anomaly: rank against earlier years.',
    'The anomaly is the percentile rank of a month against the same calendar month in earlier years (50% = typical). A month is flagged when it ranks in the top tenth of earlier years (ties count against it) and the same holds on MODIS alone or VIIRS alone.'],
  ['anomaly-small-n', 'anomaly', 'Few years: a flag is a record.',
    'With 9 or 10 earlier years a flag means a record or near-record for that month, not a statistical outlier. Months with fewer than 9 earlier years get no rank.'],
  ['anomaly-scaled-years', 'anomaly', 'Year ranks scale partial months.',
    'A year with a partial month (satellite outage, before 2012 the S-NPP start) is ranked twice: as observed and with partial months scaled by days observed. When the two disagree the year shows a rank range.'],
  ['anomaly-sparse', 'anomaly', 'Sparse areas flag easily.',
    'Where most earlier years had no detections, a single fire-cell-day can flag a month. Flags marked sparse baseline need the most caution.'],
  ['anomaly-archive', 'anomaly', 'Rank is relative to this archive.',
    'The rank is relative to this archive and its years, not a standard climatology; another baseline period would rank months differently. MODIS x R months after 2021 (orbit drift) are estimates.'],
  // live data caveats (M3-K3, gate V3 L6), kind 'live' so the drawer's count of 9 caveats stays
  ['live-nrt', 'live', 'Near-real-time data.',
    'Live detections are near-real-time (FIRMS NRT, within about 3 hours of the overpass). They can differ from the archive product, which uses the same algorithm but follows after a 2-3 month lag (FIRMS FAQ).'],
  ['live-approximate', 'live', 'Live comparison is approximate.',
    'The comparison is approximate: the archive band is the median and middle half of the same month in earlier VIIRS-era years (2012 on), scaled to the day by the mean share of a month counted by that day. Small areas deviate most (measured in Brazil: the Pantanal 25-30% either way) and are marked low confidence.'],
  ['live-not-harmonized', 'live', 'Live is not harmonized.',
    'Live detections are NOAA-20 scaled to S-NPP units (x K), not the MODIS-and-VIIRS harmonized series, and are never added to the harmonized totals or baseline.'],
  ['live-unfiltered', 'live', 'Live is unfiltered by type.',
    'Near-real-time detections carry no detection type, so static sources are not removed as in the archive. Live values are multiplied by the archive\'s share of type-0 detections for the same calendar month (Brazil, S-NPP 2012-2025: 94% in April to 99% in October), an average that cannot remove one particular static source.'],
  ['live-provisional', 'live', 'Current period is provisional.',
    'The current month is still open: the line ends at the last complete day of the live data (a UTC day), the day of the fetch is never counted, and a partial day is skipped, never counted as 0. Days are marked incomplete only when a satellite feed fails worldwide; a regional data gap over Brazil can show as a low day rather than a missing one.'],
  ['live-sensor', 'live', 'Live uses NOAA-20 scaled to S-NPP.',
    'S-NPP near-real-time files ended on 2026-11-02, so live values are NOAA-20 detections multiplied by K to S-NPP equivalent units, the unit of the archive band.'],
  ['live-archive-lag', 'live', 'The archive follows later.',
    'The archive product replaces near-real-time data after a 2-3 month lag (FIRMS FAQ); live values for a month are provisional until then.'],
  ['live-brazil', 'live', 'Live covers Brazil only.',
    'The live comparison is built for Brazil, where its method was checked (gate V3): the within-month shares and the type-0 shares were measured there. Live data is clipped to Brazil, so an area outside it has no live comparison.'],
  ['live-access', 'live', 'Live source may require a login.',
    'FIRMS documentation says an Earthdata Login is required for its files; they are served without one today. If that is enforced, live data becomes unavailable and the view says so.'],
  // flag explanations
  ['viirs-era-record', 'anomaly', 'Record since 2012',
    'Highest or near-highest for this month in the VIIRS era (2012 on); not a record against 2002-2011, which are scaled MODIS estimates.'],
  ['unconfirmed', 'flag', 'Not checked against a single sensor',
    'The month ranks high against the harmonized history, but the raw MODIS and VIIRS series were not supplied, so the flag could not be confirmed. Rank shown, no flag.'],
  ['cross-era', 'flag', 'Cross-era, not flagged.',
    'The month ranks high against the harmonized history, but neither the MODIS record nor the VIIRS record alone confirms it, so the rank may come from mixing the two eras. Rank shown, no flag.'],
  ['sparse-baseline', 'flag', 'Sparse baseline.',
    'The median of the earlier years for this month is 0: most had no detections, so the flag rests on few fire-cell-days.'],
  ['estimated', 'flag', 'Estimated, not observed.',
    'The value was estimated (MODIS x R or NOAA-20 x K) rather than observed by VIIRS S-NPP.'],
  ['viirs-outage-filled', 'flag', 'S-NPP outage filled.',
    'S-NPP had an outage this month, so its undercounted value was replaced by NOAA-20 x K (an estimate, also flagged estimated).'],
  ['viirs-not-archived', 'flag', 'VIIRS not yet archived.',
    'S-NPP still operated but its archive had not reached this month; the value is estimated, not observed.'],
  ['terra-only', 'flag', 'Terra only, no value.',
    'Before 2002-07 only MODIS Terra operated; the value is empty and is not scaled.'],
  ['low-confidence', 'flag', 'Low confidence ratio.',
    'The ratio applied to this series failed the usability rule (method.md 4.2) at every fallback level.'],
  ['partial-domain', 'flag', 'Partly inside the domain.',
    'Part of the area lies outside the data domain; the count covers only the part inside.'],
  ['outside-domain', 'flag', 'Outside the domain.',
    'The area lies outside the data domain; there is no data.'],
];

/** Catalog ids in order. */
export const CAVEAT_IDS = DEFS.map((d) => d[0]);

/** Gate status values: 'preliminary' | 'passed'. Nothing passed: the state before any gate. */
export const NO_GATES = Object.freeze(Object.fromEntries(CAVEAT_IDS.map((id) => [id, 'preliminary'])));

/**
 * Status after gate V1 (docs/gates/V1.md, passed with caveats on 2026-11-14): every item
 * passed; V2 and V3 passed on their re-checks (docs/gates/V2.md, V3.md).
 */
// Gate V3 passed on its re-check (docs/gates/V3.md), so the live items are no longer preliminary.
// The global extent failed one point of its check (type 0 keeps gas flares), so it stays preliminary.
const PRELIMINARY = new Set(['nrt-unfiltered', 'global-extent']);
export const DEFAULT_GATES = Object.freeze(Object.fromEntries(
  CAVEAT_IDS.map((id) => [id, PRELIMINARY.has(id) ? 'preliminary' : 'passed'])));

/**
 * One catalog item with `preliminary` resolved against a gate map (missing entry = preliminary).
 * @param {string} id
 * @param {Record<string, string>} [gates]
 * @returns {Caveat}
 */
export function caveat(id, gates = DEFAULT_GATES) {
  const d = DEFS.find((x) => x[0] === id);
  if (!d) throw new RangeError(`unknown caveat id: ${id}`);
  return { id, kind: d[1], short: d[2], long: d[3], preliminary: gates[id] !== 'passed' };
}

/** The whole catalog. @param {Record<string, string>} [gates] @returns {Caveat[]} */
export function catalog(gates = DEFAULT_GATES) {
  return CAVEAT_IDS.map((id) => caveat(id, gates));
}

/**
 * Caveats that apply to a harmonize() result, in catalog order. Always: 1, 3, 4, 5, 9; 8
 * (not validated) while its gate entry is not 'passed'.
 * 2 when any month is estimated; 6 when R or K came from a wider level (low confidence at the
 * AOI itself is the `low-confidence` flag item);
 * 7 only when opts.live; the five anomaly caveats when `result.anomaly` (an anomaly Series) is
 * present, plus `cross-era` / `unconfirmed` / `viirs-era-record` / `sparse-baseline` when its labels carry them. Flag items appear for each flag on the series, plus opts.flags.
 * @param {{series: {flags?: {flag: string}[]}, anomaly?: {labels?: string[][]}, R?: {level?: string}|null, K?: {level?: string}|null}} result
 * @param {{gates?: Record<string, string>, live?: boolean, flags?: string[], domain?: object|null, global?: boolean}} [opts] `global`: the data has no domain clip
 * @returns {Caveat[]}
 */
export function caveatsFor(result, { gates = DEFAULT_GATES, live = false, flags = [], domain = null, global = false } = {}) {
  const have = new Set([...(result?.series?.flags ?? []).map((f) => f.flag), ...flags]);
  const wide = [result?.R, result?.K].some((r) => r && r.level && r.level !== 'aoi');
  const on = new Set(['unit-fire-cell-days', 'no-confidence-filter', 'detection-limits', 'archive-lag']);
  if (domain) on.add('domain-only');
  // The global build (no domain clip): only Brazil was validated.
  if (global) on.add('global-extent');
  if (gates['not-validated'] !== 'passed') on.add('not-validated');
  if (have.has('estimated')) on.add('estimated-before-viirs');
  if (wide) on.add('regional-ratio');
  // With live data on, the live-* items (liveCaveats) explain the type bias; nrt-unfiltered is the pre-M3 placeholder.
  if (result?.anomaly) {
    for (const id of ['anomaly-rule', 'anomaly-small-n', 'anomaly-scaled-years', 'anomaly-sparse', 'anomaly-archive']) on.add(id);
    for (const l of result.anomaly.labels ?? []) for (const t of l) on.add(t);
  }
  for (const f of have) on.add(f);
  return CAVEAT_IDS.filter((id) => on.has(id)).map((id) => caveat(id, gates));
}
