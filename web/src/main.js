import { PREVIEW_VIEWS, viewsFor } from './views.js';
import { createStore, parseHash, serializeHash } from './state.js';
import { findPreset, presetsFor } from './presets.js';
import { dataRegionBbox, defaultArea, hotspotAt, hotspotPresets, placeLabel } from './places.js';
import * as appShell from './components/app-shell.js';
import * as queryBar from './components/query-bar.js';
import { spanFromManifest } from './components/date-range.js';
import { h } from './components/h.js';
import * as legend from './components/legend.js';
import * as themeControl from './components/theme-control.js';
import * as exportMenu from './components/export-menu.js';
import { csvExport } from './components/export-menu.js';
import * as toast from './components/toast.js';
import * as verdictRow from './components/verdict-row.js';
import * as calendarGrid from './components/calendar-grid.js';
import * as mapPicker from './components/map-picker.js';
import * as caveatStrip from './components/caveat-strip.js';
import * as cellDetail from './components/cell-detail.js';
import * as methodDrawer from './components/method-drawer.js';
import * as areaDrawer from './components/area-drawer.js';
import * as states from './components/states.js';
import * as anomalyLayer from './components/anomaly-layer.js';
import * as radiant from './components/radiant.js';
import * as dataTable from './components/data-table.js';
import * as liveView from './components/live-view.js';
import * as sensorsView from './components/sensors-view.js';
import { segmented } from './components/segmented.js';
import * as offlineChip from './components/offline-chip.js';
import * as syntheticBand from './components/synthetic-band.js';
import { icon } from './components/icons.js';
import { PREVIEW_NOTE, previewAnomaly, previewLive } from './preview-stubs.js';
import { createDataSource, dataSourceConfig } from './data-source.js';
import { buildResult, csvMeta, isSyntheticManifest, sliceSeries } from './view-data.js';
import { closeIosHint, isIOS, registerSW, showIosHint } from './pwa.js';

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
  // A transition skipped by the next one rejects `ready`; the swap itself still happens.
  document.startViewTransition(fn).ready.catch(() => {});
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

const slicedSensors = (r) => Object.fromEntries(['modis', 'viirs', 'noaa20'].map((id) => [id, sliceSeries(r.sensors[id], r.from, r.to)]));

const previewNote = (synthetic) => h('p', { class: 'hint anomaly-preview-note', text: synthetic ? `Synthetic data. ${PREVIEW_NOTE}` : PREVIEW_NOTE });

// Placeholder ranks for a result, computed once per result.
const ranked = new WeakMap();
const anomalyCells = (r) => {
  if (!ranked.has(r)) ranked.set(r, anomalyLayer.withAnomaly(r.cells, previewAnomaly(r.cells)));
  return ranked.get(r);
};

const anomalyDeps = (r, { onSelect, onClose }) => ({
  cells: anomalyCells(r), aoiCells: r.aoiCells,
  onSelect: (cell) => onSelect(cell, { layer: 'anomaly' }), onClose,
});

