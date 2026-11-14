import { VIEWS } from './views.js';
import { createStore, parseHash, serializeHash } from './state.js';
import { findPreset, presetsFor } from './presets.js';
import * as appShell from './components/app-shell.js';
import * as queryBar from './components/query-bar.js';
import { spanFromManifest } from './components/date-range.js';
import { h } from './components/h.js';
import * as legend from './components/legend.js';
import * as themeControl from './components/theme-control.js';
import * as exportMenu from './components/export-menu.js';
import * as toast from './components/toast.js';
import * as verdictRow from './components/verdict-row.js';
import * as calendarGrid from './components/calendar-grid.js';
import * as mapPicker from './components/map-picker.js';
import * as caveatStrip from './components/caveat-strip.js';
import * as cellDetail from './components/cell-detail.js';
import * as methodDrawer from './components/method-drawer.js';
import * as states from './components/states.js';
import * as anomalyLayer from './components/anomaly-layer.js';
import * as liveView from './components/live-view.js';
import * as syntheticBand from './components/synthetic-band.js';
import { icon } from './components/icons.js';
import { PREVIEW_NOTE, previewAnomaly, previewLive } from './preview-stubs.js';
import { createDataSource, dataSourceConfig } from './data-source.js';
import { buildResult, csvMeta, isSyntheticManifest } from './view-data.js';
import { registerSW } from './pwa.js';

const offerUpdate = (apply) => {
  const toast = h('div', { class: 'update-toast', role: 'status' }, h('span', { text: 'A new version is ready.' }),
    h('button', { type: 'button', class: 'btn btn-primary', text: 'Reload', onclick: apply }));
  document.body.append(toast);
};

const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 40rem)').matches);

// Same-document View Transition where supported (Baseline 2025); a plain swap otherwise.
const viewTransition = (fn) => {
  if (!document.startViewTransition || reducedMotion()) { fn(); return; }
  document.startViewTransition(fn);
};

// Mounts a result component on the first ready result and updates it on later ones; a new query
// keeps the previous result on screen until its replacement arrives. Returns a getter for the
// component's controller (null until the first result).
const mountResults = (data, deps, component, el) => {
  let ctl = null;
  let shown = null;
  // Status-only changes keep the same result; repainting would rebuild the grid and drop focus.
  const paint = ({ result }) => {
    if (!result || result === shown) return;
    shown = result;
    if (ctl) ctl.update(deps(result));
    else ctl = component.mount(el, deps(result));
  };
  data.subscribe(paint);
  paint(data.get());
  return () => ctl;
};

const previewNote = () => h('p', { class: 'hint anomaly-preview-note', text: PREVIEW_NOTE });

const anomalyDeps = (r, { onSelect, onClose }) => ({
  cells: anomalyLayer.withAnomaly(r.cells, previewAnomaly(r.cells)), aoiCells: r.aoiCells,
  onSelect: (cell) => onSelect(cell, { layer: 'anomaly' }), onClose,
});

const segmented = (label, options, onPick) => {
  const btns = options.map((o) => h('button', { type: 'button', role: 'radio', class: 'seg-opt', 'data-id': o.id, 'aria-checked': String(o.on) }, o.label));
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, btns);
  const set = (id) => btns.forEach((b) => { const on = b.dataset.id === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  group.addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (b) { set(b.dataset.id); onPick(b.dataset.id); } });
  group.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus();
    set(b.dataset.id);
    onPick(b.dataset.id);
  });
  set(options.find((o) => o.on)?.id);
  return { el: group, set };
};

