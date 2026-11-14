import { density } from '../bins.js';
import { caveatsForCell } from '../caveat-catalog.js';
import { formatCount, formatDensity, monthLabel } from '../format.js';
import { h } from './h.js';

export const NOT_AVAILABLE = 'not available yet';

const STATUS_TEXT = { observed: 'Observed', harmonized: 'Harmonized', partial: 'Partial month', 'no-data': 'No data' };

/**
 * View model of the panel. Optional cell fields (`r`, `median`, `medianYears`) show
 * "not available yet" when absent: nothing is computed or guessed here.
 * @param {object} cell CalendarCell
 * @param {{aoiCells: number}} opts grid cells in the AOI (density denominator)
 */
export const detailModel = (cell, { aoiCells }) => {
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
  return { title, rows, caveats };
};

/**
 * mount(container, {aoiCells, onClose}). `open(cell)` shows the panel and remembers the
 * focused element (the calendar cell) to give focus back to on close. Escape closes.
 * Desktop side panel and phone bottom sheet are the same markup; CSS picks the layout.
 */
export const mount = (container, deps) => {
  let aoiCells = deps.aoiCells;
  let opener = null;
  let isOpen = false;

  const close = ({ restore = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    container.replaceChildren();
    document.removeEventListener('keydown', onKey);
    if (restore && opener?.isConnected) opener.focus();
    opener = null;
    deps.onClose?.();
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
  };

  const open = (cell) => {
    if (!container.contains(document.activeElement)) opener = document.activeElement;
    const m = detailModel(cell, { aoiCells });
    const heading = h('h2', { class: 'detail-title', tabindex: '-1', text: m.title });
    container.replaceChildren(h('div', { class: 'detail-panel', role: 'group', 'aria-labelledby': 'detail-title' },
      h('div', { class: 'detail-head' }, heading, h('button', { type: 'button', class: 'detail-close', 'aria-label': 'Close cell detail', text: 'Close', onclick: () => close() })),
      h('dl', { class: 'detail-list' }, m.rows.map((r) => h('div', { class: 'detail-row' }, h('dt', { text: r.label }), h('dd', { text: r.value })))),
      h('h3', { class: 'detail-sub', text: 'Caveats' }),
      h('ul', { class: 'detail-caveats' }, m.caveats.map((c) => h('li', {}, h('strong', { text: `${c.id} ` }), c.text)))));
    heading.id = 'detail-title';
    isOpen = true;
    document.addEventListener('keydown', onKey);
    heading.focus();
  };

  return {
    open,
    close,
    update: (next) => { aoiCells = next.aoiCells ?? aoiCells; },
    isOpen: () => isOpen,
    destroy: () => close({ restore: false }),
  };
};
