import { addMonths } from './months.js';
import { baseline, LAST_EXCLUDED_ERA_MONTH } from './baseline.js';
import { partialMonthsFor, isPartial, supplier } from './partial.js';

export const ANOMALY_METHOD = { id: 'percentile-rank', version: 2 };
const UNIT = 'fire-cell-days';
export const CROSS_ERA = 'cross-era';
export const UNCONFIRMED = 'unconfirmed';
export const VIIRS_ERA_RECORD = 'viirs-era-record';
export const SPARSE_BASELINE = 'sparse-baseline';
const EPS = 1e-9;

/** Satellites behind each supplying sensor (acquisition_days keys in the manifest). */
const SATELLITES = { modis: ['Terra', 'Aqua'], viirs: ['SNPP'], noaa20: ['NOAA20'] };

/** Months that never enter a baseline or get a rank: partial for the sensor that supplies them (partial.js). */
const excludedSet = (harmonized, manifest) => new Set(partialMonthsFor(harmonized, manifest));
const isExcluded = (ym, excluded) => ym <= LAST_EXCLUDED_ERA_MONTH || excluded.has(ym);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * The flag rule (gate V2 A2): p = (count of earlier values >= v, plus 1) / (n + 1) <= maxP and
 * n >= minYears. Ties count against, so the false-flag rate is at most maxP for every n.
 */
export function flagRule(value, pool, { minYears = 9, maxP = 0.1 } = {}) {
  if (pool.length < minYears) return false;
  return (pool.filter((v) => v >= value).length + 1) <= maxP * (pool.length + 1) + EPS;
}

/**
 * Does the flag rule hold on one raw sensor series alone (gate V2 A3)? The month and its
 * earlier-year pool must be usable for that sensor: a value, not partial for it (isPartial), and
 * after the Terra-only era. MODIS therefore counts from 2002-08, S-NPP from 2012-02.
 * `filled` maps S-NPP outage months filled from NOAA-20 x K (flag viirs-outage-filled) to their
 * harmonized value: for the VIIRS pool they count instead of being dropped as partial.
 */
function holdsOnSensor(series, sensor, ym, manifest, rule, filled = new Map()) {
  if (!series) return false;
  const year = Number(ym.slice(0, 4));
  const first = series.start;
  const usable = (m) => {
    if (sensor === 'viirs' && filled.has(m)) return filled.get(m);
    if (m < first || m <= LAST_EXCLUDED_ERA_MONTH || isPartial(m, sensor, manifest)) return null;
    const v = series.values[monthDiff(first, m)];
    return v === undefined || v === null ? null : v;
  };
  const v = usable(ym);
  if (v === null) return false;
  const pool = [];
  for (let y = Number(first.slice(0, 4)); y < year; y++) {
    const x = usable(`${y}-${ym.slice(5)}`);
    if (x !== null) pool.push(x);
  }
  return flagRule(v, pool, rule);
}

const monthDiff = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5));

/**
 * Anomaly Series (method.md section 5b): the percentile rank of each month's value against the
 * same calendar month in EARLIER years only, using the baseline's exclusions (null values,
 * Terra-only era and 2002-07, months partial for their supplying sensor, see partial.js). A year never
 * ranks against itself or later years. Ties split evenly: rank = (below + equal / 2) / n, a fraction
 * in 0..1; that rank is the displayed value. `values[i]` is null when the month has no value, is
 * itself excluded, or has fewer than `minYears` (default 9) baseline years.
 *
 * `flags[i]` (gate V2 A2, A3): true when the p rule holds on the harmonized series (flagRule:
 * p <= maxP, default 0.1, n >= minYears) AND on the raw MODIS series alone or the raw VIIRS series
 * alone (`opts.sensors = {modis, viirs}`, the Series from seriesForAoi). A month that passes the
 * rule but not the confirmation is labeled `cross-era` (rank kept, flag false). Without
 * `opts.sensors` no confirmation is possible and every rule-passing month is labeled `unconfirmed`:
 * the honest default is to claim no flag we could not check. A month that is not flagged but passes
 * the rule on VIIRS alone (VIIRS's own partial months excluded) is labeled `viirs-era-record`: a
 * record or near-record of the VIIRS era only, not against the scaled MODIS years before 2012.
 *
 * `labels[i]` is a string[] parallel to `values`: `cross-era`, `unconfirmed`, `viirs-era-record`, or `sparse-baseline` on a flag whose
 * earlier pool has median 0 (A5). Empty array when none.
 *
 * `confirmedBy[i]` is 'modis' or 'viirs' (MODIS checked first) for a flagged month, else null.
 * The VIIRS-alone pool counts S-NPP outage months filled from NOAA-20 x K (viirs-outage-filled).
 *
 * @param {import('./index.js').Harmonized} harmonized result of harmonize()
 * @param {object} manifest validated manifest (partial_months)
 * @param {{minYears?: number, maxP?: number, sensors?: {modis?: object, viirs?: object}}} [opts]
 * @returns {import('./index.js').Series} id 'anomaly', flags boolean[] and labels string[][] (same length as values)
 */
