/**
 * Validators for the data contract (docs/roadmap.md section 2).
 * Each returns an array of {code, path, message}; empty means valid.
 * Hard rule: null = sensor not operating, 0 = none detected. Counts are integers >= 0 or null.
 */
import { cellsPerSide, parseTileId } from './grid.js';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const SERIES_IDS = ['modis', 'viirs', 'harmonized', 'baseline', 'anomaly', 'live'];
const STATUSES = ['observed', 'harmonized', 'no-data', 'partial'];

const err = (code, path, message) => ({ code, path, message });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

/** Month index of "YYYY-MM" (months since year 0), or NaN when malformed. */
function monthNum(s) {
  const m = typeof s === 'string' ? MONTH_RE.exec(s) : null;
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN;
}

/** True when s is a canonical, in-range tile id. */
function isTileId(s) {
  try { return typeof s === 'string' && parseTileId(s) !== null; } catch { return false; }
}

/** Number of months in the manifest span, or NaN when the manifest cannot give one. */
function spanLength(manifest) {
  if (!isObj(manifest)) return NaN;
  const n = monthNum(manifest.last_month) - monthNum(manifest.month0) + 1;
  return n >= 1 ? n : NaN;
}

/** @param {unknown} m @returns {{code:string,path:string,message:string}[]} */
export function validateManifest(m) {
  const e = [];
  if (!isObj(m)) return [err('NOT_OBJECT', '', 'manifest must be an object')];
  if (m.schema !== 1) e.push(err('BAD_SCHEMA_VERSION', 'schema', 'schema must be 1'));
  for (const k of ['dataVersion', 'generated_at', 'base_url', 'citation']) {
    if (typeof m[k] !== 'string' || m[k] === '') e.push(err('BAD_STRING', k, `${k} must be a non-empty string`));
  }
  const g = m.grid;
  if (!isObj(g) || g.res !== 0.1 || g.tile_deg !== 10 || g.coarse_res !== 1) {
    e.push(err('BAD_GRID', 'grid', 'grid must be {res:0.1, tile_deg:10, coarse_res:1}'));
  }
  for (const k of ['month0', 'last_month']) {
    if (Number.isNaN(monthNum(m[k]))) e.push(err('BAD_MONTH', k, `${k} must be YYYY-MM`));
  }
  if (!Number.isNaN(monthNum(m.month0)) && !Number.isNaN(monthNum(m.last_month)) &&
      monthNum(m.last_month) < monthNum(m.month0)) {
    e.push(err('BAD_SPAN', 'last_month', 'last_month is before month0'));
  }
  if (m.granularity !== 'month') e.push(err('BAD_GRANULARITY', 'granularity', 'granularity must be "month"'));
  if (!isObj(m.coverage)) {
    e.push(err('BAD_COVERAGE', 'coverage', 'coverage must be an object'));
  } else {
    for (const s of ['modis', 'viirs']) {
      const c = m.coverage[s];
      if (!Array.isArray(c) || c.length !== 2 || Number.isNaN(monthNum(c[0])) || Number.isNaN(monthNum(c[1])) ||
          monthNum(c[1]) < monthNum(c[0])) {
        e.push(err('BAD_COVERAGE', `coverage.${s}`, `coverage.${s} must be [from, to] as YYYY-MM, from <= to`));
      }
    }
  }
  if (!isObj(m.satellites)) e.push(err('BAD_SATELLITES', 'satellites', 'satellites must be an object'));
  if (!Array.isArray(m.tiles) || m.tiles.some((t) => !isTileId(t))) {
    e.push(err('BAD_TILES', 'tiles', 'tiles must be an array of x{tx}y{ty} ids'));
  } else if (new Set(m.tiles).size !== m.tiles.length) {
    e.push(err('DUPLICATE_TILE', 'tiles', 'tiles has duplicate ids'));
  }
  if (!Array.isArray(m.caveats) || m.caveats.some((c) => typeof c !== 'string')) {
    e.push(err('BAD_CAVEATS', 'caveats', 'caveats must be an array of ids'));
  }
  return e;
}

/**
 * @param {unknown} t tile {cell[], month[], modis[], viirs[]}
 * @param {{manifest?: object, res?: number}} [opts] res 0.1 (default) or 1
 */
