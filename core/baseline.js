import { addMonths } from './months.js';

const UNIT = 'fire-cell-days';
export const BASELINE_METHOD = { id: 'baseline-median', version: 1 };
/** Terra-only era and the partial 2002-07 (method.md section 3): months up to here never enter a baseline. */
export const LAST_EXCLUDED_ERA_MONTH = '2002-07';
/** Other known partial months of either sensor (method.md section 3): VIIRS S-NPP start and end. */
export const KNOWN_PARTIAL_MONTHS = ['2012-01', '2026-11'];

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/**
 * Baseline (method.md section 5): per month, the median of the same calendar month over
 * earlier years where that month is complete. Own year never counts; null never counts as 0.
 * Excluded: months <= 2002-07 (Terra-only, 2002-07 partial), KNOWN_PARTIAL_MONTHS, and
 * `partialMonths` (outage months of either sensor). Partial months apply whichever series is
 * passed. A still-filling last month needs no flag here: only later years would use it.
 * Fewer than `minYears` usable years -> null + reason.
 * @param {import('./index.js').Series} series
 * @param {{minYears?: number, partialMonths?: string[]}} [opts]
 * @returns {import('./index.js').Baseline}
 */
export function baseline(series, { minYears = 5, partialMonths = [] } = {}) {
  const partial = new Set([...KNOWN_PARTIAL_MONTHS, ...partialMonths]);
  const byMonth = new Map(); // "MM" -> [{year, value}] usable
  series.values.forEach((value, i) => {
    const ym = addMonths(series.start, i);
    if (value === null || ym <= LAST_EXCLUDED_ERA_MONTH || partial.has(ym)) return;
    const mm = ym.slice(5);
    if (!byMonth.has(mm)) byMonth.set(mm, []);
    byMonth.get(mm).push({ year: Number(ym.slice(0, 4)), value });
  });
  const values = [], yearsUsed = [], reasons = [];
  series.values.forEach((_, i) => {
    const ym = addMonths(series.start, i);
    const year = Number(ym.slice(0, 4));
    const used = (byMonth.get(ym.slice(5)) ?? []).filter((e) => e.year < year);
    if (used.length < minYears) {
      values.push(null);
      yearsUsed.push(used.map((e) => e.year));
      reasons.push(`only ${used.length} complete earlier years, need ${minYears}`);
    } else {
      values.push(median(used.map((e) => e.value)));
      yearsUsed.push(used.map((e) => e.year));
      reasons.push(null);
    }
  });
  return {
    series: { id: 'baseline', unit: UNIT, start: series.start, values, method: BASELINE_METHOD, comparable: true },
    yearsUsed, reasons, method: BASELINE_METHOD,
  };
}
