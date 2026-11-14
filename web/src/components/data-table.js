import { h } from './h.js';

/**
 * Normalizes a table spec and checks every row has one cell per column.
 * @param {{caption: string, corner?: string, columns: string[], rows: {header: string, cells: string[]}[], notes?: string[]}} spec
 */
export const tableModel = ({ caption, corner = '', columns, rows, notes = [] }) => {
  rows.forEach((row) => {
    if (row.cells.length !== columns.length) {
      throw new RangeError(`row "${row.header}" has ${row.cells.length} cells for ${columns.length} columns`);
    }
  });
  return { caption, corner, columns, rows, notes };
};

/** mount(container, {model}) renders a table with scoped headers; returns {update(model), destroy()}. */
export const mount = (container, { model }) => {
  const render = (m) => {
    const head = h('tr', {}, h('th', { scope: 'col', text: m.corner }), m.columns.map((c) => h('th', { scope: 'col', text: c })));
    const body = m.rows.map((r) => h('tr', {}, h('th', { scope: 'row', text: r.header }), r.cells.map((c) => h('td', { text: c }))));
    const table = h('table', { class: 'data-table' }, h('caption', { text: m.caption }), h('thead', {}, head), h('tbody', {}, body));
    const nodes = [h('div', { class: 'data-table-scroll', tabindex: '0', role: 'region', 'aria-label': m.caption }, table)];
    m.notes.forEach((n) => nodes.push(h('p', { class: 'data-table-note', text: n })));
    container.replaceChildren(...nodes);
  };
  render(model);
  return { update: render, destroy: () => container.replaceChildren() };
};
