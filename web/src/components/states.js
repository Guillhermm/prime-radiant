import { PRESETS } from '../presets.js';
import { MONTH_ABBR } from '../format.js';
import { binClass, aoiCellCount, NODATA } from '../bins.js';
import { h } from './h.js';
import { icon } from './icons.js';
import * as radiant from './radiant.js';

export const LIVE_STALE_HOURS = 48;

/** Live is unavailable when the last fetch is missing or older than 48 h (docs/ux.md section 6). */
export const liveStatus = (fetchedAt, now = new Date()) => {
  if (!fetchedAt) return { available: false, text: 'Live data unavailable.' };
  const ageHours = (now - new Date(fetchedAt)) / 3.6e6;
  if (Number.isNaN(ageHours) || ageHours > LIVE_STALE_HOURS) return { available: false, text: `Live data unavailable. Last update ${fetchedAt}` };
  return { available: true, text: `Live data, updated ${fetchedAt}` };
};

export const EMPTY_TITLE = ['When does this place ', 'burn?'];
export const EMPTY_LEAD = 'Pick an area and see every month of satellite fire detections since 2000 in one calendar: when the season peaks, which years were worst, and how this month compares.';

/**
 * State model. kinds: empty, zero, loading, error, live-unavailable.
 * `error` takes {what, hint}; `live-unavailable` takes {fetchedAt, now}.
 */
export const stateModel = (state, { presets = PRESETS } = {}) => {
  switch (state.kind) {
    case 'empty':
      return { kind: 'empty', role: null, busy: false, title: EMPTY_TITLE.join(''), lines: [EMPTY_LEAD], chips: presets.map((p) => ({ id: p.id, label: p.label })), action: null };
    case 'zero':
      return { kind: 'zero', role: 'status', busy: false, lines: ['0 fire-cell-days in range.', 'No hotspots detected, sensors were operating.'], chips: [], action: null };
    case 'loading':
      return { kind: 'loading', role: 'status', busy: true, lines: ['Loading fire data for this area'], chips: [], action: null };
    case 'error':
      return { kind: 'error', role: 'alert', busy: false, title: 'Could not load fire data', lines: [`Could not load ${state.what ?? 'the data'}.`, state.hint ?? 'Check your connection and try again. Your area and dates are kept.'], chips: [], action: { id: 'retry', label: 'Try again' } };
    case 'live-unavailable':
      return { kind: 'live-unavailable', role: 'status', busy: false, lines: [liveStatus(state.fetchedAt, state.now).text, 'The calendar keeps working.'], chips: [], action: null };
    default:
      throw new RangeError(`states: unknown kind "${state.kind}"`);
  }
};

/**
 * Which state the main view shows, and whether the result groups stay visible.
 * Zero only when every cell in range is a real 0: a null month means a sensor was off, so
 * "sensors were operating" would not be true.
 */
export const screenState = ({ hasArea, status, cells = [] }) => {
  if (!hasArea) return { kind: 'empty', results: false };
  if (status === 'loading') return { kind: 'loading', results: false };
  if (status === 'error') return { kind: 'error', results: false };
  if (status === 'ready' && cells.length > 0 && cells.every((c) => c.value === 0)) return { kind: 'zero', results: true };
  return { kind: null, results: true };
};

/** Error state copy for a data-source error (DataSourceError kinds). */
export const errorState = (err, { offline = false } = {}) => {
  if (offline && err?.kind === 'network') {
    return { kind: 'error', what: 'the data tiles', hint: 'This area is not saved for offline use. Try again when you are back online.' };
  }
  if (err?.kind === 'invalid' || err?.kind === 'parse') {
    return { kind: 'error', what: 'the data files, they failed validation', hint: 'No numbers are shown from files that fail validation. Try again, or try another area.' };
  }
  return { kind: 'error', what: 'the data tiles' };
};

