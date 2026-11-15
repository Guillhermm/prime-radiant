import { monthIndex } from './months.js';

/**
 * Calendar-year totals of a monthly series, honoring `series.start` (the first value need
 * not be January). Null months are skipped, never counted as 0.
 * `months` is the number of non-null months summed; `complete` is true when all 12 months of
 * that year are in the series and none is null. `value` is null when every month is null.
 * @param {import('./index.js').Series} series
 * @returns {{year: number, value: number|null, months: number, complete: boolean}[]} one entry per year touched, oldest first
 */
export function annualTotals(series) {
  const m0 = monthIndex(series.start);
  const years = new Map();
  series.values.forEach((v, i) => {
    const year = Math.floor((m0 + i) / 12);
    const y = years.get(year) ?? { year, value: null, months: 0, inSeries: 0 };
    y.inSeries++;
    if (v !== null) { y.value = (y.value ?? 0) + v; y.months++; }
    years.set(year, y);
  });
  return [...years.values()].map(({ year, value, months, inSeries }) => ({ year, value, months, complete: months === 12 && inSeries === 12 }));
}
