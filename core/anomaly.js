import { addMonths } from './months.js';
import { baseline, LAST_EXCLUDED_ERA_MONTH } from './baseline.js';
import { partialMonthsFor } from './partial.js';

export const ANOMALY_METHOD = { id: 'percentile-rank', version: 1 };
const UNIT = 'fire-cell-days';

/** Months that never enter a baseline or get a rank: partial for the sensor that supplies them (partial.js). */
const excludedSet = (harmonized, manifest) => new Set(partialMonthsFor(harmonized, manifest));
const isExcluded = (ym, excluded) => ym <= LAST_EXCLUDED_ERA_MONTH || excluded.has(ym);

/**
 * Anomaly Series (method.md section 5): the percentile rank of each month's value against the
 * same calendar month in EARLIER years only, using the baseline's exclusions (null values,
 * Terra-only era and 2002-07, months partial for their supplying sensor, see partial.js). A year never ranks against itself
 * or later years. Ties split evenly: rank = (below + equal / 2) / n, a fraction in 0..1.
 * `values[i]` is null when the month has no value, is itself excluded, or has fewer than
 * `minYears` (default 9) baseline years. `flags[i]` is true only when rank >= `threshold`
 * (default 0.9) and the month has at least `minYears` baseline years.
 *
 * All-zero history (the sparse case where the median and MAD are 0): the rank is still defined.
 * A 0 against all zeros is a full tie, rank 0.5, never flagged; any value above 0 ranks 1 and is flagged.
 *
 * @param {import('./index.js').Harmonized} harmonized result of harmonize()
 * @param {object} manifest validated manifest (partial_months)
 * @param {{minYears?: number, threshold?: number}} [opts]
 * @returns {import('./index.js').Series} id 'anomaly', flags boolean[] (same length as values)
 */
export function anomaly(harmonized, manifest, { minYears = 9, threshold = 0.9 } = {}) {
  const { series } = harmonized;
  const excluded = excludedSet(harmonized, manifest);
  const base = baseline(series, { minYears, partialMonths: [...excluded] });
  const byYm = new Map(series.values.map((v, i) => [addMonths(series.start, i), v]));
  const values = [], flags = [];
  series.values.forEach((value, i) => {
    const ym = addMonths(series.start, i);
    const used = base.yearsUsed[i];
    if (value === null || isExcluded(ym, excluded) || used.length < minYears) {
      values.push(null);
      flags.push(false);
      return;
    }
    const pool = used.map((y) => byYm.get(`${y}-${ym.slice(5)}`));
    const below = pool.filter((v) => v < value).length;
    const equal = pool.filter((v) => v === value).length;
    const rank = (below + equal / 2) / pool.length;
    values.push(rank);
    flags.push(rank >= threshold);
  });
  return { id: 'anomaly', unit: UNIT, start: series.start, values, flags, method: ANOMALY_METHOD, comparable: true };
}

/**
 * Rank of each complete year by total fire-cell-days, 1 = most (ties share the better rank:
 * 1 + years with a strictly larger total). A year is complete when all twelve months are in the
 * series with a value and none is excluded (null, Terra-only era, partial month). Others go to
 * `excluded` with the reason.
 *
 * @param {import('./index.js').Harmonized} harmonized
 * @param {object} manifest
 * @returns {{n: number, years: {year: number, total: number, rank: number}[], excluded: {year: number, reason: string}[]}}
 */
export function yearRank(harmonized, manifest) {
  const { series } = harmonized;
  const excluded = excludedSet(harmonized, manifest);
  const byYear = new Map(); // year -> {total, months, reason}
  series.values.forEach((value, i) => {
    const ym = addMonths(series.start, i);
    const year = Number(ym.slice(0, 4));
    const y = byYear.get(year) ?? { total: 0, months: 0, reason: null };
    byYear.set(year, y);
    y.months += 1;
    if (isExcluded(ym, excluded)) y.reason ??= `${ym} is a partial or Terra-only month`;
    else if (value === null) y.reason ??= `${ym} has no data`;
    else y.total += value;
  });
  const years = [], skipped = [];
  for (const [year, y] of [...byYear].sort((a, b) => a[0] - b[0])) {
    if (y.months < 12) skipped.push({ year, reason: 'year not fully in the series' });
    else if (y.reason) skipped.push({ year, reason: y.reason });
    else years.push({ year, total: y.total });
  }
  const ranked = years.map((e) => ({ ...e, rank: 1 + years.filter((o) => o.total > e.total).length }));
  return { n: ranked.length, years: ranked, excluded: skipped };
}
