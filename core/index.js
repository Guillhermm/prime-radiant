/** Public surface of `core/`. Every export is documented in its own module. */
export { seriesForAoi } from './aggregate.js';
export { harmonize } from './harmonize.js';
export { baseline } from './baseline.js';
export { toCalendar, kpis } from './calendar.js';
export { toCsv } from './csv.js';
export { validateManifest, validateTile, validateSeries, validateCalendarCell } from './schema.js';
export { locate, cellCenter, normalizeLon, clampLat, parseTileId } from './grid.js';