export function validateTile(t, { manifest, res = 0.1 } = {}) {
  const e = [];
  if (!isObj(t)) return [err('NOT_OBJECT', '', 'tile must be an object')];
  const cols = ['cell', 'month', 'modis', 'viirs'];
  let ok = true;
  for (const k of cols) {
    if (!Array.isArray(t[k])) { e.push(err('NOT_ARRAY', k, `${k} must be an array`)); ok = false; }
  }
  if (!ok) return e;
  if (new Set(cols.map((k) => t[k].length)).size > 1) {
    e.push(err('COLUMN_LENGTH_MISMATCH', '', 'cell, month, modis and viirs must have the same length'));
  }
  const per = cellsPerSide(res);
  const span = spanLength(manifest);
  const seen = new Set();
  t.cell.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 0 || c >= per * per) {
      e.push(err('CELL_OUT_OF_RANGE', `cell[${i}]`, `cell must be an integer in 0..${per * per - 1}`));
    }
    const mo = t.month[i];
    if (!Number.isInteger(mo) || mo < 0) {
      e.push(err('BAD_MONTH_INDEX', `month[${i}]`, 'month must be an integer index >= 0'));
    } else if (!Number.isNaN(span) && mo >= span) {
      e.push(err('MONTH_OUT_OF_RANGE', `month[${i}]`, `month ${mo} is outside the manifest span 0..${span - 1}`));
    }
    const key = `${c}:${mo}`;
    if (seen.has(key)) e.push(err('DUPLICATE_ROW', `cell[${i}]`, `cell ${c} month ${mo} appears twice`));
    seen.add(key);
  });
  const m0 = Number.isNaN(span) ? NaN : monthNum(manifest.month0);
  for (const k of ['modis', 'viirs']) {
    const cov = Number.isNaN(m0) || !isObj(manifest.coverage) || !Array.isArray(manifest.coverage[k]) ? null
      : manifest.coverage[k].map((c) => monthNum(c) - m0);
    t[k].forEach((v, i) => {
      if (v !== null && !isCount(v)) {
        e.push(err('BAD_COUNT', `${k}[${i}]`, `${k} must be an integer >= 0 or null, got ${v}`));
        return;
      }
      const mo = t.month[i];
      if (!cov || !Number.isInteger(mo) || mo < 0 || mo >= span || cov.some(Number.isNaN)) return;
      const inside = mo >= cov[0] && mo <= cov[1];
      if (inside && v === null) {
        e.push(err('NULL_INSIDE_COVERAGE', `${k}[${i}]`, `${k} is null in month ${mo} inside its coverage; use 0 for none detected`));
      } else if (!inside && v !== null) {
        e.push(err('COUNT_OUTSIDE_COVERAGE', `${k}[${i}]`, `${k} has a count in month ${mo} outside its coverage; must be null`));
      }
    });
  }
  return e;
}

/**
 * @param {unknown} s Series {id, unit, start, values, method, comparable, flags?}
 * @param {{manifest?: object}} [opts]
 */