/** The calendar card: header (title, stepped legend bar, layer and display switches), grid(s), legend foot. */
const mountCalendarCard = (el, ctx) => {
  const { store, data, preview, views, onSelect, onClose } = ctx;
  const sub = h('p', { class: 'sub' });
  const rampHost = h('div', { class: 'ramp-host' });
  const tools = h('div', { class: 'cal-tools' });
  const head = h('div', { class: 'cal-head' }, h('div', { class: 'cal-head-text' }, h('h2', { text: 'Fire-cell-days by month' }), sub), rampHost, tools);
  const countsEl = h('div');
  const anomalyEl = h('div', { hidden: true }, previewNote(), h('div'));
  const foot = h('div', { class: 'cal-foot' });
  el.replaceChildren(h('section', { class: 'card cal-card', 'aria-label': 'Fire-cell-days by month' }, head, countsEl, preview ? anomalyEl : null, foot));

  const choices = queryBar.layerChoices(views);
  if (choices.length) {
    const fs = h('fieldset', { class: 'layer seg' }, h('legend', { class: 'sr-only', text: 'Color by' }),
      choices.map((c) => h('label', {},
        h('input', { type: 'radio', name: 'layer', value: c.id, checked: store.get().layer === c.id, onchange: () => store.set({ layer: c.id }) }), queryBar.LAYER_LABELS[c.id])));
    tools.append(fs);
  }
  const display = segmented('Display', [{ id: 'grid', label: 'Grid', on: true }, { id: 'table', label: 'Table', on: false }], (id) => ctx.grids.forEach((g) => g()?.setTable(id === 'table')));
  tools.append(display.el);
  ctx.showTable = (year) => { display.set('table'); ctx.grids.forEach((g) => g()?.showYear(year)); };

  const countsDeps = (r) => ({ cells: r.cells, aoiCells: r.aoiCells, typical: r.typical, onSelect, onClose });
  ctx.grids.push(mountResults(data, countsDeps, calendarGrid, countsEl));
  if (preview) ctx.grids.push(mountResults(data, (r) => anomalyDeps(r, { onSelect, onClose }), anomalyLayer, anomalyEl.lastChild));
  data.subscribe(({ result }) => {
    if (!result) return;
    sub.textContent = `Newest year on top. Number in each cell: fire-cell-days.${calendarGrid.mostlyEstimated(result.cells) ? ' All values are estimated.' : ''}`;
  });

  const layerOf = (s) => (preview && s.layer === 'anomaly' ? 'anomaly' : 'counts');
  const lg = legend.mount(foot, { layer: layerOf(store.get()) });
  const show = (s) => {
    const l = layerOf(s);
    countsEl.hidden = l === 'anomaly';
    anomalyEl.hidden = l !== 'anomaly';
    rampHost.replaceChildren(legend.ramp(l));
    lg.update({ layer: l });
  };
  store.subscribe(show);
  show(store.get());
};

// Mount slots. Each receives the slot element and the shared context; see start().
export const MOUNTS = {
  calendar: mountCalendarCard,
  verdict: (el, ctx) => {
    ctx.verdict = mountResults(ctx.data, (r) => ({
      cells: r.cells, allCells: r.allCells, kpis: r.kpis, typical: r.typical, aoiCells: r.aoiCells,
      onSelect: (c) => ctx.onSelect(c), onHover: (c) => ctx.grids[0]?.()?.link(c && { year: c.year, month: c.month }),
    }), verdictRow, el);
  },
  sensors: () => {}, // M1-K10: Sensors view
  anomalies: (el, { data, preview, onSelect, onClose }) => {
    if (!preview) return;
    const grid = h('div');
    const key = h('div', { class: 'anomaly-key' });
    el.replaceChildren(h('section', { class: 'card' }, previewNote(), grid, key));
    mountResults(data, (r) => anomalyDeps(r, { onSelect, onClose }), anomalyLayer, grid);
    legend.mount(key, { layer: 'anomaly' });
  },
  live: (el, { data, preview }) => {
    if (!preview) return;
    const chart = h('div');
    el.replaceChildren(h('section', { class: 'card' }, previewNote(), chart));
    mountResults(data, (r) => ({ input: previewLive(r.cells) }), liveView, chart);
  },
};

const mountInstall = (slot) => {
  if (globalThis.matchMedia?.('(display-mode: standalone)').matches) return;
  let prompt = null;
  const btn = h('button', { type: 'button', class: 'btn install-button', hidden: true }, icon('install'), 'Install app');
  btn.addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    prompt = null;
    btn.hidden = true;
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; btn.hidden = false; });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });
  slot.replaceChildren(btn);
};