/** The calendar card: header (title, stepped legend bar, layer and display switches), grid(s), legend foot. */
const mountCalendarCard = (el, ctx) => {
  const { store, data, preview, synthetic, views, onSelect, onClose } = ctx;
  const sub = h('p', { class: 'sub' });
  const rampHost = h('div', { class: 'ramp-host' });
  const tools = h('div', { class: 'cal-tools' });
  const head = h('div', { class: 'cal-head' }, h('div', { class: 'cal-head-text' }, h('h2', { text: 'Fire-cell-days by month' }), sub), rampHost, tools);
  const countsEl = h('div');
  const anomalyEl = h('div', { hidden: true }, previewNote(synthetic), h('div'));
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
      cells: r.cells, kpis: r.kpis, typical: r.typical, aoiCells: r.aoiCells,
      onSelect: (c) => ctx.onSelect(c), onHover: (c) => ctx.grids[0]?.()?.link(c && { year: c.year, month: c.month }),
    }), verdictRow, el);
  },
  sensors: (el, ctx) => {
    const { data, synthetic } = ctx;
    mountResults(data, (r) => ({
      sensors: slicedSensors(r), harmonized: { ...r.harmonized, series: r.series }, manifest: r.manifest, synthetic,
    }), sensorsView, el);
  },
  anomalies: (el, { data, preview, synthetic, onSelect, onClose }) => {
    if (!preview) return;
    const answer = h('section', { class: 'card answer-card anomaly-answer', 'aria-label': 'Latest month against its history' });
    const answerText = h('div');
    const radiantHost = h('div');
    answer.append(answerText, radiantHost);
    const grid = h('div');
    const tableHost = h('div', { hidden: true });
    const key = h('div', { class: 'anomaly-key' });
    const display = segmented('Display', [{ id: 'grid', label: 'Grid', on: true }, { id: 'table', label: 'Table', on: false }], (id) => {
      grid.hidden = id === 'table';
      tableHost.hidden = id !== 'table';
    });
    const head = h('div', { class: 'cal-head' },
      h('div', { class: 'cal-head-text' },
        h('h2', {}, 'How unusual was each month ', h('span', { class: 'tag', text: 'Preview' })),
        h('p', { class: 'sub', text: 'Number: percentile among the same month in other years. Placeholder method, not reviewed by the science team.' })),
      legend.ramp('anomaly'), h('div', { class: 'cal-tools' }, display.el));
    el.replaceChildren(h('div', { class: 'anomaly-view' }, answer,
      h('section', { class: 'card cal-card anomaly-card', 'aria-label': 'How unusual was each month' },
        head, synthetic ? h('span', { class: 'chart-stamp-html', 'aria-hidden': 'true', text: 'SYNTHETIC DATA' }) : null, grid, tableHost, key)));
    mountResults(data, (r) => anomalyDeps(r, { onSelect, onClose }), anomalyLayer, grid);
    legend.mount(key, { layer: 'anomaly', marksOnly: true });
    let rad = null;
    let shown = null;
    data.subscribe(({ result: r }) => {
      if (!r || r === shown) return;
      shown = r;
      const cells = anomalyCells(r);
      dataTable.mount(tableHost, { model: anomalyLayer.anomalyTableModel(cells, { synthetic }) });
      const a = anomalyLayer.anomalyAnswer(cells);
      const tags = [synthetic ? h('span', { class: 'tag tag-synth', text: 'Synthetic' }) : null, h('span', { class: 'tag', text: 'Preview' })];
      if (!a) {
        answerText.replaceChildren(h('p', { class: 'eyebrow answer-eyebrow' }, h('span', { text: 'Latest month' }), tags),
          h('p', { class: 'answer-lead', text: 'No month in this range has enough earlier years to rank it.' }));
      } else {
        const list = h('details', { class: 'flag-list' }, h('summary', { text: a.flaggedText }),
          h('ul', {}, a.flagged.map((c) => h('li', {}, h('button', { type: 'button', text: `${c.year}-${String(c.month).padStart(2, '0')}`, onclick: () => onSelect(c, { layer: 'anomaly' }) })))));
        answerText.replaceChildren(h('p', { class: 'eyebrow answer-eyebrow' }, h('span', { text: 'Latest month' }), tags),
          h('p', { class: 'answer-big live-headline', text: a.headline }),
          h('p', { class: 'answer-lead', text: a.sentence }),
          a.flagged.length ? list : h('p', { class: 'hint', text: a.flaggedText }));
      }
      const radDeps = { cells, aoiCells: r.aoiCells, labels: 'abbr', classOf: (c) => (typeof c.rank === 'number' ? `rb rd-${anomalyLayer.divClass(c.rank)}` : 'rb rd-norank'), onSelect: (c) => onSelect(c, { layer: 'anomaly' }) };
      if (rad) rad.update(radDeps);
      else rad = radiant.mount(radiantHost, radDeps);
    });
  },
  live: (el, ctx) => {
    const { data, preview, synthetic } = ctx;
    if (!preview) return;
    mountResults(data, (r) => {
      const input = previewLive(r.cells);
      ctx.setTabDot?.('live', states.liveStatus(input.fetched_at).available ? `updated in the last ${states.LIVE_STALE_HOURS} hours` : null);
      return { input, synthetic };
    }, liveView, el);
  },
};

