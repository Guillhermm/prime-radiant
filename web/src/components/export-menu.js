import { toCsv } from '../../../core/index.js';
import { h } from './h.js';
import { icon } from './icons.js';
import { imageModel, renderSvg, synthNote, toPng } from './export-image.js';
import { popover, restoreFocus } from './popover.js';
import { nextItem } from './share-menu.js';
import * as toast from './toast.js';

const addMonths = (ym, n) => {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/** "prime-radiant-2001-01-2026-10.csv": the first and last month of the exported series. */
export const exportFilename = (series, { prefix = 'prime-radiant', ext = 'csv' } = {}) => {
  const last = addMonths(series.start, Math.max(0, series.values.length - 1));
  return `${prefix}-${series.start}-${last}.${ext}`;
};

const MIME = 'text/csv;charset=utf-8';

/**
 * The CSV of what is on screen. core.toCsv writes it, RFC 4180 with its formula-injection guard:
 * the Calendar as `calendar` rows, the Sensors view as one long `sensors` table.
 * @param {'calendar'|'sensors'} kind
 * @param {{series: object, cells?: object[], sensors?: object, meta: object}} what `series` names the file
 */
export const csvExport = (kind, { series, cells, sensors, meta }) => ({
  filename: exportFilename(series, kind === 'sensors' ? { prefix: 'prime-radiant-sensors' } : {}),
  mime: MIME,
  text: kind === 'sensors' ? toCsv('sensors', { ...sensors, harmonized: series }, meta) : toCsv('calendar', cells, meta),
});

export const SYNTHETIC_LINE = `# ${synthNote}`;

/** Puts the synthetic warning on the first line of the file when the data is synthetic. */
export const withSyntheticNote = (text, synthetic) => (synthetic ? `${SYNTHETIC_LINE}\r\n${text}` : text);

export const savedMessage = (filename) => `${filename.endsWith('.png') ? 'Image' : 'CSV'} saved: ${filename}`;

export const EXPORT_ITEMS = [
  { id: 'csv', label: 'CSV', icon: 'table' },
  { id: 'png', label: 'Image (PNG)', icon: 'image' },
];

/**
 * The calendar of the current area and period as a PNG file. `what` is {cells, aoiCells, series,
 * title, bbox, manifest, synthetic, generated}; `rasterize` turns the model into a Blob (tests).
 */
export const imageExport = async (what, { rasterize = (m) => toPng(renderSvg(m)) } = {}) => {
  const model = imageModel({
    cells: what.cells, aoiCells: what.aoiCells, title: what.title, bbox: what.bbox, synthetic: what.synthetic,
    dataVersion: what.manifest.dataVersion, citation: what.manifest.citation, generated: what.generated ?? new Date().toISOString().slice(0, 10),
  });
  return { filename: exportFilename(what.series, { ext: 'png' }), mime: 'image/png', blob: await rasterize(model) };
};

const browserDownload = ({ filename, mime, text, blob }) => {
  const url = URL.createObjectURL(blob ?? new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  // Safari can start the download after click() returns; revoking at once cancels it.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

let seq = 0;

/**
 * mount(container, deps). An Export button with a menu: CSV of what is on screen, or a PNG of the
 * calendar. The menu follows the share menu's keys (arrows, Home, End; Escape and Tab close and
 * focus returns to the button). deps: `getFile()` returns {filename, mime, text} or null before an
 * area loads, `getImage()` the input of imageExport or null, `isSynthetic()`; optional
 * `download(file)`, `notify(message, {kind})` and `rasterize` for tests. Results go to a toast.
 * Returns {setDisabled(reason), destroy()}: a reason disables the button (aria-disabled, so it
 * stays focusable, and the menu does not open) and becomes its description; null enables it.
 */
export const mount = (container, deps) => {
  const download = deps.download ?? browserDownload;
  const notify = deps.notify ?? toast.show;
  const id = `export-menu-${++seq}`;
  const button = h('button', {
    type: 'button', class: 'btn btn-primary export-button', popovertarget: id, 'aria-haspopup': 'menu', 'aria-controls': id, 'aria-label': 'Export',
  }, icon('download'), h('span', { class: 'btn-label', text: 'Export' }), icon('chevron'));
  const why = h('span', { id: 'export-why', class: 'sr-only' });
  const menu = h('div', { id, class: 'export-menu', popover: 'auto', role: 'menu', 'aria-label': 'Export' },
    EXPORT_ITEMS.map((it) => h('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'export-item', 'data-id': it.id }, icon(it.icon), it.label)));
  container.replaceChildren(button, why, menu);
  const disabled = () => button.getAttribute('aria-disabled') === 'true';
  // Registered before the popover's own listeners: a canceled click also cancels popovertarget.
  button.addEventListener('click', (e) => {
    if (!disabled()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  const ctl = popover(menu, [button], {
    onOpen: () => {
      const r = button.getBoundingClientRect();
      menu.style.setProperty('--pop-top', `${Math.round(r.bottom + 6)}px`);
      menu.style.setProperty('--pop-start', `${Math.round(r.right - 208)}px`);
      requestAnimationFrame(() => menu.querySelector('[role=menuitem]')?.focus());
    },
    onClose: (btn) => restoreFocus(menu, btn),
    closeOnScroll: true,
  });
  const setDisabled = (reason) => {
    why.textContent = reason ?? '';
    if (reason) {
      ctl.hide();
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-describedby', why.id);
      button.title = reason;
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-describedby');
      button.removeAttribute('title');
    }
  };
  const run = async (kind) => {
    ctl.hide();
    try {
      if (kind === 'csv') {
        const file = deps.getFile();
        if (!file) return notify('Nothing to export yet. Choose an area first.', { kind: 'error' });
        download({ ...file, text: withSyntheticNote(file.text, deps.isSynthetic?.() ?? false) });
        return notify(savedMessage(file.filename));
      }
      const what = deps.getImage?.();
      if (!what) return notify('Nothing to export yet. Choose an area first.', { kind: 'error' });
      const file = await imageExport({ ...what, synthetic: deps.isSynthetic?.() ?? false }, deps.rasterize ? { rasterize: deps.rasterize } : {});
      download(file);
      return notify(savedMessage(file.filename));
    } catch (err) {
      return notify(`Export failed: ${err.message}`, { kind: 'error' });
    }
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[role=menuitem]');
    if (b) run(b.dataset.id);
  });
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('[role=menuitem]')];
    if (e.key === 'Tab') { ctl.hide(); return; }
    const n = nextItem(e.key, list.indexOf(document.activeElement), list.length);
    if (n === null) return;
    e.preventDefault();
    list[n].focus();
  });
  return { setDisabled, destroy: () => container.replaceChildren() };
};
