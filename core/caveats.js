/**
 * Caveat catalog (docs/method.md section 6, items 1-9, plus flag explanations).
 * `preliminary` is driven by a gate status map: an item is preliminary until its gate entry is
 * 'passed'. Default: every item preliminary until gate V1 (roadmap M1-K11 flips entries).
 */

/** @typedef {{id: string, kind: 'caveat'|'flag', short: string, long: string, preliminary: boolean}} Caveat */

const DEFS = [
  ['unit-fire-cell-days', 'caveat', 'Counts are fire-cell-days.',
    'Counts are fire-cell-days (a 0.1 degree cell with at least one detection on a day), not fires, fire size or burned area.'],
  ['estimated-before-viirs', 'caveat', 'Values before VIIRS are estimates.',
    'Harmonized values before the VIIRS era (and after S-NPP ends) are estimates: MODIS x R or NOAA-20 x K, not observations.'],
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
  ['brazil-only', 'caveat', 'Data cover Brazil only.',
    'Data cover Brazil only (Natural Earth 10m outline, v5.1.2). Areas outside read as no data; border cells hold only detections inside the outline, so they undercount.'],
  // flag explanations
  ['estimated', 'flag', 'Estimated, not observed.',
    'The value was estimated (MODIS x R or NOAA-20 x K) rather than observed by VIIRS S-NPP.'],
  ['viirs-not-archived', 'flag', 'VIIRS not yet archived.',
    'S-NPP still operated but its archive had not reached this month; the value is estimated, not observed.'],
  ['terra-only', 'flag', 'Terra only, no value.',
    'Before 2002-07 only MODIS Terra operated; the value is empty and is not scaled.'],
  ['low-confidence', 'flag', 'Low confidence ratio.',
    'The ratio applied to this series failed the usability rule (method.md 4.2) at every fallback level.'],
  ['partial-domain', 'flag', 'Partly inside the domain.',
    'Part of the area lies outside the Brazil domain; the count covers only the part inside.'],
  ['outside-domain', 'flag', 'Outside the domain.',
    'The area lies outside the Brazil domain; there is no data.'],
];

/** Catalog ids in order. */
export const CAVEAT_IDS = DEFS.map((d) => d[0]);

/** Default gate status: nothing validated until V1. Values: 'preliminary' | 'passed'. */
export const DEFAULT_GATES = Object.freeze(Object.fromEntries(CAVEAT_IDS.map((id) => [id, 'preliminary'])));

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
 * Caveats that apply to a harmonize() result, in catalog order. Always: 1, 3, 4, 5, 8, 9.
 * 2 when any month is estimated; 6 when R or K came from a wider level (low confidence at the
 * AOI itself is the `low-confidence` flag item);
 * 7 only when opts.live. Flag items appear for each flag on the series, plus opts.flags.
 * @param {{series: {flags?: {flag: string}[]}, R?: {level?: string}|null, K?: {level?: string}|null}} result
 * @param {{gates?: Record<string, string>, live?: boolean, flags?: string[]}} [opts]
 * @returns {Caveat[]}
 */
export function caveatsFor(result, { gates = DEFAULT_GATES, live = false, flags = [] } = {}) {
  const have = new Set([...(result?.series?.flags ?? []).map((f) => f.flag), ...flags]);
  const wide = [result?.R, result?.K].some((r) => r && r.level && r.level !== 'aoi');
  const on = new Set(['unit-fire-cell-days', 'no-confidence-filter', 'detection-limits', 'archive-lag',
    'not-validated', 'brazil-only']);
  if (have.has('estimated')) on.add('estimated-before-viirs');
  if (wide) on.add('regional-ratio');
  if (live) on.add('nrt-unfiltered');
  for (const f of have) on.add(f);
  return CAVEAT_IDS.filter((id) => on.has(id)).map((id) => caveat(id, gates));
}
