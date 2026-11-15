/**
 * Public surface of core/. Shapes are the contract in docs/roadmap.md section 2 and validate
 * with core/schema.js. Numbers are preliminary until science gate V1.
 * null = sensor not operating, 0 = none detected, always.
 *
 * Shared shapes (JSDoc typedefs):
 * @typedef {{id: string, version: number}} Method
 * @typedef {{id: 'modis'|'viirs'|'harmonized'|'baseline'|'anomaly'|'live', unit: 'fire-cell-days',
 *   start: string, values: (number|null)[], flags?: {month: string, flag: string}[],
 *   method: Method, comparable: boolean}} Series
 * @typedef {{year: number, month: number, value: number|null,
 *   status: 'observed'|'harmonized'|'no-data'|'partial', estimated: boolean,
 *   flags?: string[], median?: number|null, rank?: number|null}} CalendarCell
 * @typedef {'aoi'|'tiles'|'ring'|'global'} FallbackLevel method.md 4.3
 * @typedef {{value: number|null, perMonth?: object[], window?: {from: string, to: string}, ci: [number, number]|null, level: FallbackLevel,
 *   nYears: number, failedDraws: number, usable: boolean}} Ratio R or K, see harmonize.js
 * @typedef {{series: Series, R: Ratio, K: Ratio|null, reasons: string[]}} Harmonized
 * @typedef {{series: Series, yearsUsed: number[][], reasons: (string|null)[], method: Method}} Baseline
 */
export { seriesForAoi, cellCount, MAX_FINE_CELLS, fallbackLevels, seriesForLevels } from './aggregate.js';
export { annualTotals } from './series.js';
export { decodeTile, coverageLookup, tilesForBbox } from './tiles.js';
export { baseline } from './baseline.js';
export { anomaly, yearRank } from './anomaly.js';
export { harmonize } from './harmonize.js';
export { toCalendar, kpis } from './calendar.js';
export { toCsv } from './csv.js';
