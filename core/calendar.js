import { monthAt } from './months.js';

const STUB = { id: 'stub', version: '0' };

/**
 * STUB status rules: null is "no-data", anything else is "harmonized" and estimated.
 * @param {object} series Series to lay out, one cell per month
 * @param {object} [base] baseline Series with the same start; sets `median` on each cell
 * @returns {object[]} CalendarCell list in time order
 */
export const toCalendar = (series, base) =>
  series.values.map((value, i) => {
    const [year, month] = monthAt(series.start, i).split('-').map(Number);
    const cell = { year, month, value, status: value === null ? 'no-data' : 'harmonized', estimated: value !== null };
    if (base && base.values[i] !== null && base.values[i] !== undefined) cell.median = base.values[i];
    return cell;
  });

/**
 * STUB. Summary numbers for the KPI strip.
 * @param {object[]} cells CalendarCell list from `toCalendar`
 * @returns {{total: number, months: number, noDataMonths: number, peak: object|null, method: {id: string, version: string}}}
 */
export const kpis = (cells) => {
  const withData = cells.filter((c) => c.value !== null);
  const peak = withData.reduce((best, c) => (best === null || c.value > best.value ? c : best), null);
  return {
    total: withData.reduce((sum, c) => sum + c.value, 0),
    months: cells.length,
    noDataMonths: cells.length - withData.length,
    peak: peak && { year: peak.year, month: peak.month, value: peak.value },
    method: STUB,
  };
};
