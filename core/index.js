/**
 * Public surface of core/ (M0 stubs; real implementations arrive in M1).
 * Shapes are the contract in docs/roadmap.md section 2 and validate with core/schema.js.
 * Everything tagged method.id "stub" returns fixture-shaped values, not science.
 * null = sensor not operating, 0 = none detected, always.
 *
 * Shared shapes (JSDoc typedefs):
 * @typedef {{id: string, version: number}} Method
 * @typedef {{id: 'modis'|'viirs'|'harmonized'|'baseline'|'anomaly'|'live', unit: 'fire-cell-days',
 *   start: string, values: (number|null)[], flags?: {month: string, flag: string}[],
 *   method: Method, comparable: boolean}} Series
 * @typedef {{year: number, month: number, value: number|null,
 *   status: 'observed'|'harmonized'|'no-data'|'partial', estimated: boolean,
 *   median?: number|null, rank?: number|null}} CalendarCell
 * @typedef {'aoi'|'tiles'|'ring'|'global'} FallbackLevel method.md 4.3
 * @typedef {{series: Series, R: number|null, ci: [number, number]|null, level: FallbackLevel,
 *   yearsUsed: number[], perMonth: boolean, method: Method}} Harmonized
 * @typedef {{series: Series, yearsUsed: number[][], reasons: (string|null)[], method: Method}} Baseline
 */
import { addMonths } from './months.js';
export { seriesForAoi } from './aggregate.js';

const STUB = { id: 'stub', version: 0 };
const UNIT = 'fire-cell-days';

/**
 * Harmonize MODIS and VIIRS into one series (method.md section 4).
 * Real (M1-K6): R = sum(VIIRS)/sum(MODIS) over full overlap months; harmonized = VIIRS where
 * VIIRS operates, MODIS x R elsewhere (flagged "estimated"); fallback level when R is not
 * usable; CI by resampling whole years with `seed`.
 * Stub: R = 1, level "aoi", CI null, yearsUsed [].
 * @param {{modis: Series, viirs: Series}} sensors raw series, same start and length
 * @param {{seed?: number, perMonth?: boolean}} [opts] seed for the CI resampling; perMonth asks for per-calendar-month R
 * @returns {Harmonized}
 */
export function harmonize(sensors, { perMonth = false } = {}) {
  const { modis, viirs } = sensors;
  const flags = [];
  const values = modis.values.map((m, i) => {
    const v = viirs.values[i];
    if (v !== null) return v;
    if (m !== null) flags.push({ month: addMonths(modis.start, i), flag: 'estimated' });
    return m;
  });
  const series = { id: 'harmonized', unit: UNIT, start: modis.start, values, flags, method: STUB, comparable: true };
  return { series, R: 1, ci: null, level: 'aoi', yearsUsed: [], perMonth, method: STUB };
}

/**
 * Baseline: median of the same calendar month over earlier complete years (method.md section 5).
 * Real (M1-K7): current year excluded, partial months excluded, at least `minYears` years,
 * else value null with a reason.
 * Stub: every value null, reason "stub".
 * @param {Series} series harmonized (or raw) series
 * @param {{minYears?: number}} [opts] default 5
 * @returns {Baseline}
 */
export function baseline(series, { minYears = 5 } = {}) {
  void minYears;
  const n = series.values.length;
  return {
    series: { id: 'baseline', unit: UNIT, start: series.start, values: Array(n).fill(null), method: STUB, comparable: true },
    yearsUsed: Array.from({ length: n }, () => []),
    reasons: Array(n).fill('stub'),
    method: STUB,
  };
}

/**
 * Calendar view-model: one CalendarCell per month of the series.
 * null value -> "no-data"; flagged estimated -> "harmonized"; else "observed"; 0 stays 0.
 * Stub: never emits "partial"; median comes from the baseline when given.
 * @param {Series} series harmonized series
 * @param {Baseline} [base] baseline for the same span
 * @returns {CalendarCell[]}
 */
export function toCalendar(series, base) {
  const estimated = new Set((series.flags ?? []).filter((f) => f.flag === 'estimated').map((f) => f.month));
  return series.values.map((value, i) => {
    const ym = addMonths(series.start, i);
    const est = value !== null && estimated.has(ym);
    const cell = {
      year: Number(ym.slice(0, 4)), month: Number(ym.slice(5)), value,
      status: value === null ? 'no-data' : est ? 'harmonized' : 'observed', estimated: est,
    };
    if (base) cell.median = base.series.values[i];
    return cell;
  });
}

/**
 * KPI strip model: total in range, current month, median, years used, R and level, sensor era.
 * Stub era is always "S-NPP".
 * @param {CalendarCell[]} cells calendar cells in range, oldest first
 * @param {Harmonized} harmonized result of harmonize()
 * @param {Baseline} [base]
 * @returns {{total: number, current: CalendarCell|null, median: number|null, yearsUsed: number[],
 *   R: number|null, ci: [number, number]|null, level: FallbackLevel, era: string, method: Method}}
 */
export function kpis(cells, harmonized, base) {
  const current = cells.length ? cells[cells.length - 1] : null;
  const last = base ? base.series.values.length - 1 : -1;
  return {
    total: cells.reduce((s, c) => s + (c.value ?? 0), 0),
    current,
    median: last >= 0 ? base.series.values[last] : null,
    yearsUsed: last >= 0 ? base.yearsUsed[last] : [],
    R: harmonized.R, ci: harmonized.ci, level: harmonized.level, era: 'S-NPP', method: STUB,
  };
}

/**
 * CSV export. Stub: metadata header then rows, null as empty and 0 as 0; no quoting or
 * formula-injection guard yet (M1-K9).
 * @param {'calendar'|'sensors'} kind calendar: CalendarCell[]; sensors: {modis, viirs, harmonized} Series
 * @param {CalendarCell[]|{modis: Series, viirs: Series, harmonized: Series}} data
 * @param {{aoi?: string, dataVersion?: string, citation?: string, R?: number|null}} [meta]
 * @returns {string}
 */
export function toCsv(kind, data, meta = {}) {
  const head = [
    `# unit: ${UNIT}`, `# aoi: ${meta.aoi ?? ''}`, `# method: ${STUB.id} ${STUB.version}`,
    `# R: ${meta.R ?? ''}`, `# data version: ${meta.dataVersion ?? ''}`, `# citation: ${meta.citation ?? ''}`,
  ];
  const v = (x) => (x === null || x === undefined ? '' : String(x));
  let rows;
  if (kind === 'calendar') {
    rows = ['year,month,value,status', ...data.map((c) => `${c.year},${c.month},${v(c.value)},${c.status}`)];
  } else if (kind === 'sensors') {
    rows = ['year,month,sensor,value'];
    for (const id of ['modis', 'viirs', 'harmonized']) {
      data[id].values.forEach((x, i) => {
        const ym = addMonths(data[id].start, i);
        rows.push(`${ym.slice(0, 4)},${Number(ym.slice(5))},${id},${v(x)}`);
      });
    }
  } else {
    throw new RangeError(`unknown csv kind: ${kind}`);
  }
  return [...head, ...rows].join('\n') + '\n';
}