export function anomaly(harmonized, manifest, { minYears = 9, maxP = 0.1, sensors = null } = {}) {
  const { series } = harmonized;
  const excluded = excludedSet(harmonized, manifest);
  const base = baseline(series, { minYears, partialMonths: [...excluded] });
  const byYm = new Map(series.values.map((v, i) => [addMonths(series.start, i), v]));
  const rule = { minYears, maxP };
  const filledMonths = new Set((series.flags ?? []).filter((f) => f.flag === 'viirs-outage-filled').map((f) => f.month));
  const filled = new Map([...filledMonths].map((m) => [m, byYm.get(m)]).filter(([, v]) => v !== null && v !== undefined));
  const values = [], flags = [], labels = [], confirmedBy = [];
  series.values.forEach((value, i) => {
    const ym = addMonths(series.start, i);
    const used = base.yearsUsed[i];
    if (value === null || isExcluded(ym, excluded) || used.length < minYears) {
      values.push(null);
      flags.push(false);
      labels.push([]);
      confirmedBy.push(null);
      return;
    }
    const pool = used.map((y) => byYm.get(`${y}-${ym.slice(5)}`));
    const below = pool.filter((v) => v < value).length;
    const equal = pool.filter((v) => v === value).length;
    values.push((below + equal / 2) / pool.length);
    const tags = [];
    let flag = false;
    let by = null;
    const viirsHolds = holdsOnSensor(sensors?.viirs, 'viirs', ym, manifest, rule, filled);
    if (flagRule(value, pool, rule)) {
      by = holdsOnSensor(sensors?.modis, 'modis', ym, manifest, rule) ? 'modis' : viirsHolds ? 'viirs' : null;
      flag = by !== null;
      if (flag) { if (median(pool) === 0) tags.push(SPARSE_BASELINE); }
      else tags.push(sensors ? CROSS_ERA : UNCONFIRMED);
    }
    if (!flag && viirsHolds) tags.push(VIIRS_ERA_RECORD);
    flags.push(flag);
    labels.push(tags);
    confirmedBy.push(by);
  });
  return { id: 'anomaly', unit: UNIT, start: series.start, values, flags, labels, confirmedBy, method: ANOMALY_METHOD, comparable: true };
}

const daysIn = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();

/**
 * Days the supplying sensor observed in `ym`: the minimum over its satellites that were in their
 * archive span that month (a month missing inside the span is 0 days). null when the manifest has
 * no acquisition_days for it.
 */
function daysObserved(sensor, ym, manifest) {
  const ad = manifest?.acquisition_days;
  if (!ad) return null;
  let min = null;
  for (const sat of SATELLITES[sensor] ?? []) {
    const months = ad[sat] ? Object.keys(ad[sat]).sort() : [];
    if (!months.length || ym < months[0] || ym > months[months.length - 1]) continue;
    const d = ad[sat][ym] ?? 0;
    min = min === null ? d : Math.min(min, d);
  }
  return min;
}

const rankOf = (totals, t) => 1 + totals.filter((o) => o > t).length;

/**
 * Rank of each complete year by total fire-cell-days, 1 = most (ties share the better rank:
 * 1 + years with a strictly larger total). Gate V2 A4: two totals, `total` as observed and
 * `scaledTotal` with each partial month multiplied by days in month / days observed (the
 * supplying sensor's satellites, minimum over them, manifest.acquisition_days). A year gets
 * `rank` when both totals give the same rank; otherwise `rank` is null and `rankRange` is
 * [best, worst] with a `reason`. `scaled` is true when the year has a partial month. A year is
 * left out (`excluded`, with reason) when a month is null, Terra-only, or partial with no usable
 * acquisition days.
 *
 * @param {import('./index.js').Harmonized} harmonized
 * @param {object} manifest
 * @returns {{n: number, years: {year: number, total: number, scaledTotal: number, scaled: boolean, rank: number|null, rankRange?: [number, number], reason?: string}[], excluded: {year: number, reason: string}[]}}
 */
export function yearRank(harmonized, manifest) {
  const { series } = harmonized;
  const est = new Set((series.flags ?? []).filter((f) => f.flag === 'estimated').map((f) => f.month));
  const excluded = excludedSet(harmonized, manifest);
  const byYear = new Map(); // year -> {total, scaledTotal, months, reason, scaled}
  series.values.forEach((value, i) => {
    const ym = addMonths(series.start, i);
    const year = Number(ym.slice(0, 4));
    const y = byYear.get(year) ?? { total: 0, scaledTotal: 0, months: 0, reason: null, scaled: false };
    byYear.set(year, y);
    y.months += 1;
    if (ym <= LAST_EXCLUDED_ERA_MONTH) y.reason ??= `${ym} is a Terra-only month`;
    else if (value === null) y.reason ??= `${ym} has no data`;
    else if (!excluded.has(ym)) { y.total += value; y.scaledTotal += value; }
    else {
      const days = daysObserved(supplier(ym, est.has(ym), manifest), ym, manifest);
      if (!days) y.reason ??= `${ym} is partial and has no acquisition days to scale by`;
      else {
        y.total += value;
        y.scaledTotal += value * Math.max(1, daysIn(ym) / days);
        y.scaled = true;
      }
    }
  });
  const years = [], skipped = [];
  for (const [year, y] of [...byYear].sort((a, b) => a[0] - b[0])) {
    if (y.months < 12) skipped.push({ year, reason: 'year not fully in the series' });
    else if (y.reason) skipped.push({ year, reason: y.reason });
    else years.push({ year, total: y.total, scaledTotal: y.scaledTotal, scaled: y.scaled });
  }
  const obs = years.map((e) => e.total), sc = years.map((e) => e.scaledTotal);
  const ranked = years.map((e) => {
    const a = rankOf(obs, e.total), b = rankOf(sc, e.scaledTotal);
    if (a === b) return { ...e, rank: a };
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return { ...e, rank: null, rankRange: [lo, hi],
      reason: `rank ${a} as observed, ${b} with partial months scaled to a full month` };
  });
  return { n: ranked.length, years: ranked, excluded: skipped };
}
