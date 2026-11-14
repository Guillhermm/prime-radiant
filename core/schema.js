import { isMonth, monthIndex } from './months.js';

/**
 * Validators for the contract. Each returns a list of errors, empty when valid.
 * An error is `{code, path, message}`; `code` is a stable name such as
 * "tile.length-mismatch" that tests and callers can match on.
 */

const err = (code, path, message) => ({ code, path, message });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {unknown} m parsed `data/manifest.json`
 * @returns {{code: string, path: string, message: string}[]}
 */
export const validateManifest = (m) => {
  if (!isObj(m)) return [err('manifest.not-object', '', 'manifest must be an object')];
  const errors = [];
  const bad = (code, path, message) => errors.push(err(code, path, message));
  if (m.schema !== 1) bad('manifest.schema', 'schema', 'schema must be 1');
  for (const k of ['dataVersion', 'generated_at', 'base_url', 'citation']) {
    if (typeof m[k] !== 'string' || m[k] === '') bad('manifest.string', k, `${k} must be a non-empty string`);
  }
  const g = m.grid;
  if (!isObj(g) || ![g.res, g.tile_deg, g.coarse_res].every((v) => typeof v === 'number' && v > 0)) {
    bad('manifest.grid', 'grid', 'grid needs positive numbers res, tile_deg, coarse_res');
  }
  if (!isMonth(m.month0)) bad('manifest.month', 'month0', 'month0 must be YYYY-MM');
  if (!isMonth(m.last_month)) bad('manifest.month', 'last_month', 'last_month must be YYYY-MM');
  const rangeOk = isMonth(m.month0) && isMonth(m.last_month);
  if (rangeOk && monthIndex(m.month0, m.last_month) < 0) {
    bad('manifest.month-order', 'last_month', 'last_month precedes month0');
  }
  if (m.granularity !== 'month') bad('manifest.granularity', 'granularity', 'granularity must be "month"');
  for (const s of ['modis', 'viirs']) {
    const c = m.coverage?.[s];
    if (!Array.isArray(c) || c.length !== 2 || !c.every(isMonth)) {
      bad('manifest.coverage', `coverage.${s}`, `coverage.${s} must be [from, to] as YYYY-MM`);
    } else if (rangeOk && (monthIndex(c[0], c[1]) < 0 || monthIndex(m.month0, c[0]) < 0 || monthIndex(c[1], m.last_month) < 0)) {
      bad('manifest.coverage', `coverage.${s}`, `coverage.${s} must be ordered and inside month0..last_month`);
    }
  }
  if (!isObj(m.satellites)) bad('manifest.satellites', 'satellites', 'satellites must be an object');
  if (!Array.isArray(m.tiles) || !m.tiles.every((t) => typeof t === 'string' && /^\d+(\.\d+)?\/x\d+y\d+$/.test(t))) {
    bad('manifest.tiles', 'tiles', 'tiles must be ids like "0.1/x12y7"');
  }
  if (!Array.isArray(m.caveats) || !m.caveats.every((c) => typeof c === 'string')) {
    bad('manifest.caveats', 'caveats', 'caveats must be a list of ids');
  }
  return errors;
};

/**
 * Columnar tile `{cell[], month[], modis[], viirs[]}`. A sensor column holds a count, or
 * null where that sensor was not operating. Rows are sparse: a missing (cell, month) is 0
 * inside the sensor's coverage and null outside it.
 * @param {unknown} t parsed tile
 * @param {{monthCount?: number, cellsPerSide?: number, coverage?: Record<string, [number, number]>}} [opts]
 *   `monthCount` bounds the month index (months from month0 to last_month); `cellsPerSide`
 *   is 100 at 0.1 degrees and 10 at 1 degree; `coverage` gives each sensor's [first, last]
 *   month index, and a count must be null exactly outside it.
 */