export function validateSeries(s, { manifest } = {}) {
  const e = [];
  if (!isObj(s)) return [err('NOT_OBJECT', '', 'series must be an object')];
  if (!SERIES_IDS.includes(s.id)) e.push(err('BAD_SERIES_ID', 'id', `id must be one of ${SERIES_IDS.join(', ')}`));
  if (s.unit !== 'fire-cell-days') e.push(err('BAD_UNIT', 'unit', 'unit must be "fire-cell-days"'));
  const start = monthNum(s.start);
  if (Number.isNaN(start)) e.push(err('BAD_MONTH', 'start', 'start must be YYYY-MM'));
  if (!isObj(s.method) || typeof s.method.id !== 'string' || typeof s.method.version === 'undefined') {
    e.push(err('BAD_METHOD', 'method', 'method must be {id, version}'));
  }
  if (typeof s.comparable !== 'boolean') e.push(err('BAD_COMPARABLE', 'comparable', 'comparable must be a boolean'));
  if (s.flags !== undefined && !Array.isArray(s.flags)) e.push(err('BAD_FLAGS', 'flags', 'flags must be an array'));
  if (!Array.isArray(s.values)) {
    e.push(err('NOT_ARRAY', 'values', 'values must be an array'));
    return e;
  }
  const rawCount = s.id === 'modis' || s.id === 'viirs';
  s.values.forEach((v, i) => {
    if (v === null) return;
    if (rawCount ? !isCount(v) : typeof v !== 'number' || !Number.isFinite(v)) {
      e.push(err('BAD_VALUE', `values[${i}]`, rawCount
        ? `${s.id} values must be integers >= 0 or null, got ${v}`
        : `values must be finite numbers or null, got ${v}`));
    }
  });
  const span = spanLength(manifest);
  if (!Number.isNaN(span) && !Number.isNaN(start) && s.id !== 'live') {
    const first = start - monthNum(manifest.month0);
    if (first < 0 || first + s.values.length > span) {
      e.push(err('MONTH_OUT_OF_RANGE', 'start', `series months ${first}..${first + s.values.length - 1} fall outside the manifest span 0..${span - 1}`));
    }
    const cov = rawCount && isObj(manifest.coverage) && Array.isArray(manifest.coverage[s.id])
      ? manifest.coverage[s.id].map((c) => monthNum(c) - monthNum(manifest.month0)) : null;
    if (cov && !cov.some(Number.isNaN)) {
      s.values.forEach((v, i) => {
        const mo = first + i;
        if (mo < 0 || mo >= span || (v !== null && !isCount(v))) return;
        const inside = mo >= cov[0] && mo <= cov[1];
        if (inside && v === null) {
          e.push(err('NULL_INSIDE_COVERAGE', `values[${i}]`, `${s.id} is null in month ${mo} inside its coverage; use 0 for none detected`));
        } else if (!inside && v !== null) {
          e.push(err('COUNT_OUTSIDE_COVERAGE', `values[${i}]`, `${s.id} has a count in month ${mo} outside its coverage; must be null`));
        }
      });
    }
  }
  return e;
}

/**
 * @param {unknown} c CalendarCell {year, month, value, status, estimated, median?, rank?}
 * @param {{manifest?: object}} [opts]
 */
export function validateCalendarCell(c, { manifest } = {}) {
  const e = [];
  if (!isObj(c)) return [err('NOT_OBJECT', '', 'calendar cell must be an object')];
  if (!Number.isInteger(c.year)) e.push(err('BAD_YEAR', 'year', 'year must be an integer'));
  if (!Number.isInteger(c.month) || c.month < 1 || c.month > 12) e.push(err('BAD_MONTH', 'month', 'month must be an integer 1..12'));
  if (c.value !== null && (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0)) {
    e.push(err('BAD_VALUE', 'value', 'value must be a number >= 0 or null'));
  }
  if (!STATUSES.includes(c.status)) {
    e.push(err('BAD_STATUS', 'status', `status must be one of ${STATUSES.join(', ')}`));
  } else if (c.status === 'no-data' && c.value !== null) {
    e.push(err('STATUS_VALUE_MISMATCH', 'value', 'no-data cells must have value null'));
  } else if ((c.status === 'observed' || c.status === 'harmonized') && c.value === null) {
    e.push(err('STATUS_VALUE_MISMATCH', 'value', `${c.status} cells must have a value (0 means none detected)`));
  }
  if (typeof c.estimated !== 'boolean') e.push(err('BAD_ESTIMATED', 'estimated', 'estimated must be a boolean'));
  for (const k of ['median', 'rank']) {
    if (c[k] !== undefined && c[k] !== null && (typeof c[k] !== 'number' || !Number.isFinite(c[k]))) {
      e.push(err('BAD_VALUE', k, `${k} must be a finite number or null`));
    }
  }
  const span = spanLength(manifest);
  if (!Number.isNaN(span) && Number.isInteger(c.year) && Number.isInteger(c.month)) {
    const idx = c.year * 12 + c.month - 1 - monthNum(manifest.month0);
    if (idx < 0 || idx >= span) {
      e.push(err('MONTH_OUT_OF_RANGE', 'month', `${c.year}-${String(c.month).padStart(2, '0')} is outside the manifest span`));
    }
  }
  return e;
}
