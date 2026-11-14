import { VIEWS } from './views.js';
import { createStore, parseHash, serializeHash } from './state.js';
import { findPreset, presetsFor } from './presets.js';
import * as appShell from './components/app-shell.js';
import * as queryBar from './components/query-bar.js';
import { spanFromManifest } from './components/date-range.js';
import { h } from './components/h.js';
import * as legend from './components/legend.js';
import * as exportMenu from './components/export-menu.js';
import * as kpiStrip from './components/kpi-strip.js';
import * as calendarGrid from './components/calendar-grid.js';
import * as mapPicker from './components/map-picker.js';
import * as caveatStrip from './components/caveat-strip.js';
import * as cellDetail from './components/cell-detail.js';
import * as methodDrawer from './components/method-drawer.js';
import * as states from './components/states.js';
import * as anomalyLayer from './components/anomaly-layer.js';
import * as liveView from './components/live-view.js';
import { PREVIEW_NOTE, previewAnomaly, previewLive } from './preview-stubs.js';
import { createDataSource, dataSourceConfig } from './data-source.js';
import { buildResult, csvMeta } from './view-data.js';

// Mount slots. Each is a no-op until its owner replaces it (task in the comment). They all
// receive the slot element and { store, slots, span, data, preview, onSelect, onClose }, and may return nothing. `data` is a
// store of { status: 'idle' | 'loading' | 'ready' | 'error', result, error }: `result` is
// view-data.buildResult (cells, kpis, series, aoiCells, manifest...) for the committed query.
const noop = () => {};
export const MOUNTS = {
  method: noop, // the Method button is mounted by the drawer, which owns it
  export: (el, { data }) => exportMenu.mount(el, {
    getSeries: () => data.get().result?.series ?? null,
    getMeta: () => (data.get().result ? csvMeta(data.get().result) : {}),
    getLink: () => location.href,
  }),
  kpi: (el, { data }) => mountResults(data, (r) => ({ cells: r.cells, kpis: r.kpis, coverage: r.manifest.coverage }), kpiStrip, el),
  calendar: (el, { store, data, onSelect, onClose, preview }) => {
    const counts = (r) => ({ cells: r.cells, aoiCells: r.aoiCells, onSelect, onClose });
    if (!preview) { mountResults(data, counts, calendarGrid, el); return; }
    // Layer switch: both grids stay mounted, the QueryState `layer` picks the visible one.
    const countsEl = h('div');
    const anomalyEl = h('div', { hidden: true }, previewNote(), h('div'));
    el.replaceChildren(countsEl, anomalyEl);
    mountResults(data, counts, calendarGrid, countsEl);
    mountResults(data, (r) => anomalyDeps(r, { onSelect, onClose }), anomalyLayer, anomalyEl.lastChild);
    const show = (s) => { countsEl.hidden = s.layer === 'anomaly'; anomalyEl.hidden = s.layer !== 'anomaly'; };
    store.subscribe(show);
    show(store.get());
  },
  legend: (el, { store, preview }) => {
    const layerOf = (s) => (preview && s.layer === 'anomaly' ? 'anomaly' : 'counts');
    const ctl = legend.mount(el, { layer: layerOf(store.get()) });
    store.subscribe((s) => ctl.update({ layer: layerOf(s) }));
  },
  table: noop, // the calendar's own table toggle (data-table) already covers this slot
  detail: noop, // mounted in start(): the caveat strip and the calendar both talk to it
  drawer: noop, // mounted in start() with the caveat strip, which opens it
  caveat: noop,
  map: noop, // M1-G3: mounted in start(), it needs the query form for the two-way sync
  sensors: noop, // M1-K10: Sensors view
  anomalies: (el, { data, preview, onSelect, onClose }) => {
    if (!preview) return;
    const grid = h('div');
    const key = h('div', { class: 'anomaly-key' });
    el.replaceChildren(previewNote(), grid, key);
    mountResults(data, (r) => anomalyDeps(r, { onSelect, onClose }), anomalyLayer, grid);
    legend.mount(key, { layer: 'anomaly' });
  },
  live: (el, { data, preview }) => {
    if (!preview) return;
    const chart = h('div');
    el.replaceChildren(previewNote(), chart);
    mountResults(data, (r) => ({ input: previewLive(r.cells) }), liveView, chart);
  },
};

