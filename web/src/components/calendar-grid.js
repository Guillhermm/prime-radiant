import { NODATA, binClass, density } from '../bins.js';
import { MONTH_ABBR, MONTH_NAMES, abbreviateCount, formatCount, formatDensity, monthLabel } from '../format.js';
import { h } from './h.js';
import { mount as mountTable, tableModel } from './data-table.js';

const STATUS_TEXT = { observed: 'observed', harmonized: 'harmonized', partial: 'partial month' };

/** Screen reader and hover text for one cell, with the full (unabbreviated) value. */
export const cellLabel = (cell, aoiCells) => {
  const when = monthLabel(cell.year, cell.month);
  if (cell.value === null) return `${when}, no data`;
  const parts = [when, `${formatCount(cell.value)} fire-cell-days`];
  const d = density(cell.value, aoiCells);
  if (d !== null) parts.push(`density ${formatDensity(d)} per 1,000 cells`);
  parts.push(STATUS_TEXT[cell.status] ?? cell.status);
  if (cell.estimated) parts.push('estimated');
  return parts.join(', ');
};

export const cellModel = (cell, aoiCells) => ({
  year: cell.year,
  month: cell.month,
  cell,
  bin: binClass(cell.value, aoiCells),
  label: cellLabel(cell, aoiCells),
  text: cell.value === null ? '' : abbreviateCount(cell.value),
  estimated: cell.estimated === true,
  partial: cell.status === 'partial',
});

/**
 * Rows newest year first, 12 slots per row; a slot outside the cell list is null.
 * @param {object[]} cells CalendarCell list
 * @param {{aoiCells: number}} opts grid cells in the AOI (density denominator)
 */
export const gridModel = (cells, { aoiCells }) => {
  const byYear = new Map();
  for (const c of cells) {
    if (!byYear.has(c.year)) byYear.set(c.year, Array(12).fill(null));
    byYear.get(c.year)[c.month - 1] = cellModel(c, aoiCells);
  }
  const rows = [...byYear.keys()].sort((a, b) => b - a).map((year) => ({ year, cells: byYear.get(year) }));
  return { rows, columns: MONTH_NAMES };
};

const firstIn = (list) => list.findIndex((c) => c !== null);
const lastIn = (list) => list.findLastIndex((c) => c !== null);

/** Position to focus first: the newest year's earliest month in range. */
export const initialPosition = (model) => {
  for (let r = 0; r < model.rows.length; r++) {
    const col = firstIn(model.rows[r].cells);
    if (col >= 0) return { row: r, col };
  }
  return null;
};

/**
 * Next focus position for a navigation key; returns `pos` itself when the key does not move.
 * Left/Right stay in the row, Up/Down (and PageUp/PageDown: one year) skip rows without
 * that month, Home/End go to the row ends, Ctrl+Home/End to the grid ends.
 */
export const nextPosition = (model, pos, key, { ctrl = false } = {}) => {
  const { rows } = model;
  const at = (r, c) => rows[r]?.cells[c] ?? null;
  const scan = (dr, dc) => {
    let r = pos.row + dr;
    let c = pos.col + dc;
    while (r >= 0 && r < rows.length && c >= 0 && c < 12) {
      if (at(r, c)) return { row: r, col: c };
      r += dr;
      c += dc;
    }
    return pos;
  };
  switch (key) {
    case 'ArrowLeft': return scan(0, -1);
    case 'ArrowRight': return scan(0, 1);
    case 'ArrowUp': case 'PageUp': return scan(-1, 0);
    case 'ArrowDown': case 'PageDown': return scan(1, 0);
    case 'Home': {
      if (ctrl) return initialPosition(model) ?? pos;
      return { row: pos.row, col: firstIn(rows[pos.row].cells) };
    }
    case 'End': {
      if (ctrl) {
        for (let r = rows.length - 1; r >= 0; r--) {
          const col = lastIn(rows[r].cells);
          if (col >= 0) return { row: r, col };
        }
        return pos;
      }
      return { row: pos.row, col: lastIn(rows[pos.row].cells) };
    }
    default: return pos;
  }
};

const tableCell = (c) => {
  if (c === null) return '';
  if (c.value === null) return 'No data';
  return `${formatCount(c.value)}${c.estimated ? '*' : ''}${c.status === 'partial' ? '†' : ''}`;
};

/** Table view of the same cells: years as rows, months as columns. */
export const calendarTableModel = (cells) => {
  // The table shows no density, so any positive denominator will do.
  const { rows } = gridModel(cells, { aoiCells: 1 });
  const notes = [];
  if (cells.some((c) => c.estimated)) notes.push('* Estimated value.');
  if (cells.some((c) => c.status === 'partial')) notes.push('† Partial month.');
  return tableModel({
    caption: 'Fire-cell-days per month, by year',
    corner: 'Year',
    columns: MONTH_ABBR,
    rows: rows.map((r) => ({ header: String(r.year), cells: r.cells.map((c) => tableCell(c?.cell ?? null)) })),
    notes,
  });
};

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];

/** True when at least `threshold` of the cells with data are estimated: per-cell marks then carry no information. */
export const mostlyEstimated = (cells, threshold = 0.6) => {
  const withData = cells.filter((c) => c.value !== null);
  return withData.length > 0 && withData.filter((c) => c.estimated).length / withData.length >= threshold;
};

const cellClass = (m) => ['cal-cell', `bin-${m.bin}`, m.bin === NODATA && 'nodata', m.estimated && 'is-estimated', m.partial && 'is-partial'].filter(Boolean).join(' ');

/**
 * mount(container, {cells, aoiCells, onSelect, onClose}). `onSelect(cell)` fires on click,
 * Enter and Space; `onClose()` on Escape. Returns {update({cells, aoiCells}), focus(), destroy()}.
 */
