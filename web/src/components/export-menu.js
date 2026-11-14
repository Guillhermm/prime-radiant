import { toCsv } from '../../../core/index.js';
import { h } from './h.js';

/** "prime-radiant-2026-11-14.csv": UTC calendar date of `now`. */
export const exportFilename = (now, { prefix = 'prime-radiant', ext = 'csv' } = {}) => `${prefix}-${now.toISOString().slice(0, 10)}.${ext}`;

/** The CSV file for a series: text is exactly `core.toCsv(series, meta)`. */
export const csvExport = (series, meta, now) => ({
  filename: exportFilename(now),
  mime: 'text/csv;charset=utf-8',
  text: toCsv(series, meta),
});

export const MENU_ITEMS = [
  { id: 'csv', label: 'CSV (aggregates)' },
  { id: 'link', label: 'Copy link' },
];

const browserDownload = ({ filename, mime, text }) => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/**
 * mount(container, deps). deps: `getSeries()` returns the Series on screen or null,
 * `getMeta()` extra CSV header lines, `getLink()` the shareable URL; optional `now()`,
 * `download(file)`, `copy(text)` for tests. Returns {destroy()}.
 */
export const mount = (container, deps) => {
  const now = deps.now ?? (() => new Date());
  const download = deps.download ?? browserDownload;
  const copy = deps.copy ?? ((t) => navigator.clipboard.writeText(t));

  const button = h('button', { type: 'button', class: 'export-button', 'aria-expanded': 'false', 'aria-controls': 'export-list', text: 'Export' });
  const list = h('ul', { class: 'export-list', id: 'export-list', hidden: true },
    MENU_ITEMS.map((i) => h('li', {}, h('button', { type: 'button', class: 'export-item', 'data-action': i.id, text: i.label }))));
  const status = h('p', { class: 'export-status', role: 'status' });
  const root = h('div', { class: 'export-menu' }, button, list, status);
  container.replaceChildren(root);

  const setOpen = (open, { restore = false } = {}) => {
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) list.querySelector('button').focus();
    else if (restore) button.focus();
  };
  const say = (msg) => { status.textContent = msg; };

  const run = async (action) => {
    try {
      if (action === 'csv') {
        const series = deps.getSeries();
        if (!series) return say('Nothing to export yet. Choose an area first.');
        download(csvExport(series, deps.getMeta?.() ?? {}, now()));
        say('CSV downloaded');
      } else {
        await copy(deps.getLink());
        say('Link copied');
      }
    } catch (err) {
      say(`Export failed: ${err.message}`);
    }
  };

  button.addEventListener('click', () => setOpen(list.hidden));
  list.addEventListener('click', (ev) => {
    const action = ev.target.dataset?.action;
    if (!action) return;
    setOpen(false, { restore: true });
    run(action);
  });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !list.hidden) { ev.stopPropagation(); setOpen(false, { restore: true }); }
  });
  const onOutside = (ev) => { if (!root.contains(ev.target) && !list.hidden) setOpen(false); };
  document.addEventListener('click', onOutside);
  return { destroy: () => { document.removeEventListener('click', onOutside); container.replaceChildren(); } };
};