const previewNote = () => h('p', { class: 'hint anomaly-preview-note', text: PREVIEW_NOTE });

const anomalyDeps = (r, { onSelect, onClose }) => ({
  cells: anomalyLayer.withAnomaly(r.cells, previewAnomaly(r.cells)), aoiCells: r.aoiCells,
  onSelect: (cell) => onSelect(cell, { layer: 'anomaly' }), onClose,
});

// Mounts a result component on first ready result and updates it on later ones; a new query
// keeps the previous result on screen until its replacement arrives.
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
};

export const start = async (root = document.getElementById('app')) => {
  const fixtures = new URLSearchParams(location.search).get('fixtures') === '1';
  const params = new URLSearchParams(location.search);
  // ?preview=1 turns on the Anomalies and Live views, fed by placeholder numbers (preview-stubs.js).
  const preview = params.get('preview') === '1';
  const views = preview ? VIEWS.map((v) => (v.id === 'anomalies' || v.id === 'live' ? { ...v, enabled: true } : v)) : VIEWS;
  const presets = presetsFor({ fixtures });
  const source = createDataSource(dataSourceConfig({ fixtures }));
  const manifest = await source.manifest().catch(() => null);
  const span = manifest ? spanFromManifest(manifest) : null;
  const { state, errors } = parseHash(location.hash, { span, views });
  const store = createStore(state);

  const shell = appShell.mount(root, {
    views,
    activeView: state.view,
    onView: (view) => store.set({ view }),
    previewIds: preview ? ['live'] : [],
  });
  const { slots } = shell;
  const data = createStore({ status: 'idle', result: null, error: null });
  // Everything that changes the query goes through the hash; the hashchange listener feeds the store.
  const goTo = (patch) => { location.hash = serializeHash({ ...store.get(), ...patch }); };

  const status = h('p', { class: 'status', role: 'status' });
  slots.query.append(status);
  const showErrors = (list) => {
    status.textContent = list.length ? `Ignored from the link: ${list.map((e) => `${e.field} (${e.reason})`).join('; ')}` : '';
  };
  showErrors(errors);
  const map = {};
  const qb = queryBar.mount(slots.query, {
    store, views, span, goTo, presets,
    onAoiInput: (v) => { if (v.valid) map.ctl?.setBbox(v.bbox); },
    onDrawMap: () => map.ctl?.openFull(),
  });
  map.ctl = mapPicker.mount(slots.map, { bbox: state.bbox, onChange: (b) => qb.aoi.set(b) });
  // The toggle sits next to Apply; the map body stays in its own panel under the query card.
  qb.actions.append(slots.map.querySelector('.map-head'));

  const drawer = methodDrawer.mount(slots.drawer, { trigger: slots.method, manifest });
  caveatStrip.mount(slots.caveat, { onReadMore: (btn) => drawer.open(btn) });
  const detail = cellDetail.mount(slots.detail, { aoiCells: 0 });

  // The shell hides slots.empty once an area is set; the loading, error and zero states
  // reuse it, so it is shown again here, and the result groups hidden while no result is valid.
  const resultGroups = shell.groups;
  const stateView = states.mount(slots.empty, {
    presets,
    onPick: (id) => goTo(queryBar.presetPatch(findPreset(id, presets), store.get(), span)),
    onRetry: () => run(store.get()),
  });
  let shownState = null;
  const paintState = () => {
    const d = data.get();
    const screen = states.screenState({ hasArea: store.get().bbox !== null, status: d.status, cells: d.result?.cells });
    slots.empty.hidden = screen.kind === null;
    if (!screen.results) resultGroups.forEach((g) => { g.hidden = true; });
    const next = screen.kind === 'error' ? states.errorState(d.error) : screen.kind && { kind: screen.kind };
    const key = JSON.stringify(next);
    if (key === shownState) return;
    shownState = key;
    if (next) stateView.show(next);
    else stateView.clear();
  };

  data.subscribe(({ status, result }) => {
    if (status !== 'ready') return;
    detail.close({ restore: false });
    detail.update({ aoiCells: result.aoiCells });
    drawer.update({ manifest: result.manifest });
  });

  const ctx = { store, slots, span, data, preview, onSelect: (cell, opts) => detail.open(cell, opts), onClose: () => detail.close() };
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

if (typeof document !== 'undefined' && document.getElementById('app')) start();
