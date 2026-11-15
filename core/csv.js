/**
 * CSV export (roadmap M1-K9). Deterministic: no clock, the generated date comes in `meta`.
 * RFC 4180: CRLF line ends, fields with comma, quote, CR or LF are double-quoted, quotes doubled.
 * null exports as an empty cell, 0 as 0 (never collapsed).
 */
import { addMonths } from './months.js';

const UNIT = 'fire-cell-days';
const SENSOR_ORDER = ['modis', 'viirs', 'noaa20', 'harmonized'];

/**
 * Formula-injection guard. We use the OWASP single-quote form (prefix `'`), not the tab
 * prefix: a tab is invisible, survives into the cell value in some tools and is stripped by
 * others (so the guard silently vanishes), while the quote is the form OWASP names first and
 * spreadsheets render as plain text. Applies to TEXT only; numbers are written with
 * String(number) after the guard decision, so negative numbers stay numeric.
 */
function guard(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** RFC 4180 field quoting. */
function quote(text) {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Estimated values are exported to 1 decimal (display precision); core sums stay exact. */
const EST_DECIMALS = 1;
const est = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(EST_DECIMALS)) : v);

/** A cell: null/undefined/non-finite number empty, finite number as is, anything else guarded text. */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return quote(guard(String(v)));
}

const row = (cells) => cells.map(cell).join(',');

/**
 * Metadata line `# key: value`, never quoted, so every line starts with `#` and readers that
 * skip comment lines (pandas comment='#', R comment.char) drop it whole. CR and LF become
 * spaces, so a value cannot start a new record. Commas become `;` and double quotes `'`, so
 * a spreadsheet keeps the whole line in one cell that starts with `#`: a value such as
 * `x, =cmd` can never open a new cell that starts a formula.
 */
function metaLine(key, value) {
  const v = String(value ?? '').replace(/[\r\n]+/g, ' ').replaceAll(',', ';').replaceAll('"', "'");
  return `# ${key}: ${v}`;
}

/** Ratios in the header are rounded to RATIO_DECIMALS; data rows stay exact. */
const RATIO_DECIMALS = 3;
const round = (x) => (typeof x === 'number' && Number.isFinite(x) ? String(Number(x.toFixed(RATIO_DECIMALS))) : '');

function ratioText(r) {
  if (!r) return '';
  const pm = r.perMonth ? `; per-month (Jan..Dec)=${r.perMonth.map((x) => round(x?.value ?? x)).join('|')}` : '';
  const win = r.window ? `; window=${r.window.from}..${r.window.to}` : '';
  const ci = r.ci ? `${round(r.ci[0])}..${round(r.ci[1])}` : '';
  return `value=${round(r.value)}; ci=${ci}; level=${r.level ?? ''}; usable=${r.usable ?? ''}${win}${pm}; rounded to ${RATIO_DECIMALS} decimals`;
}

function bboxText(b) {
  return Array.isArray(b) ? b.join(' ') : '';
}

/**
 * @param {'calendar'|'sensors'} kind
 *   calendar: CalendarCell[] (year, month, value, status, estimated, flags?: string[]);
 *   sensors: {modis, viirs, noaa20?, harmonized} Series, one long table.
 * @param {object[]|object} data
 * @param {{aoi?: string, bbox?: number[], sensors?: string[], method?: {id: string, version: number},
 *   R?: object|null, K?: object|null, dataVersion?: string, domain?: string, generated?: string,
 *   citation?: string, caveats?: string[], flags?: {month: string|null, flag: string}[]}} [meta]
 *   `flags` are the harmonized series flags, used for the calendar flags column.
 * @returns {string}
 */
export function toCsv(kind, data, meta = {}) {
  if (kind !== 'calendar' && kind !== 'sensors') throw new RangeError(`unknown csv kind: ${kind}`);
  const ids = kind === 'sensors' ? SENSOR_ORDER.filter((id) => data?.[id]) : [];
  const sensorSet = meta.sensors ?? (kind === 'sensors' ? ids : ['modis', 'viirs', 'noaa20', 'harmonized']);
  const m = meta.method;
  const head = [
    ['unit', UNIT], ['aoi', meta.aoi ?? ''], ['aoi bbox (w s e n)', bboxText(meta.bbox)],
    ['sensors', sensorSet.join(' ')], ['method', m ? `${m.id} ${m.version}` : ''],
    ['R', ratioText(meta.R)], ['K', ratioText(meta.K)], ['data version', meta.dataVersion ?? ''],
    ['domain', meta.domain ?? ''], ['generated', meta.generated ?? ''], ['citation', meta.citation ?? ''],
    ['caveats', (meta.caveats ?? []).join(' ')],
  ].map(([k, v]) => metaLine(k, v));

  let rows;
  if (kind === 'calendar') {
    const byMonth = new Map();
    for (const f of meta.flags ?? []) {
      if (f.month) byMonth.set(f.month, [...(byMonth.get(f.month) ?? []), f.flag]);
    }
    rows = [row(['year', 'month', 'value', 'status', 'estimated', 'flags'])];
    for (const c of data) {
      const ym = `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}`;
      const flags = [...new Set([...(c.flags ?? []), ...(byMonth.get(ym) ?? [])])].join(' ');
      rows.push(row([c.year, c.month, c.estimated ? est(c.value) : c.value, c.status, c.estimated ? 'true' : 'false', flags]));
    }
  } else {
    rows = [row(['year', 'month', 'sensor', 'value'])];
    for (const id of ids) {
      const estimated = new Set((data[id].flags ?? []).filter((f) => f.flag === 'estimated').map((f) => f.month));
      data[id].values.forEach((x, i) => {
        const ym = addMonths(data[id].start, i);
        rows.push(row([Number(ym.slice(0, 4)), Number(ym.slice(5)), id, estimated.has(ym) ? est(x) : x]));
      });
    }
  }
  return [...head, ...rows].join('\r\n') + '\r\n';
}