const mon = (m) => (m ? `${MONTH_ABBR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : null);

/** The three record dates on the first-run screen, read from the manifest; missing ones are skipped. */
export const recordDates = (manifest) => [
  { v: mon(manifest?.coverage?.modis?.[0]), k: 'MODIS record starts' },
  { v: mon(manifest?.coverage?.viirs?.[0]), k: 'VIIRS record starts' },
  { v: mon(manifest?.last_month), k: 'latest month' },
].filter((d) => d.v);

const hemi = (v, pos, neg) => `${Number(Math.abs(v).toFixed(2))}°${v < 0 ? neg : pos}`;
/** "19°S–12°S · 59°W–52°W" for a [west, south, east, north] box. */
export const bboxText = ([w, s, e, n]) => `${hemi(s, 'N', 'S')}–${hemi(n, 'N', 'S')} · ${hemi(w, 'E', 'W')}–${hemi(e, 'E', 'W')}`;

/** Twelve density classes of the typical year (median per month), for an example card. */
export const ribbonModel = (typical, aoiCells) => (typical ?? []).map((t) => ({ month: t.month, bin: t.median === null ? NODATA : binClass(Math.round(t.median), aoiCells) }));

const typicalSpan = (typical) => {
  const withMedian = (typical ?? []).filter((t) => t.median !== null);
  if (!withMedian.length) return null;
  return `${Math.min(...withMedian.map((t) => t.from))}–${Math.max(...withMedian.map((t) => t.to))}`;
};

const SKELETON_CELLS = 13 * 8;

const skeleton = () => h('div', { class: 'skeleton', 'aria-hidden': 'true' },
  h('div', { class: 'sk-row' }, h('span', { class: 'sk-card' }), h('span', { class: 'sk-card' }), h('span', { class: 'sk-card' })),
  h('span', { class: 'sk-line' }),
  h('div', { class: 'sk-grid' }, Array.from({ length: SKELETON_CELLS }, () => h('span', { class: 'skeleton-cell' }))));

const emptyView = (m, deps) => {
  const art = h('figure', { class: 'hero-art' });
  const cards = (deps.presets ?? PRESETS).map((p) => {
    const ribbon = h('div', { class: 'ribbon', 'aria-hidden': 'true' }, Array.from({ length: 12 }, () => h('i', { class: 'is-loading' })));
    const foot = h('p', { class: 'ex-foot' });
    const card = h('button', { type: 'button', class: 'ex chip-example', 'data-preset': p.id, onclick: () => deps.onPick?.(p.id) },
      h('span', { class: 'ex-t' }, h('span', { text: p.label }), icon('arrow')),
      h('span', { class: 'ex-c mono', text: bboxText(p.bbox) }),
      ribbon,
      h('span', { class: 'ribbon-l', 'aria-hidden': 'true' }, MONTH_ABBR.map((x) => h('span', { text: x[0] }))),
      foot);
    return { p, card, ribbon, foot };
  });
  const view = h('div', { class: 'first-run' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'eyebrow', text: 'MODIS + VIIRS · one harmonized record' }),
        h('h1', { class: 'hero-title' }, EMPTY_TITLE[0], h('em', { text: EMPTY_TITLE[1] })),
        h('p', { class: 'lead', text: m.lines[0] }),
        h('div', { class: 'cta' },
          h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: (ev) => deps.onDraw?.(ev.currentTarget) }, icon('drawArea'), 'Draw an area on the map'),
          h('button', { type: 'button', class: 'btn btn-lg', onclick: (ev) => deps.onCoords?.(ev.currentTarget) }, icon('crosshair'), 'Enter coordinates')),
        h('dl', { class: 'cover' }, recordDates(deps.manifest).map((d) => h('div', {}, h('dt', { text: d.k }), h('dd', { text: d.v }))))),
      art),
    h('section', { class: 'examples', 'aria-labelledby': 'examples-title' },
      h('h2', { id: 'examples-title', class: 'eyebrow', text: 'Or open an example' }),
      h('div', { class: 'ex-grid' }, cards.map((c) => c.card))));

  // Example data is decoration: a failed load leaves the cards usable without their ribbons.
  cards.forEach(({ p, ribbon, foot }, i) => {
    deps.loadExample?.(p).then((r) => {
      if (!r || !view.isConnected) return;
      const cells = aoiCellCount(p.bbox, r.manifest.grid.res);
      ribbon.replaceChildren(...ribbonModel(r.typical, cells).map((x) => h('i', { class: `bin-${x.bin}` })));
      const span = typicalSpan(r.typical);
      foot.textContent = span ? `Typical year, median ${span} · Preview` : 'Not enough history for a typical year';
      if (i === 0) {
        const hostRad = h('div', { class: 'radiant-hero' });
        art.replaceChildren(hostRad, h('figcaption', { text: `${p.label}, ${r.cells[0]?.year}–${r.cells[r.cells.length - 1]?.year}, as a Radiant: rings are years, slices are months.${deps.synthetic ? ' Synthetic data.' : ''}` }));
        radiant.mount(hostRad, { cells: r.cells, aoiCells: cells, labels: 'abbr', onSelect: () => deps.onPick?.(p.id) });
      }
    }).catch(() => {});
  });
  return view;
};

/**
 * mount(container, {presets, manifest, synthetic, onPick(id), onRetry(), onDraw(btn),
 * onCoords(btn), loadExample(preset)}). Returns {show(state), clear(), destroy()}.
 * The loading skeleton sets aria-busy on the container; any other state clears it.
 */
export const mount = (container, deps = {}) => {
  const show = (state) => {
    const m = stateModel(state, { presets: deps.presets });
    container.setAttribute('aria-busy', String(m.busy));
    if (m.kind === 'empty') { container.replaceChildren(emptyView(m, deps)); return; }
    const nodes = [];
    if (m.title) nodes.push(h('h2', { class: 'state-title', text: m.title }));
    m.lines.forEach((t, i) => nodes.push(h('p', { class: i === 0 ? `state-line state-${m.kind}` : 'hint', text: t })));
    if (m.kind === 'loading') nodes.push(skeleton());
    if (m.action) nodes.push(h('button', { type: 'button', class: 'btn btn-primary state-action', text: m.action.label, onclick: () => deps.onRetry?.() }));
    container.replaceChildren(h('div', { class: `state state-box-${m.kind}`, role: m.role }, nodes));
  };
  const clear = () => { container.removeAttribute('aria-busy'); container.replaceChildren(); };
  return { show, clear, destroy: clear };
};