export const start = async (root = document.getElementById('app')) => {
  const params = new URLSearchParams(location.search);
  const fixtures = params.get('fixtures') === '1';
  // ?preview=1 turns on the Anomalies and Live views, fed by placeholder numbers (preview-stubs.js).
  const preview = params.get('preview') === '1';
  const views = preview ? VIEWS.map((v) => (v.id === 'anomalies' || v.id === 'live' ? { ...v, enabled: true } : v)) : VIEWS;
  const presets = presetsFor({ fixtures });
  const source = createDataSource(dataSourceConfig({ fixtures }));
  const manifest = await source.manifest().catch(() => null);
  const synthetic = isSyntheticManifest(manifest);
  const span = manifest ? spanFromManifest(manifest) : null;
  const { state, errors } = parseHash(location.hash, { span, views });
  const store = createStore(state);

  const shell = appShell.mount(root, {
    views,
    activeView: state.view,
    onView: (view) => viewTransition(() => store.set({ view })),
    previewIds: preview ? ['live'] : [],
    synthetic,
  });
  const { slots } = shell;
  const data = createStore({ status: 'idle', result: null, error: null });
  // Everything that changes the query goes through the hash; the hashchange listener feeds the store.
  const goTo = (patch) => { location.hash = serializeHash({ ...store.get(), ...patch }); };

  const status = h('p', { class: 'status', role: 'status' });
  shell.context.append(status);
  const showErrors = (list) => {
    status.textContent = list.length ? `Ignored from the link: ${list.map((e) => `${e.field} (${e.reason})`).join('; ')}` : '';
  };
  showErrors(errors);
  const map = {};
  const qb = queryBar.mount(slots.query, {
    store, span, goTo, presets, mapSlot: slots.map,
    onAoiInput: (v) => { if (v.valid) map.ctl?.setBbox(v.bbox); },
    onDrawMap: () => map.ctl?.openFull(),
    onMapToggle: () => (isPhone() ? map.ctl?.openFull() : map.ctl?.show()),
  });
  map.ctl = mapPicker.mount(slots.map, { bbox: state.bbox, onChange: (b) => qb.aoi.set(b) });

  const drawer = methodDrawer.mount(slots.drawer, {
    trigger: slots.method, manifest, beforeOpen: () => { map.ctl?.closeFull(); qb.close(); }, themeMount: (el) => themeControl.mount(el),
  });
  toast.prepare();
  syntheticBand.mount(slots.synthetic, {
    manifest, tagSlot: slots.synthTag, below: [...document.querySelectorAll('.topbar, .page')], onMethod: (btn) => drawer.open(btn),
  });
  caveatStrip.mount(slots.caveat, { onReadMore: (btn) => drawer.open(btn) });
  themeControl.mount(slots.themeFoot);
  mountInstall(slots.install);
  exportMenu.mount(slots.export, {
    getSeries: () => data.get().result?.series ?? null,
    getMeta: () => (data.get().result ? csvMeta(data.get().result) : {}),
    isSynthetic: () => synthetic,
  });

  const ctx = { store, slots, span, data, preview, views, grids: [], verdict: null };
  const grid = () => ctx.grids[0]?.();
  const allGrids = () => ctx.grids.map((g) => g()).filter(Boolean);
  const detail = cellDetail.mount(slots.detail, {
    aoiCells: 0,
    context: () => {
      const r = data.get().result;
      return r ? { cells: r.cells, allCells: r.allCells, manifest: r.manifest } : {};
    },
    onClose: () => { allGrids().forEach((g) => g.select?.(null)); ctx.verdict?.()?.select(null); },
    onStep: (key) => (store.get().layer === 'anomaly' && preview ? ctx.grids[1]?.() : grid())?.step?.(key),
    onShowTable: (cell) => { detail.close(); ctx.showTable?.(cell.year); },
  });
  ctx.onSelect = (cell, opts) => {
    const sel = { year: cell.year, month: cell.month };
    allGrids().forEach((g) => g.select?.(sel));
    ctx.verdict?.()?.select(sel);
    detail.open(cell, opts);
  };
  ctx.onClose = () => detail.close();

  // The shell hides slots.empty once an area is set; the loading, error and zero states
  // reuse it, so it is shown again here, and the result groups hidden while no result is valid.
  const exampleSource = createDataSource(dataSourceConfig({ fixtures }));
  let exampleQueue = Promise.resolve();
  // One source aborts its previous load, so the example areas load one after another.
  const loadExample = (p) => {
    const next = exampleQueue.then(async () => {
      const { manifest: m, tiles } = await exampleSource.load(p.bbox);
      return buildResult({ bbox: p.bbox, from: null, to: null, manifest: m, tiles });
    });
    exampleQueue = next.catch(() => null);
    return next;
  };
  const stateView = states.mount(slots.empty, {
    presets, manifest, synthetic, loadExample,
    onPick: (id) => goTo(queryBar.presetPatch(findPreset(id, presets), store.get(), span)),
    onRetry: () => run(store.get()),
    onDraw: (btn) => qb.open('map', btn),
    onCoords: (btn) => qb.open('area', btn),
  });
  let shownState = null;
  const paintState = () => {
    const d = data.get();
    const screen = states.screenState({ hasArea: store.get().bbox !== null, status: d.status, cells: d.result?.cells });
    slots.empty.hidden = screen.kind === null;
    slots.verdict.hidden = !screen.results;
    slots.caveat.hidden = store.get().bbox === null;
    if (!screen.results) shell.groups.forEach((g) => { g.hidden = true; });
    const next = screen.kind === 'error' ? states.errorState(d.error) : screen.kind && { kind: screen.kind };
    const key = JSON.stringify(next);
    if (key === shownState) return;
    shownState = key;
    if (next) stateView.show(next);
    else stateView.clear();
  };

  data.subscribe(({ status: st, result }) => {
    if (st !== 'ready') return;
    detail.close({ restore: false });
    detail.update({ aoiCells: result.aoiCells });
    drawer.update({ manifest: result.manifest });
    slots.version.textContent = `Data: ${result.manifest.dataVersion}`;
  });

  for (const [name, mountFn] of Object.entries(MOUNTS)) mountFn(slots[name], ctx);

  let seq = 0;
  const run = async ({ bbox, from, to }) => {
    const mine = ++seq;
    if (!bbox) { source.cancel(); data.set({ status: 'idle', result: null, error: null }); return; }
    data.set({ status: 'loading', error: null });
    try {
      const { manifest: m, tiles } = await source.load(bbox);
      if (mine !== seq) return;
      data.set({ status: 'ready', result: buildResult({ bbox, from, to, manifest: m, tiles }), error: null });
    } catch (err) {
      if (mine !== seq || err?.kind === 'aborted') return;
      data.set({ status: 'error', error: err });
    }
  };

  const render = (s) => {
    shell.update({ view: s.view, hasArea: s.bbox !== null, hero: appShell.heroModel(s, { presets, span }) });
    paintState();
  };
  data.subscribe(() => render(store.get()));
  let lastQuery = state;
  store.subscribe((s) => {
    const next = serializeHash(s);
    if (location.hash !== next) location.hash = next;
    render(s);
    if (s.bbox !== lastQuery.bbox || s.from !== lastQuery.from || s.to !== lastQuery.to) {
      lastQuery = s;
      run(s);
    }
  });
  window.addEventListener('hashchange', () => {
    const parsed = parseHash(location.hash, { span, views });
    showErrors(parsed.errors);
    store.set(parsed.state);
  });
  if (!location.hash) history.replaceState(null, '', serializeHash(state));
  render(state);
  run(state);
  return store;
};

if (typeof document !== 'undefined' && document.getElementById('app')) {
  start();
  registerSW({ onUpdate: offerUpdate });
}