// iOS Safari has no beforeinstallprompt. The footer always says how to install; a card says it
// once, after the first area loads, above the bottom tab bar.
const IOS_HOW = 'Install: tap Share, then Add to Home Screen.';
const iosCard = () => {
  const close = h('button', { type: 'button', class: 'ios-hint-close', 'aria-label': 'Close the install tip' }, icon('close'));
  const el = h('aside', { class: 'ios-card', 'aria-label': 'Install tip' }, icon('share'), h('span', { text: IOS_HOW }), close);
  close.addEventListener('click', () => {
    el.remove();
    document.getElementById('main-view')?.focus({ preventScroll: true });
  });
  return el;
};

const mountInstall = (slot) => {
  const standalone = Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches);
  if (isIOS(navigator) && !standalone && navigator.standalone !== true) { slot.replaceChildren(h('p', { class: 'ios-hint' }, icon('share'), h('span', { text: IOS_HOW }))); return; }
  if (standalone) return;
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
  // One list for the whole app: the hotspots from overview.json join it when they arrive.
  const presets = presetsFor({ fixtures });
  const source = createDataSource(dataSourceConfig({ fixtures }));
  let manifestError = null;
  const manifest = await source.manifest().catch((e) => { manifestError = e; return null; });
  const places = { status: manifest ? 'loading' : 'missing', overview: null };
  const overviewReady = manifest ? source.overview() : Promise.resolve(null);
  const synthetic = isSyntheticManifest(manifest);
  const { views, preview } = viewsFor({ synthetic, previewParam: params.get('preview') === '1' });
  const span = manifest ? spanFromManifest(manifest) : null;
  const { state, errors } = parseHash(location.hash, { span, views });
  const store = createStore(state);

  const shell = appShell.mount(root, {
    views,
    activeView: state.view,
    onView: (view) => {
      // Home does what the brand link does: an empty hash clears the area.
      if (view === 'home') location.hash = '';
      else if (store.get().bbox) viewTransition(() => store.set({ view }));
      else openDefault(view, document.getElementById(`tab-${view}`));
    },
    previewIds: preview ? PREVIEW_VIEWS : [],
    synthetic,
  });
  const { slots } = shell;
  const data = createStore({ status: 'idle', result: null, error: null });
  // Everything that changes the query goes through the hash; the hashchange listener feeds the store.
  // A new area never inherits the previous one's name.
  const goTo = (patch) => { location.hash = serializeHash({ ...store.get(), ...('bbox' in patch && !('name' in patch) ? { name: null } : {}), ...patch }); };
  const titleOf = (s) => appShell.heroModel(s, { presets }).title;

  const status = h('p', { class: 'status', role: 'status' });
  const domainText = h('span');
  const domainNote = h('p', { class: 'domain-note', hidden: true }, icon('info'), domainText);
  shell.context.append(status, h('div', { class: 'domain-row' }, domainNote));
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
    onAreaChip: (chip) => areas.open(chip),
    titleOf,
    loadPlaces: () => source.places(),
  });
  map.ctl = mapPicker.mount(slots.map, { bbox: state.bbox, onChange: (b) => qb.aoi.set(b) });

  const drawer = methodDrawer.mount(slots.drawer, {
    trigger: slots.method, manifest, beforeOpen: () => { map.ctl?.closeFull(); qb.close(); areas.close({ restore: false }); }, themeMount: (el) => themeControl.mount(el),
  });
  // The place picker. Its primary keeps the view and changes only the area; from Home it opens the calendar.
  const areas = areaDrawer.mount(slots.areaDrawer, {
    trigger: slots.areas,
    getOverview: () => places,
    isHome: () => store.get().bbox === null,
    currentBbox: () => store.get().bbox,
    beforeOpen: () => { map.ctl?.closeFull(); qb.close(); drawer.close(); },
    onCommit: (bbox) => {
      const home = store.get().bbox === null;
      goTo({ ...queryBar.presetPatch({ bbox, name: placeLabel(hotspotAt(places.overview, bbox)) }, store.get(), span), ...(home ? { view: 'calendar' } : {}) });
      if (home) window.scrollTo({ top: 0 });
    },
    onManual: (target, back) => qb.open(target === 'both' ? (isPhone() ? 'area' : 'map') : target, back ?? undefined),
  });
  toast.prepare();
  // The service worker serves cached tiles offline, so a fetch can succeed with the network down:
  // the browser's online flag and network failures both drive the chip.
  const offline = offlineChip.mount(slots.offline);
  const paintOffline = () => {
    const d = data.get();
    const failed = (d.status === 'error' && d.error?.kind === 'network') || (manifest === null && manifestError?.kind === 'network');
    offline.set({ failed, hasData: d.status === 'ready' || (d.status === 'idle' && manifest !== null) });
  };
  data.subscribe(paintOffline);
  paintOffline();
  syntheticBand.mount(slots.synthetic, {
    manifest, tagSlot: slots.synthTag, below: [...document.querySelectorAll('.topbar, .page')], onMethod: (btn) => drawer.open(btn),
  });
  caveatStrip.mount(slots.caveat, { onReadMore: (btn) => drawer.open(btn) });
  themeControl.mount(slots.themeFoot);
  mountInstall(slots.install);
  const exportCtl = exportMenu.mount(slots.export, {
    isSynthetic: () => synthetic,
    // The Sensors view exports its four series; every other view the calendar cells.
    getFile: () => {
      const r = data.get().result;
      if (!r) return null;
      const what = { series: r.series, cells: r.cells, sensors: slicedSensors(r), meta: csvMeta(r, { aoi: titleOf(store.get()) }) };
      return csvExport(store.get().view === 'sensors' ? 'sensors' : 'calendar', what);
    },
    // The image is the calendar of the area and period, whichever view is open.
    getImage: () => {
      const r = data.get().result;
      if (!r) return null;
      return { cells: r.cells, aoiCells: r.aoiCells, series: r.series, bbox: r.bbox, manifest: r.manifest, title: titleOf(store.get()) };
    },
  });

  const ctx = { store, slots, span, data, preview, synthetic, views, goTo, grids: [], verdict: null, setTabDot: shell.setTabDot };
  const grid = () => ctx.grids[0]?.();
  const allGrids = () => ctx.grids.map((g) => g()).filter(Boolean);
  const detail = cellDetail.mount(slots.detail, {
    aoiCells: 0,
    context: () => {
      const r = data.get().result;
      // Ranks ride along so the anomaly panel can color its bar strip; the counts panel ignores them.
      return r ? { cells: preview ? anomalyCells(r) : r.cells, manifest: r.manifest, caveats: r.caveats, ratios: { R: r.harmonized.R, K: r.harmonized.K } } : {};
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
      const { manifest: m, tiles, domain } = await exampleSource.load(p.bbox);
      return buildResult({ bbox: p.bbox, from: null, to: null, manifest: m, tiles, domain });
    });
    exampleQueue = next.catch(() => null);
    return next;
  };
  // The picked card sits below the fold on phone and the result is shorter than the first-run
  // screen, so without the scroll the page would open past the verdict.
  const openExample = (preset, patch = {}) => {
    goTo({ ...queryBar.presetPatch(preset, store.get(), span), ...patch });
    window.scrollTo({ top: 0 });
    document.getElementById('main-view')?.focus({ preventScroll: true });
  };
  // A view picked on the first screen opens, with nothing selected, the last area chosen this
  // session, else the suggestion (the hottest hotspot, or the fixture area); with neither, the picker.
  let lastArea = state.bbox;
  let lastName = state.name;
  const openDefault = (view, from) => {
    const pick = defaultArea({ last: lastArea, suggestion: presets[0]?.bbox ?? null });
    if (pick) openExample({ bbox: pick.bbox, name: pick.kind === 'last' ? lastName : presets[0]?.name ?? null }, { view });
    else areas.open(from);
  };
  // A month picked on the home Radiant opens the calendar on that area and selects the month once
  // its result is in (see the subscription after the mounts).
  let pendingMonth = null;
  const stateView = states.mount(slots.empty, {
    presets, overview: null, overviewSettled: false, manifest, synthetic, loadExample,
    dataRegion: () => source.domain().then((d) => dataRegionBbox(manifest, d)),
    onPick: (id) => openExample(findPreset(id, presets)),
    onPickMonth: (preset, cell) => {
      pendingMonth = { bbox: preset.bbox, year: cell.year, month: cell.month };
      openExample(preset, { view: 'calendar' });
    },
    onRetry: () => run(store.get()),
    onDraw: (btn) => qb.open('map', btn),
    onCoords: (btn) => qb.open('area', btn),
  });
  let shownState = null;
  const paintState = () => {
    const d = data.get();
    const screen = states.screenState({ hasArea: store.get().bbox !== null, status: d.status, cells: d.result?.cells, outside: d.result?.domain.outside });
    slots.empty.hidden = screen.kind === null;
    // Sensors, Anomalies and Live bring their own answer card.
    slots.verdict.hidden = !screen.results || store.get().view !== 'calendar';
    slots.caveat.hidden = store.get().bbox === null;
    if (!screen.results) shell.groups.forEach((g) => { g.hidden = true; });
    exportCtl.setDisabled(screen.kind === 'outside' ? states.outsideExport(places.overview?.region?.name) : null);
    const next = screen.kind === 'error' ? states.errorState(d.error, { offline: offline.state().online === false }) : screen.kind && { kind: screen.kind };
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
    const note = states.domainNote(result.domain, places.overview?.region?.name);
    domainText.textContent = note ?? '';
    domainNote.hidden = !note;
    slots.version.textContent = `Data: ${result.manifest.dataVersion}`;
  });

  for (const [name, mountFn] of Object.entries(MOUNTS)) mountFn(slots[name], ctx);

  const standalone = Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches);
  let iosShown = false;
  const offerIosCard = ({ status: st }) => {
    if (iosShown || st !== 'ready' || !store.get().bbox || !showIosHint(navigator, { standalone })) return;
    iosShown = true;
    closeIosHint(); // shown once: the key is written as it appears
    document.body.append(iosCard());
  };
  data.subscribe(offerIosCard);

  let seq = 0;
  const run = async ({ bbox, from, to }) => {
    const mine = ++seq;
    if (!bbox) { source.cancel(); data.set({ status: 'idle', result: null, error: null }); return; }
    data.set({ status: 'loading', error: null });
    try {
      const { manifest: m, tiles, domain } = await source.load(bbox);
      if (mine !== seq) return;
      data.set({ status: 'ready', result: buildResult({ bbox, from, to, manifest: m, tiles, domain }), error: null });
    } catch (err) {
      if (mine !== seq || err?.kind === 'aborted') return;
      data.set({ status: 'error', error: err });
    }
  };

  window.addEventListener('online', () => { if (data.get().status === 'error') run(store.get()); });
  window.addEventListener('offline', () => { shownState = null; paintState(); });

  const render = (s) => {
    shell.update({ view: s.view, hasArea: s.bbox !== null, hero: appShell.heroModel(s, { presets, span, synthetic }) });
    paintState();
  };
  data.subscribe(() => render(store.get()));
  // Registered after the grids and the panel reset, so the selection lands on the painted result.
  data.subscribe(({ status: st, result }) => {
    if (st !== 'ready' || !pendingMonth) return;
    const want = pendingMonth;
    if (want.bbox.join() !== result.bbox.join()) return;
    pendingMonth = null;
    const cell = result.cells.find((c) => c.year === want.year && c.month === want.month);
    if (!cell) return;
    ctx.onSelect(cell);
    // Desktop keeps focus in the grid beside the docked panel, as a click on a cell does; the phone
    // sheet takes focus itself.
    if (!isPhone()) grid()?.focus();
  });
  // Home is the bare `#`: going there drops every parameter and closes whatever was open over the page.
  const hashOf = (s) => (s.bbox ? serializeHash(s) : '');
  const closeAll = () => {
    detail.close({ restore: false });
    drawer.close();
    areas.close({ restore: false });
    qb.close();
    map.ctl?.closeFull(true);
    document.querySelectorAll(':popover-open').forEach((p) => p.hidePopover());
  };
  let lastQuery = state;
  store.subscribe((s) => {
    if (s.bbox) { lastArea = s.bbox; lastName = s.name; }
    if (!s.bbox && lastQuery.bbox) closeAll();
    const next = hashOf(s);
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
  render(state);
  run(state);
  // overview.json is optional: without it the hero keeps its manual buttons and the picker says so.
  overviewReady.then((overview) => {
    places.overview = overview;
    places.status = overview ? 'ready' : 'missing';
    presets.push(...hotspotPresets(overview));
    stateView.update({ overview, overviewSettled: true });
    // The first screen updates in place, so its Radiant is not drawn twice; any other state is redrawn.
    if (!stateView.refresh()) shownState = null;
    render(store.get());
    areas.update();
  });
  return store;
};

if (typeof document !== 'undefined' && document.getElementById('app')) {
  start();
  registerSW({ onUpdate: offerUpdate });
}
