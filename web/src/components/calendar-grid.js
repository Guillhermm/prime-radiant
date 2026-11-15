import { NODATA, binClass, density } from '../bins.js';
import { MONTH_ABBR, MONTH_NAMES, abbreviateCount, formatCount, formatDensity, monthLabel } from '../format.js';
import { partialNote, yearTotals } from '../stats.js';
import { h } from './h.js';
import { mount as mountTable, tableModel } from './data-table.js';

const STATUS_TEXT = { observed: 'observed', harmonized: 'estimated', partial: 'partial month, sensor outage' };
// Gate V1 fix F4: an estimated value is named for what it is, not "harmonized".
export const SOURCE_TEXT = { modis: 'scaled to VIIRS-equivalent (MODIS × R)', noaa20: 'scaled to VIIRS-equivalent (NOAA-20 × K)' };

// Core flags a Terra-era month with a MODIS count `terra-only` and leaves it unscaled (null).
export const TERRA_ONLY_TEXT = 'Not harmonized: Terra only, before Aqua (Jul 2002)';
export const isTerraOnly = (cell) => cell.value === null && Boolean(cell.flags?.includes('terra-only'));

/** At most three characters for a phone cell: 999, 3k, 12k, 1M. */
export const shortCount = (n) => {
  if (n < 999.5) return String(Math.round(n));
  if (n < 999500) return `${Math.round(n / 1000)}k`;
  return `${Math.round(n / 1e6)}M`;
};

/** Screen reader and hover text for one cell, with the full (unabbreviated) value. */
export const cellLabel = (cell, aoiCells) => {
  const when = monthLabel(cell.year, cell.month);
  if (isTerraOnly(cell)) return `${when}, ${TERRA_ONLY_TEXT.replace('Not', 'not')}`;
  if (cell.value === null) return `${when}, no data`;
  const parts = [when, `${formatCount(cell.value)} fire-cell-days`];
  const d = density(cell.value, aoiCells);
  if (d !== null) parts.push(`density ${formatDensity(d)} per 1,000 cells`);
  parts.push(STATUS_TEXT[cell.status] ?? cell.status);
  if (cell.estimated) parts.push(SOURCE_TEXT[cell.source?.id] ?? 'estimated');
  if (cell.flags?.includes('low-confidence')) parts.push('low confidence');
  return parts.join(', ');
};