export const validateTile = (t, { monthCount, cellsPerSide = 100, coverage } = {}) => {
  if (!isObj(t)) return [err('tile.not-object', '', 'tile must be an object')];
  const cols = ['cell', 'month', 'modis', 'viirs'];
  const missing = cols.filter((c) => !Array.isArray(t[c]));
  if (missing.length) return missing.map((c) => err('tile.missing-column', c, `column ${c} must be an array`));
  const errors = [];
  const n = t.cell.length;
  if (cols.some((c) => t[c].length !== n)) {
    errors.push(err('tile.length-mismatch', '', `columns differ in length: ${cols.map((c) => `${c}=${t[c].length}`).join(', ')}`));
    return errors;
  }
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const cell = t.cell[i];
    const row = Math.floor(cell / 100);
    const col = cell % 100;
    if (!Number.isInteger(cell) || cell < 0 || row >= cellsPerSide || col >= cellsPerSide) {
      errors.push(err('tile.cell-out-of-range', `cell[${i}]`, `cell ${cell} is outside a ${cellsPerSide}x${cellsPerSide} tile`));
    }
    const mo = t.month[i];
    if (!Number.isInteger(mo) || mo < 0 || (monthCount !== undefined && mo >= monthCount)) {
      errors.push(err('tile.month-out-of-range', `month[${i}]`, `month index ${mo} is outside 0..${monthCount === undefined ? '' : monthCount - 1}`));
    }
    for (const s of ['modis', 'viirs']) {
      const v = t[s][i];
      const range = coverage?.[s];
      if (range && Number.isInteger(mo) && (v === null) !== (mo < range[0] || mo > range[1])) {
        errors.push(err('tile.null-vs-coverage', `${s}[${i}]`, `${s} must be null outside coverage and a count inside it (month ${mo})`));
      }
      if (v === null) continue;
      if (!isCount(v) || !Number.isInteger(v)) errors.push(err('tile.not-integer', `${s}[${i}]`, `${s} count must be an integer or null, got ${v}`));
      else if (v < 0) errors.push(err('tile.negative-count', `${s}[${i}]`, `${s} count ${v} is negative`));
    }
    const key = `${cell}:${mo}`;
    if (seen.has(key)) errors.push(err('tile.duplicate-row', `cell[${i}]`, `cell ${cell} month ${mo} appears twice`));
    seen.add(key);
  }
  return errors;
};

const SERIES_IDS = ['modis', 'viirs', 'harmonized', 'baseline', 'anomaly', 'live'];

/**
 * Series `{id, unit, start, values, flags?, method:{id,version}, comparable}`.
 * null in `values` means the sensor was not operating, 0 means nothing detected.
 */
export const validateSeries = (s) => {
  if (!isObj(s)) return [err('series.not-object', '', 'series must be an object')];
  const errors = [];
  const bad = (code, path, message) => errors.push(err(code, path, message));
  if (!SERIES_IDS.includes(s.id)) bad('series.id', 'id', `id must be one of ${SERIES_IDS.join(', ')}`);
  if (s.unit !== 'fire-cell-days') bad('series.unit', 'unit', 'unit must be "fire-cell-days"');
  if (!isMonth(s.start)) bad('series.start', 'start', 'start must be YYYY-MM');
  if (!Array.isArray(s.values) || !s.values.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v)))) {
    bad('series.values', 'values', 'values must be numbers or null');
  }
  if (s.flags !== undefined && !Array.isArray(s.flags)) bad('series.flags', 'flags', 'flags must be an array');
  if (!isObj(s.method) || typeof s.method.id !== 'string' || typeof s.method.version !== 'string') {
    bad('series.method', 'method', 'method must be {id, version} strings');
  }
  if (typeof s.comparable !== 'boolean') bad('series.comparable', 'comparable', 'comparable must be a boolean');
  return errors;
};

const CELL_STATUS = ['observed', 'harmonized', 'no-data', 'partial'];

/** CalendarCell `{year, month, value, status, estimated, median?, rank?}`. */
export const validateCalendarCell = (c) => {
  if (!isObj(c)) return [err('cell.not-object', '', 'calendar cell must be an object')];
  const errors = [];
  const bad = (code, path, message) => errors.push(err(code, path, message));
  if (!Number.isInteger(c.year)) bad('cell.year', 'year', 'year must be an integer');
  if (!Number.isInteger(c.month) || c.month < 1 || c.month > 12) bad('cell.month', 'month', 'month must be 1..12');
  if (c.value !== null && !(typeof c.value === 'number' && Number.isFinite(c.value))) bad('cell.value', 'value', 'value must be a number or null');
  if (!CELL_STATUS.includes(c.status)) bad('cell.status', 'status', `status must be one of ${CELL_STATUS.join(', ')}`);
  if (typeof c.estimated !== 'boolean') bad('cell.estimated', 'estimated', 'estimated must be a boolean');
  for (const k of ['median', 'rank']) {
    if (c[k] !== undefined && c[k] !== null && !(typeof c[k] === 'number' && Number.isFinite(c[k]))) bad(`cell.${k}`, k, `${k} must be a number when present`);
  }
  if (c.status === 'no-data' && c.value !== null) bad('cell.no-data-value', 'value', 'a no-data cell must have value null');
  if (c.value === null && c.status !== 'no-data') bad('cell.null-needs-no-data', 'status', 'a null value means no data, so status must be "no-data"');
  return errors;
};