export const mount = (container, deps) => {
  let { cells, aoiCells } = deps;
  let model;
  let pos = null;
  let tableOn = false;
  const nodes = new Map();

  const toggle = h('button', { type: 'button', class: 'cal-toggle', 'aria-pressed': 'false', text: 'Table view' });
  const readout = h('p', { class: 'cal-readout', 'aria-hidden': 'true' });
  const gridHost = h('div', { class: 'cal-scroll' });
  const tableHost = h('div', { class: 'cal-table', hidden: true });
  const root = h('div', { class: 'calendar' }, h('div', { class: 'cal-bar' }, h('h2', { class: 'cal-title', text: 'Fire-cell-days by month' }), toggle), gridHost, readout, tableHost);
  container.replaceChildren(root);
  let table = null;

  const key = (r, c) => `${r}:${c}`;
  const activate = (next, { focus = false } = {}) => {
    if (!next) return;
    const prev = nodes.get(key(pos.row, pos.col));
    if (prev) prev.tabIndex = -1;
    pos = next;
    const node = nodes.get(key(pos.row, pos.col));
    node.tabIndex = 0;
    if (focus) node.focus();
  };

  const posOf = (node) => ({ row: Number(node.dataset.row), col: Number(node.dataset.col) });

  const buildGrid = () => {
    nodes.clear();
    model = gridModel(cells, { aoiCells });
    const start = initialPosition(model);
    const prevKey = pos && model.rows[pos.row]?.cells[pos.col] ? pos : null;
    pos = prevKey ?? start;
    const header = h('div', { role: 'row', class: 'cal-row cal-head' },
      h('div', { role: 'columnheader', class: 'cal-year', 'aria-label': 'Year' }),
      model.columns.map((name, i) => h('div', { role: 'columnheader', class: 'cal-colhead', 'aria-label': name },
        h('span', { class: 'long', text: MONTH_ABBR[i] }), h('span', { class: 'short', text: name[0] }))));
    const rows = model.rows.map((row, r) => h('div', { role: 'row', class: 'cal-row' },
      h('div', { role: 'rowheader', class: 'cal-year', text: String(row.year) }),
      row.cells.map((m, c) => {
        if (m === null) return h('div', { role: 'gridcell', class: 'cal-cell is-empty', 'aria-disabled': 'true', 'aria-label': `${MONTH_NAMES[c]} ${row.year}, outside the selected range` });
        const node = h('div', {
          role: 'gridcell', class: cellClass(m), tabindex: pos && pos.row === r && pos.col === c ? '0' : '-1',
          'aria-label': m.label, 'data-row': r, 'data-col': c,
        }, h('span', { class: 'cal-num', 'aria-hidden': 'true', text: m.text }));
        nodes.set(key(r, c), node);
        return node;
      })));
    const grid = h('div', { role: 'grid', class: 'cal-grid', 'aria-label': 'Fire-cell-days by month and year', 'aria-rowcount': rows.length + 1, 'aria-colcount': 13 }, header, rows);
    gridHost.replaceChildren(grid);
    const all = mostlyEstimated(cells);
    grid.classList.toggle('all-estimated', all);
    container.closest('.view-calendar')?.classList.toggle('all-estimated', all);
    grid.addEventListener('keydown', onKeydown);
    grid.addEventListener('click', onClick);
    grid.addEventListener('focusin', onFocusIn);
    grid.addEventListener('mouseover', onHover);
    grid.addEventListener('mouseleave', clearReadout);
  };

  const buildTable = () => {
    const m = calendarTableModel(cells);
    if (table) table.update(m);
    else table = mountTable(tableHost, { model: m });
  };

  const modelAt = (node) => model.rows[Number(node.dataset.row)]?.cells[Number(node.dataset.col)];
  const showReadout = (node) => { const m = node && modelAt(node); readout.textContent = m ? m.label : ''; };
  const clearReadout = () => { readout.textContent = ''; };
  const cellOf = (target) => target.closest?.('[data-row]');

  const onFocusIn = (ev) => {
    const node = cellOf(ev.target);
    if (!node) return;
    activate(posOf(node));
    showReadout(node);
  };
  const onHover = (ev) => {
    const node = cellOf(ev.target);
    if (node) showReadout(node);
  };
  const onClick = (ev) => {
    const node = cellOf(ev.target);
    if (!node) return;
    activate(posOf(node), { focus: true });
    deps.onSelect?.(modelAt(node).cell);
  };
  const onKeydown = (ev) => {
    const node = cellOf(ev.target);
    if (!node) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      deps.onSelect?.(modelAt(node).cell);
      return;
    }
    if (ev.key === 'Escape') {
      clearReadout();
      deps.onClose?.();
      return;
    }
    if (!NAV_KEYS.includes(ev.key)) return;
    ev.preventDefault();
    activate(nextPosition(model, posOf(node), ev.key, { ctrl: ev.ctrlKey || ev.metaKey }), { focus: true });
  };

  toggle.addEventListener('click', () => {
    tableOn = !tableOn;
    toggle.setAttribute('aria-pressed', String(tableOn));
    toggle.textContent = tableOn ? 'Grid view' : 'Table view';
    gridHost.hidden = tableOn;
    readout.hidden = tableOn;
    tableHost.hidden = !tableOn;
    if (tableOn) buildTable();
  });

  buildGrid();
  return {
    update: (next) => {
      ({ cells, aoiCells } = { cells, aoiCells, ...next });
      buildGrid();
      if (tableOn) buildTable();
    },
    focus: () => pos && nodes.get(key(pos.row, pos.col))?.focus(),
    destroy: () => container.replaceChildren(),
  };
};
