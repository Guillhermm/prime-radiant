import { addMonths } from './months.js';

/**
 * Consecutive flagged months of an anomaly Series grouped into periods (roadmap M2-K2).
 * A month is flagged when `flags[i]` is true. `maxRank` is the highest rank (0..1) among the
 * period's months; `confirmedBy` lists the sensors ('modis', 'viirs') that confirmed any month,
 * in that order. Oldest period first.
 * @param {{start: string, values: (number|null)[], flags?: boolean[], confirmedBy?: (string|null)[]}} anomalySeries
 * @returns {{from: string, to: string, months: number, maxRank: number|null, confirmedBy: string[]}[]}
 */
export function flaggedPeriods(anomalySeries) {
  const { start, values, flags = [], confirmedBy = [] } = anomalySeries;
  const periods = [];
  let cur = null;
  values.forEach((v, i) => {
    if (!flags[i]) { cur = null; return; }
    const ym = addMonths(start, i);
    if (!cur) { cur = { from: ym, to: ym, months: 0, maxRank: null, confirmedBy: [] }; periods.push(cur); }
    cur.to = ym;
    cur.months += 1;
    if (typeof v === 'number' && (cur.maxRank === null || v > cur.maxRank)) cur.maxRank = v;
    const by = confirmedBy[i];
    if (by && !cur.confirmedBy.includes(by)) cur.confirmedBy.push(by);
  });
  for (const p of periods) p.confirmedBy.sort((a, b) => ['modis', 'viirs'].indexOf(a) - ['modis', 'viirs'].indexOf(b));
  return periods;
}

/**
 * The flag rule as shown on screen, consistent with docs/method.md section 5b: p <= 0.1 against
 * the same month in earlier years, n >= 9, single-sensor confirmation, and what
 * "Record since 2012" (viirs-era-record) means.
 * @param {{maxP?: number, minYears?: number}} [opts] must match the anomaly() options in use
 * @returns {string}
 */
export function flagRuleText({ maxP = 0.1, minYears = 9 } = {}) {
  return `A month is flagged when it is a record or near-record against the same calendar month in earlier years `
    + `(p <= ${maxP}, counting ties against it) with at least ${minYears} earlier years, and the same holds on MODIS alone or `
    + `VIIRS alone, so the flag does not come from mixing the two eras. "Record since 2012" marks a month that is not flagged `
    + `but is a record or near-record of the VIIRS era only, not against 2002-2011, which are scaled MODIS estimates.`;
}
