import { VIEWS } from './views.js';
import { createStore, parseHash, serializeHash } from './state.js';
import { findPreset } from './presets.js';
import * as appShell from './components/app-shell.js';
import * as queryBar from './components/query-bar.js';
import { mountPresets } from './components/aoi-form.js';
import { spanFromManifest } from './components/date-range.js';
import { h } from './components/h.js';
import * as legend from './components/legend.js';
import * as exportMenu from './components/export-menu.js';

// Mount slots. Each is a no-op until its owner replaces it (task in the comment). They all
// receive the slot element and { store, slots }, and may return nothing.
const noop = () => {};
export const MOUNTS = {
  method: noop, // M1-G9: Method button
  // The CSV item reports "nothing to export" until M1-G5 provides the series on screen.
  export: (el) => exportMenu.mount(el, { getSeries: () => null, getLink: () => location.href }),
  caveat: noop, // M1-G9: caveat strip
  kpi: noop, // M1-G8 built; mounts once M1-G5 loads the cells
  calendar: noop, // M1-G6 built; mounts once M1-G5 loads the cells
  legend: (el) => legend.mount(el),
  table: noop, // M1-G10: the calendar's own table toggle uses data-table
  detail: noop, // M1-G6: cell detail panel / bottom sheet
  drawer: noop, // M1-G9: Method drawer
  map: noop, // M1-G3: map picker
  sensors: noop, // M1-K10: Sensors view
};

const loadSpan = async (fixtures) => {
  try {
    const res = await fetch(fixtures ? '../fixtures/manifest.json' : '../data/manifest.json');
    return res.ok ? spanFromManifest(await res.json()) : null;
  } catch {
    return null;
  }
};

export const start = async (root = document.getElementById('app')) => {
  const fixtures = new URLSearchParams(location.search).get('fixtures') === '1';
  const span = await loadSpan(fixtures);
  const { state, errors } = parseHash(location.hash, { span });
  const store = createStore(state);

  const shell = appShell.mount(root, {
    views: VIEWS,
    activeView: state.view,
    onView: (view) => store.set({ view }),
  });
  const { slots } = shell;

  const status = h('p', { class: 'status', role: 'status' });
  slots.query.append(status);
  const showErrors = (list) => {
    status.textContent = list.length ? `Ignored from the link: ${list.map((e) => `${e.field} (${e.reason})`).join('; ')}` : '';
  };
  showErrors(errors);
  queryBar.mount(slots.query, { store, views: VIEWS, span });

  slots.empty.append(
    h('p', {}, 'Choose an area to see its fire history.'),
    h('p', { class: 'hint' }, 'Example areas (placeholder values):'));
  mountPresets(slots.empty, {
    onPick: (p) => store.set({ bbox: findPreset(p.id).bbox, from: store.get().from ?? span?.from ?? null, to: store.get().to ?? span?.to ?? null }),
  });

  for (const [name, mountFn] of Object.entries(MOUNTS)) mountFn(slots[name], { store, slots, span });

  const render = (s) => shell.update({ view: s.view, hasArea: s.bbox !== null });
  store.subscribe((s) => {
    const next = serializeHash(s);
    if (location.hash !== next) location.hash = next;
    render(s);
  });
  window.addEventListener('hashchange', () => {
    const parsed = parseHash(location.hash, { span });
    showErrors(parsed.errors);
    store.set(parsed.state);
  });
  if (!location.hash) history.replaceState(null, '', serializeHash(state));
  render(state);
  return store;
};

if (typeof document !== 'undefined' && document.getElementById('app')) start();