export const cellModel = (cell, aoiCells) => ({
  year: cell.year,
  month: cell.month,
  cell,
  bin: binClass(cell.value, aoiCells),
  label: cellLabel(cell, aoiCells),
  text: cell.value === null ? '' : abbreviateCount(cell.value),
  short: cell.value === null ? '' : shortCount(cell.value),
  estimated: cell.estimated === true,
  partial: cell.status === 'partial',
  terraOnly: isTerraOnly(cell),
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

export const BRACKET_TEXT = 'Estimated (MODIS × R)';
// A run this short has no room for the words along it; the legend names the mark.
const BRACKET_MIN_ROWS = 6;

/** Runs of adjacent rows holding an estimated month, as row indexes [{from, to}], for the bracket by the year labels. */
export const estimatedRuns = (model) => {
  const runs = [];
  model.rows.forEach((row, r) => {
    if (!row.cells.some((m) => m?.estimated)) return;
    const last = runs.at(-1);
    if (last && last.to === r - 1) last.to = r;
    else runs.push({ from: r, to: r });
  });
  return runs.map((x) => ({ ...x, label: x.to - x.from + 1 >= BRACKET_MIN_ROWS ? BRACKET_TEXT : 'Est.' }));
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
  if (isTerraOnly(c)) return 'Terra only';
  if (c.value === null) return 'No data';
  return `${formatCount(c.value)}${c.estimated ? '*' : ''}${c.status === 'partial' ? '†' : ''}`;
};

/** Table view of the same cells: years as rows, months as columns. */
export const calendarTableModel = (cells) => {
  // The table shows no density, so any positive denominator will do.
  const { rows } = gridModel(cells, { aoiCells: 1 });
  const notes = [];
  if (cells.some((c) => c.estimated)) notes.push('* Estimated: scaled to VIIRS-equivalent.');
  if (cells.some((c) => c.status === 'partial')) notes.push('† Partial month: a satellite missed days, so the count is low.');
  if (cells.some(isTerraOnly)) notes.push('Terra only: not harmonized, Terra flew alone before Aqua (Jul 2002).');
  return tableModel({
    caption: 'Fire-cell-days per month, by year',
    corner: 'Year',
    columns: MONTH_ABBR,
    rows: rows.map((r) => ({ header: String(r.year), cells: r.cells.map((c) => tableCell(c?.cell ?? null)) })),
    notes,
  });
};

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];

/**
 * What a key does in the grid. With a month selected (the panel open), moving also moves the
 * selection, so the panel follows. Returns 'open', 'close', 'move', 'move-select' or null.
 */
export const keyIntent = (key, { selected = false } = {}) => {
  if (key === 'Enter' || key === ' ') return 'open';
  if (key === 'Escape') return 'close';
  if (NAV_KEYS.includes(key)) return selected ? 'move-select' : 'move';
  return null;
};

/** True when at least `threshold` of the cells with data are estimated: per-cell marks then carry no information. */
export const mostlyEstimated = (cells, threshold = 0.6) => {
  const withData = cells.filter((c) => c.value !== null);
  return withData.length > 0 && withData.filter((c) => c.estimated).length / withData.length >= threshold;
};

/**
 * The median row under the grid: core.baseline's typical year (view-data), classed by density.
 * Shown with the Preview tag: gate V1 validated core.baseline per month, not this typical year.
 */
export const medianRowModel = (typical, aoiCells) => (typical ?? []).map((t) => (t.median === null
  ? { month: t.month, bin: NODATA, text: '', short: '', label: `${MONTH_NAMES[t.month - 1]} median: not enough history` }
  : {
    month: t.month,
    bin: binClass(Math.round(t.median), aoiCells),
    text: abbreviateCount(Math.round(t.median)),
    short: shortCount(Math.round(t.median)),
    label: `${MONTH_NAMES[t.month - 1]} median ${formatCount(t.median)} fire-cell-days over ${t.from}–${t.to}, preview`,
  }));

const cellClass = (m) => ['cal-cell', `bin-${m.bin}`, m.terraOnly ? 'terra-only' : m.bin === NODATA && 'nodata', m.estimated && 'is-estimated', m.partial && 'is-partial'].filter(Boolean).join(' ');

const totalText = (t) => {
  if (t?.total === null) return t.terraOnly ? 'Terra only' : 'No data';
  return `${formatCount(t.total)}${t.partial ? '*' : ''}`;
};
const totalLabel = (year, t) => {
  if (t?.total === null) return `${year} total: ${t.terraOnly ? 'not harmonized, Terra only' : 'no data'}`;
  return `${year} total ${formatCount(t.total)} fire-cell-days${t.partial ? `, ${partialNote(t)}` : ''}${t.busiest ? ', busiest year' : ''}`;
};

const numSpans = (text, short) => [h('span', { class: 'cal-num num-l', 'aria-hidden': 'true', text }), h('span', { class: 'cal-num num-s', 'aria-hidden': 'true', text: short })];

/**
 * mount(container, {cells, aoiCells, typical, onSelect(cell), onClose()}). `onSelect` fires on
 * click, Enter, Space, and on every arrow move while a month is selected. Returns
 * {update(next), focus(), select({year, month}|null), link({year, month}|null), step(key),
 * setTable(on), showYear(year), destroy()}.
 */
export const mount = (container, deps) => {
  let { cells, aoiCells, typical } = deps;
  let model;
  let pos = null;
  let selected = null;
  let tableOn = false;
  let linked = null;
  let revealTimer = 0;
  const nodes = new Map();

  const readout = h('p', { class: 'cal-readout', 'aria-hidden': 'true' });
  const gridHost = h('div', { class: 'cal-scroll' });
  const tableHost = h('div', { class: 'cal-table', hidden: true });
  const notes = h('p', { class: 'cal-notes' });
  container.replaceChildren(h('div', { class: 'calendar' }, gridHost, readout, tableHost, notes));
  let table = null;
  let grid = null;

  const key = (r, c) => `${r}:${c}`;
  const nodeAt = (p) => (p ? nodes.get(key(p.row, p.col)) : null);
  const posFor = ({ year, month }) => {
    const row = model.rows.findIndex((r) => r.year === year);
    return row >= 0 && model.rows[row].cells[month - 1] ? { row, col: month - 1 } : null;
  };
  const activate = (next, { focus = false } = {}) => {
    if (!next) return;
    const prev = nodeAt(pos);
    if (prev) prev.tabIndex = -1;
    pos = next;
    const node = nodeAt(pos);
    node.tabIndex = 0;
    if (focus) node.focus();
  };

  const posOf = (node) => ({ row: Number(node.dataset.row), col: Number(node.dataset.col) });

  const paintSelection = () => {
    if (!grid) return;
    grid.querySelectorAll('.is-selected, .is-current').forEach((n) => n.classList.remove('is-selected', 'is-current'));
    const p = selected && posFor(selected);
    if (!p) return;
    nodeAt(p)?.classList.add('is-selected');
    grid.querySelectorAll(`[data-colhead="${p.col}"], [data-year="${model.rows[p.row].year}"]`).forEach((n) => n.classList.add('is-current'));
  };

  const buildGrid = ({ reveal = false } = {}) => {
    nodes.clear();
    model = gridModel(cells, { aoiCells });
    const start = initialPosition(model);
    const keep = pos && model.rows[pos.row]?.cells[pos.col] ? pos : null;
    pos = keep ?? start;
    const totals = new Map(yearTotals(cells).map((y) => [y.year, y]));
    const header = h('div', { role: 'row', class: 'cal-row cal-head' },
      h('div', { role: 'columnheader', class: 'cal-year', 'aria-label': 'Year' }),
      model.columns.map((name, i) => h('div', { role: 'columnheader', class: 'cal-colhead', 'aria-label': name, 'data-colhead': i },
        h('span', { class: 'long', text: MONTH_ABBR[i] }), h('span', { class: 'short', text: name[0] }))),
      h('div', { role: 'columnheader', class: 'cal-total cal-total-head', text: 'Year total' }));
    const runs = estimatedRuns(model);
    const runAt = (r) => runs.find((x) => r >= x.from && r <= x.to);
    const yearHead = (row, r) => {
      const run = runAt(r);
      const cls = ['cal-year', run && 'est-run', run?.from === r && 'est-first', run?.to === r && 'est-last'].filter(Boolean).join(' ');
      return h('div', { role: 'rowheader', class: cls, 'data-year': row.year }, String(row.year),
        run?.from === r ? h('span', { class: 'est-bracket-label', 'aria-hidden': 'true', text: run.label }) : null);
    };
    const rows = model.rows.map((row, r) => {
      const t = totals.get(row.year);
      const bar = h('span', { class: 'cal-total-bar' });
      bar.style.setProperty('--w', String(t?.share ?? 0));
      return h('div', { role: 'row', class: 'cal-row cal-year-row' },
        yearHead(row, r),
        row.cells.map((m, c) => {
          if (m === null) return h('div', { role: 'gridcell', class: 'cal-cell is-empty', 'aria-disabled': 'true', 'aria-label': `${MONTH_NAMES[c]} ${row.year}, outside the selected range` });
          const node = h('div', {
            role: 'gridcell', class: cellClass(m), tabindex: pos && pos.row === r && pos.col === c ? '0' : '-1',
            'aria-label': m.label, 'data-row': r, 'data-col': c,
          }, numSpans(m.text, m.short));
          node.style.setProperty('--i', String(r + c));
          nodes.set(key(r, c), node);
          return node;
        }),
        h('div', { role: 'gridcell', class: `cal-total${t?.busiest ? ' is-busiest' : ''}`, 'aria-label': totalLabel(row.year, t) },
          bar, h('span', { class: 'cal-total-n', 'aria-hidden': 'true', text: totalText(t) })));
    });
    const median = medianRowModel(typical, aoiCells);
    const medianRow = median.length ? h('div', { role: 'row', class: 'cal-row cal-median' },
      h('div', { role: 'rowheader', class: 'cal-year cal-median-label' }, h('span', { class: 'long', text: 'Median' }), h('span', { class: 'short', text: 'Med' })),
      median.map((m) => h('div', { role: 'gridcell', class: `cal-cell is-median bin-${m.bin}${m.bin === NODATA ? ' nodata' : ''}`, 'aria-label': m.label }, numSpans(m.text, m.short))),
      h('div', { role: 'gridcell', class: 'cal-total' }, h('span', { class: 'tag', text: 'Preview' }))) : null;
    grid = h('div', {
      role: 'grid', class: `cal-grid${reveal ? ' is-revealing' : ''}`, 'aria-label': 'Fire-cell-days by month and year',
      'aria-rowcount': rows.length + 1 + (medianRow ? 1 : 0), 'aria-colcount': 14,
    }, header, rows, medianRow);
    gridHost.replaceChildren(grid);
    const all = mostlyEstimated(cells);
    grid.classList.toggle('all-estimated', all);
    grid.classList.toggle('has-est-bracket', runs.length > 0);
    container.closest('.view-calendar')?.classList.toggle('all-estimated', all);
    grid.addEventListener('keydown', onKeydown);
    grid.addEventListener('click', onClick);
    grid.addEventListener('focusin', onFocusIn);
    grid.addEventListener('mouseover', onHover);
    grid.addEventListener('mouseleave', clearReadout);
    clearTimeout(revealTimer);
    if (reveal) revealTimer = setTimeout(() => grid.classList.remove('is-revealing'), 1600);
    const partial = [...totals.values()].filter((y) => y.partial && y.total !== null).map(partialNote);
    notes.textContent = partial.length ? `* ${partial.join('; ')}.` : '';
    paintSelection();
    paintLink();
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

  const choose = (m) => {
    selected = { year: m.year, month: m.month };
    paintSelection();
    deps.onSelect?.(m.cell);
  };

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
    choose(modelAt(node));
  };
  const move = (from, k, { ctrl = false, focus = true } = {}) => {
    const next = nextPosition(model, from, k, { ctrl });
    activate(next, { focus });
    if (selected) choose(model.rows[next.row].cells[next.col]);
  };
  const onKeydown = (ev) => {
    const node = cellOf(ev.target);
    if (!node) return;
    const intent = keyIntent(ev.key, { selected: selected !== null });
    if (intent === 'open') { ev.preventDefault(); choose(modelAt(node)); return; }
    if (intent === 'close') { clearReadout(); deps.onClose?.(); return; }
    if (!intent) return;
    ev.preventDefault();
    move(posOf(node), ev.key, { ctrl: ev.ctrlKey || ev.metaKey });
  };

  const paintLink = () => {
    grid?.querySelector('.is-linked')?.classList.remove('is-linked');
    const p = linked && posFor(linked);
    if (p) nodeAt(p)?.classList.add('is-linked');
  };

  const setTable = (on) => {
    tableOn = on;
    gridHost.hidden = on;
    readout.hidden = on;
    tableHost.hidden = !on;
    if (on) buildTable();
  };

  buildGrid({ reveal: true });
  return {
    update: (next) => {
      const fresh = next.cells !== cells;
      ({ cells, aoiCells, typical } = { cells, aoiCells, typical, ...next });
      if (fresh) selected = null;
      buildGrid({ reveal: fresh });
      if (tableOn) buildTable();
    },
    focus: () => nodeAt(pos)?.focus(),
    select: (sel) => {
      selected = sel;
      const p = sel && posFor(sel);
      if (p) activate(p);
      paintSelection();
    },
    link: (sel) => { linked = sel; paintLink(); },
    step: (k) => { if (pos) move(pos, k, { focus: false }); },
    setTable,
    showYear: (year) => {
      setTable(true);
      const th = [...tableHost.querySelectorAll('tbody th')].find((n) => n.textContent === String(year));
      th?.scrollIntoView({ block: 'center' });
      tableHost.querySelector('.data-table-scroll')?.focus({ preventScroll: true });
    },
    isTable: () => tableOn,
    destroy: () => { clearTimeout(revealTimer); container.replaceChildren(); },
  };
};
