import { binClass } from '../bins.js';
import { MONTH_NAMES, monthLabel } from '../format.js';
import { tableModel } from './data-table.js';
import { gridModel, cellLabel, initialPosition, nextPosition } from './calendar-grid.js';
import { h } from './h.js';

/**
 * Input contract (core/anomaly.js).
 *
 * Either the CalendarCell carries the fields itself:
 *   { ...CalendarCell, rank: number|null, flagged: boolean }
 * or `withAnomaly(cells, series)` merges an anomaly Series into plain cells:
 *   Series { id: 'anomaly', unit: 'fire-cell-days', start: 'YYYY-MM',
 *            values: (number|null)[],   // percentile rank of the month against its baseline, 0..1,
 *                                       // ties split evenly (0.5 = the historical median);
 *                                       // null when there is no rank (no data, or fewer baseline years than n)
 *            flags: boolean[],          // same length as values; true = flagged
 *            method: { id, version }, comparable: true }
 * rank is a fraction, not a percent.
 */

export const DIV_CLASSES = 11;
export const CENTER_CLASS = 5;

const pad = (n) => String(n).padStart(2, '0');
const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/** Cells with rank and flagged taken from an anomaly Series, matched by month. */
export const withAnomaly = (cells, series) => {
  if (!series) return cells;
  const first = monthIdx(series.start);
  return cells.map((c) => {
    const i = c.year * 12 + c.month - 1 - first;
    if (i < 0 || i >= series.values.length) return { ...c, rank: null, flagged: false };
    return { ...c, rank: series.values[i], flagged: series.flags?.[i] === true };
  });
};

/** 0..10, 5 = centered on the median (rank 0.5). Display binning only: equal slices of rank. */
export const divClass = (rank) => Math.min(DIV_CLASSES - 1, Math.max(0, Math.floor(rank * DIV_CLASSES)));

/** Percentile edges of a class, as whole percents: class 0 is 0 to 9, class 10 is 91 to 100. */
export const divRange = (cls) => [Math.round((cls / DIV_CLASSES) * 100), Math.round(((cls + 1) / DIV_CLASSES) * 100)];

export const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

const side = (cls) => (cls < CENTER_CLASS ? 'below median' : cls > CENTER_CLASS ? 'above median' : 'near median');

/** "91st percentile of its baseline, above median", or the no-rank text. */
export const rankText = (rank) => (typeof rank === 'number'
  ? `${ordinal(Math.round(rank * 100))} percentile of its baseline, ${side(divClass(rank))}`
  : 'no percentile rank (baseline too short)');

/** Screen reader and hover text: the calendar label plus percentile rank and the flag. */
export const anomalyLabel = (cell, aoiCells) => {
  const base = cellLabel(cell, aoiCells);
  if (cell.value === null) return base;
  const parts = [base, rankText(cell.rank)];
  if (typeof cell.rank === 'number' && cell.flagged) parts.push('flagged');
  return parts.join(', ');
};

export const anomalyCellModel = (m, aoiCells) => {
  const { cell } = m;
  const ranked = cell.value !== null && typeof cell.rank === 'number';
  const cls = ranked ? divClass(cell.rank) : null;
  return {
    ...m,
    div: cls,
    cls: cell.value === null ? 'nodata' : ranked ? `div-${cls}` : 'div-norank',
    label: anomalyLabel(cell, aoiCells),
    text: ranked ? extremeWord(cell.rank) ?? ordinal(Math.round(cell.rank * 100)) : '',
    // The phone's two-character cells: L and H for the extremes, so no cell reads "0" or "100".
    short: ranked ? ({ 0: 'L', 1: 'H' })[cell.rank] ?? String(Math.round(cell.rank * 100)) : '',
    flagged: ranked && cell.flagged === true,
    bin: binClass(cell.value, aoiCells),
  };
};

/** Same shape as calendar-grid gridModel, with each cell colored by rank. */
export const anomalyGridModel = (cells, { aoiCells }) => {
  const model = gridModel(cells, { aoiCells });
  return { ...model, rows: model.rows.map((r) => ({ ...r, cells: r.cells.map((m) => (m ? anomalyCellModel(m, aoiCells) : null)) })) };
};

// Only an exact 0 or 1 is the lowest or highest of its month; a rank that merely rounds there is not.
const extremeWord = (rank) => ({ 0: 'Low', 1: 'High' })[rank] ?? null;

const sideWords = { 'below median': 'Below the median', 'near median': 'Near the median', 'above median': 'Above the median' };

/**
 * Answer card for the Anomalies tab: the latest ranked month, its side of the median, and the
 * flagged months of the range (newest first). null when no month has a rank.
 */
export const anomalyAnswer = (cells) => {
  const ranked = cells.filter((c) => c.value !== null && typeof c.rank === 'number').sort((a, b) => b.year - a.year || b.month - a.month);
  if (!ranked.length) return null;
  const c = ranked[0];
  const name = MONTH_NAMES[c.month - 1];
  const flagged = ranked.filter((x) => x.flagged);
  return {
    cell: c,
    headline: `${monthLabel(c.year, c.month)} · ${ordinal(Math.round(c.rank * 100))} percentile`,
    sentence: `${c.flagged ? 'Flagged as unusual' : sideWords[side(divClass(c.rank))]} for ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}.`,
    flagged,
    flaggedText: `${flagged.length} ${flagged.length === 1 ? 'month' : 'months'} flagged in this range`,
  };
};

