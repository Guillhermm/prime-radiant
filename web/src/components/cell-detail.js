import { density } from '../bins.js';
import { caveatsForCell } from '../caveat-catalog.js';
import { formatCount, formatDensity, monthLabel } from '../format.js';
import { rankText } from './anomaly-layer.js';
import { h } from './h.js';

export const NOT_AVAILABLE = 'not available yet';

const STATUS_TEXT = { observed: 'Observed', harmonized: 'Harmonized', partial: 'Partial month', 'no-data': 'No data' };

/**
 * View model of the panel. Optional cell fields (`r`, `median`, `medianYears`) show
 * "not available yet" when absent: nothing is computed or guessed here.
 * @param {object} cell CalendarCell
 * @param {{aoiCells: number, layer?: 'counts'|'anomaly'}} opts grid cells in the AOI (density
 *   denominator); layer 'anomaly' adds the cell's percentile rank and flag
 */
export const detailModel = (cell, { aoiCells, layer = 'counts' }) => {
  const title = monthLabel(cell.year, cell.month);
  const caveats = caveatsForCell(cell);
  if (cell.value === null) {
    return { title, rows: [{ label: 'Status', value: STATUS_TEXT['no-data'] }, { label: 'Note', value: 'The sensor was not operating. This is not zero.' }], caveats: caveats.filter((c) => c.id === 'C1') };
  }
  const d = density(cell.value, aoiCells);
  const num = (v) => (typeof v === 'number' ? formatCount(v) : NOT_AVAILABLE);
  const rows = [
    { label: 'Value', value: `${formatCount(cell.value)} fire-cell-days` },
    { label: 'Density', value: d === null ? NOT_AVAILABLE : `${formatDensity(d)} per 1,000 grid cells` },
    { label: 'Status', value: STATUS_TEXT[cell.status] ?? cell.status },
    { label: 'Source', value: cell.estimated ? 'Estimated (MODIS scaled by R)' : 'Observed' },
  ];
  if (cell.estimated) rows.push({ label: 'R', value: typeof cell.r === 'number' ? String(cell.r) : NOT_AVAILABLE });
  rows.push({ label: 'Median', value: num(cell.median) }, { label: 'Years used', value: num(cell.medianYears) });
  if (layer === 'anomaly') {
    const ranked = typeof cell.rank === 'number';
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    rows.push({ label: 'Percentile rank', value: cap(rankText(cell.rank)) }, { label: 'Flagged', value: ranked ? (cell.flagged ? 'Yes, unusual for this month' : 'No') : NOT_AVAILABLE });
  }
  return { title, rows, caveats };
};

const SHEET_GAP = 16;

/**
 * Pixels to scroll the page so the tapped cell ends above a bottom sheet (WCAG 2.4.11, focus not
 * obscured). Positive scrolls down. A cell taller than the free space keeps its top on screen.
 */
export const scrollForSheet = ({ cellTop, cellBottom, sheetTop }, gap = SHEET_GAP) => {
  const over = cellBottom - (sheetTop - gap);
  if (over <= 0) return 0;
  return Math.min(over, Math.max(0, cellTop - gap));
};

/**
 * mount(container, {aoiCells, onClose}). `open(cell, {layer})` shows the panel and remembers the
 * focused element (the calendar cell) to give focus back to on close. Escape closes.
 * Desktop side panel and phone bottom sheet are the same markup; CSS picks the layout.
 */
export const mount = (container, deps) => {
  let aoiCells = deps.aoiCells;
  let opener = null;
  let isOpen = false;

  const root = document.documentElement;
  // On phone the panel is a fixed bottom sheet: pad the page by its height so everything can
  // scroll above it, then bring the tapped cell clear of it.
  const clearSheet = (cell) => {
    if (getComputedStyle(container).position !== 'fixed') { root.style.removeProperty('--sheet-height'); return; }
    root.style.setProperty('--sheet-height', `${container.offsetHeight}px`);
    if (!cell?.isConnected) return;
    const r = cell.getBoundingClientRect();
    const by = scrollForSheet({ cellTop: r.top, cellBottom: r.bottom, sheetTop: container.getBoundingClientRect().top });
    if (by) window.scrollBy(0, by);
  };

  const close = ({ restore = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    container.replaceChildren();
    root.style.removeProperty('--sheet-height');
    document.removeEventListener('keydown', onKey);
    if (restore && opener?.isConnected) opener.focus();
    opener = null;
    deps.onClose?.();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  };

  const open = (cell, { layer } = {}) => {
    if (!container.contains(document.activeElement)) opener = document.activeElement;
    const m = detailModel(cell, { aoiCells, layer });
    const heading = h('h2', { class: 'detail-title', tabindex: '-1', text: m.title });
    container.replaceChildren(h('div', { class: 'detail-panel', role: 'group', 'aria-labelledby': 'detail-title' },
      h('div', { class: 'detail-head' }, heading, h('button', { type: 'button', class: 'detail-close', 'aria-label': 'Close cell detail', text: 'Close', onclick: () => close() })),
      h('dl', { class: 'detail-list' }, m.rows.map((r) => h('div', { class: 'detail-row' }, h('dt', { text: r.label }), h('dd', { text: r.value })))),
      h('h3', { class: 'detail-sub', text: 'Caveats' }),
      h('ul', { class: 'detail-caveats' }, m.caveats.map((c) => h('li', {}, h('strong', { text: `${c.id} ` }), c.text)))));
    heading.id = 'detail-title';
    isOpen = true;
    document.addEventListener('keydown', onKey);
    heading.focus({ preventScroll: true });
    clearSheet(opener);
  };

  return {
    open,
    close,
    update: (next) => { aoiCells = next.aoiCells ?? aoiCells; },
    isOpen: () => isOpen,
    destroy: () => close({ restore: false }),
  };
};