/** Table alternative: one row per year (newest first), one column per month, the percentile in words. */
export const anomalyTableModel = (cells, { synthetic = false } = {}) => {
  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => b - a);
  const at = new Map(cells.map((c) => [`${c.year}-${c.month}`, c]));
  const text = (c) => {
    if (!c) return '';
    if (c.value === null) return 'No data';
    if (typeof c.rank !== 'number') return 'No rank';
    const word = { 0: 'record low', 1: 'record high' }[c.rank];
    return `${word ?? ordinal(Math.round(c.rank * 100))}${c.flagged ? ', flagged' : ''}`;
  };
  return tableModel({
    caption: `Percentile of each month among the same month in earlier years.${synthetic ? ' Synthetic data, not real fire detections.' : ''}`,
    corner: 'Year',
    columns: MONTH_NAMES.map((m) => m.slice(0, 3)),
    rows: years.map((y) => ({ header: String(y), cells: MONTH_NAMES.map((_, i) => text(at.get(`${y}-${i + 1}`))) })),
  });
};

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
const cellClass = (m) => ['cal-cell', m.cls, m.flagged && 'is-flagged', m.estimated && 'is-estimated', m.partial && 'is-partial'].filter(Boolean).join(' ');

/**
 * mount(container, {cells, aoiCells, onSelect, onClose}). Same contract as calendar-grid.mount;
 * `cells` carry rank and flagged. Returns {update({cells, aoiCells}), focus(), destroy()}.
 */
export const mount = (container, deps) => {
  let { cells, aoiCells } = deps;
  let model;
  let pos = null;
  const nodes = new Map();
  const readout = h('p', { class: 'cal-readout', 'aria-hidden': 'true' });
  const gridHost = h('div', { class: 'cal-scroll' });
  container.replaceChildren(h('div', { class: 'calendar anomaly-layer' }, gridHost, readout));

  const key = (r, c) => `${r}:${c}`;
  const posOf = (node) => ({ row: Number(node.dataset.row), col: Number(node.dataset.col) });
  const modelAt = (node) => model.rows[Number(node.dataset.row)]?.cells[Number(node.dataset.col)];
  const cellOf = (target) => target.closest?.('[data-row]');
  const activate = (next, { focus = false } = {}) => {
    if (!next) return;
    const prev = nodes.get(key(pos.row, pos.col));
    if (prev) prev.tabIndex = -1;
    pos = next;
    const node = nodes.get(key(pos.row, pos.col));
    node.tabIndex = 0;
    if (focus) node.focus();
  };
  const showReadout = (node) => { const m = node && modelAt(node); readout.textContent = m ? m.label : ''; };

  const buildGrid = () => {
    nodes.clear();
    model = anomalyGridModel(cells, { aoiCells });
    pos = pos && model.rows[pos.row]?.cells[pos.col] ? pos : initialPosition(model);
    const header = h('div', { role: 'row', class: 'cal-row cal-head' },
      h('div', { role: 'columnheader', class: 'cal-year', 'aria-label': 'Year' }),
      model.columns.map((name) => h('div', { role: 'columnheader', class: 'cal-colhead', 'aria-label': name },
        h('span', { class: 'long', text: name.slice(0, 3) }), h('span', { class: 'short', text: name[0] }))));
    const rows = model.rows.map((row, r) => h('div', { role: 'row', class: 'cal-row' },
      h('div', { role: 'rowheader', class: 'cal-year', text: String(row.year) }),
      row.cells.map((m, c) => {
        if (m === null) return h('div', { role: 'gridcell', class: 'cal-cell is-empty', 'aria-disabled': 'true', 'aria-label': `${monthLabel(row.year, c + 1)}, outside the selected range` });
        const node = h('div', {
          role: 'gridcell', class: cellClass(m), tabindex: pos && pos.row === r && pos.col === c ? '0' : '-1',
          'aria-label': m.label, 'data-row': r, 'data-col': c,
        }, h('span', { class: 'cal-num', 'aria-hidden': 'true' }, h('span', { class: 'long', text: m.text }), h('span', { class: 'short', text: m.short })));
        nodes.set(key(r, c), node);
        return node;
      })));
    const grid = h('div', { role: 'grid', class: 'cal-grid', 'aria-label': 'Anomaly versus median, by month and year', 'aria-rowcount': rows.length + 1, 'aria-colcount': 13 }, header, rows);
    gridHost.replaceChildren(grid);
    grid.addEventListener('focusin', (ev) => { const n = cellOf(ev.target); if (n) { activate(posOf(n)); showReadout(n); } });
    grid.addEventListener('mouseover', (ev) => { const n = cellOf(ev.target); if (n) showReadout(n); });
    grid.addEventListener('mouseleave', () => { readout.textContent = ''; });
    grid.addEventListener('click', (ev) => {
      const n = cellOf(ev.target);
      if (!n) return;
      activate(posOf(n), { focus: true });
      deps.onSelect?.(modelAt(n).cell);
    });
    grid.addEventListener('keydown', (ev) => {
      const n = cellOf(ev.target);
      if (!n) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); deps.onSelect?.(modelAt(n).cell); return; }
      if (ev.key === 'Escape') { readout.textContent = ''; deps.onClose?.(); return; }
      if (!NAV_KEYS.includes(ev.key)) return;
      ev.preventDefault();
      activate(nextPosition(model, posOf(n), ev.key, { ctrl: ev.ctrlKey || ev.metaKey }), { focus: true });
    });
  };

  buildGrid();
  return {
    update: (next) => { ({ cells, aoiCells } = { cells, aoiCells, ...next }); buildGrid(); },
    focus: () => pos && nodes.get(key(pos.row, pos.col))?.focus(),
    destroy: () => container.replaceChildren(),
  };
};
