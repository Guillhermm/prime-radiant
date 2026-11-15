import { DATA_REGION_NAME, regionCaption, sensorValueLine, suggestionCaption } from '../places.js';
import { cellLabel } from './calendar-grid.js';
import { MONTH_ABBR } from '../format.js';
import { binClass, NODATA } from '../bins.js';
import { h } from './h.js';
import { icon, mark } from './icons.js';
import * as radiant from './radiant.js';

export const LIVE_STALE_HOURS = 48;

/** Live is unavailable when the last fetch is missing or older than 48 h (docs/ux.md section 6). */
export const liveStatus = (fetchedAt, now = new Date()) => {
  if (!fetchedAt) return { available: false, text: 'Live data unavailable.' };
  const ageHours = (now - new Date(fetchedAt)) / 3.6e6;
  if (Number.isNaN(ageHours) || ageHours > LIVE_STALE_HOURS) return { available: false, text: `Live data unavailable. Last update ${fetchedAt}` };
  return { available: true, text: `Live data, updated ${fetchedAt}` };
};

// The region's name comes from overview.json; without it the copy says "the data domain".
const domainName = (region) => (region ? `${region}, the data domain` : 'the data domain');

export const outsideExport = (region = null) => `Nothing to export: this area lies outside ${domainName(region)}.`;

export const outsideLine = (region = null) => `This area lies outside ${region ?? 'the data domain'}, the only region the data covers. There is no data here: no counts, not zeros.`;
const drawInside = (region) => `Draw an area in ${region ?? 'the data domain'}`;

/** One line for an area partly outside the domain; null when it is wholly inside or there is no domain. */
export const domainNote = (domain, region = null) => {
  if (!domain?.partial) return null;
  const pct = Math.round((domain.inside / domain.cells) * 100);
  return `Part of this area lies outside ${domainName(region)}: counts cover the ${pct}% inside it.`;
};

export const EMPTY_TITLE = ['When does this place ', 'burn?'];
export const EMPTY_LEAD = 'Pick an area and see every month of satellite fire detections since 2000 in one calendar: when the season peaks, which years were worst, and how this month compares.';

/**
 * State model. kinds: empty, zero, outside, loading, error, live-unavailable.
 * `error` takes {what, hint}; `live-unavailable` takes {fetchedAt, now}.
 */
export const stateModel = (state, { presets = [], region = null } = {}) => {
  switch (state.kind) {
    case 'empty':
      return { kind: 'empty', role: null, busy: false, title: EMPTY_TITLE.join(''), lines: [EMPTY_LEAD], chips: presets.slice(0, 3).map((p) => ({ id: p.id, label: p.label })), action: null };
    case 'zero':
      return { kind: 'zero', role: 'status', busy: false, lines: ['0 fire-cell-days in range.', 'No hotspots detected, sensors were operating.'], chips: [], action: null };
    case 'outside':
      return {
        kind: 'outside', role: 'status', busy: false, title: 'Outside the data domain', lines: [outsideLine(region), `${drawInside(region)}, or open an example.`],
        chips: presets.slice(0, 3).map((p) => ({ id: p.id, label: p.label })), action: { id: 'draw', label: drawInside(region) },
      };
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
export const screenState = ({ hasArea, status, cells = [], outside = false }) => {
  if (!hasArea) return { kind: 'empty', results: false };
  if (status === 'loading') return { kind: 'loading', results: false };
  if (status === 'error') return { kind: 'error', results: false };
  // Outside the domain every value is null by design: the state says so instead of a grid of "No data".
  if (status === 'ready' && outside) return { kind: 'outside', results: false };
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

/**
 * What the first-run Radiant shows: the suggestion (hotspot 1) when overview.json loaded, else the
 * first example area (fixture mode), else, once overview.json is known to be missing, the whole data
 * region; 'pending' while overview.json is still on its way. Null without a manifest: the brand mark.
 */
export const heroPlan = ({ presets = [], overview = null, overviewSettled = false, manifest = null } = {}) => {
  if (!manifest?.month0 || !manifest?.last_month) return null;
  const suggested = overview ? presets.find((p) => p.rank === 1) : null;
  if (suggested) return { kind: 'suggested', preset: suggested };
  if (presets[0]) return { kind: 'example', preset: presets[0] };
  return { kind: overviewSettled ? 'region' : 'pending' };
};

/**
 * Caption for the hero Radiant. It needs only the record's years, from the manifest, so it is set
 * with the placeholder and the figure never changes height when the data arrives. Empty while pending.
 */
export const heroCaption = (plan, { manifest, overview = null, synthetic = false } = {}) => {
  if (plan.kind === 'pending') return '';
  const preset = plan.preset;
  const [first, last] = [manifest.month0, manifest.last_month].map((m) => Number(m.slice(0, 4)));
  const text = {
    suggested: () => suggestionCaption(overview),
    example: () => `${preset.label}, ${first}–${last}, as a Radiant: rings are years, slices are months.`,
    region: () => regionCaption(first, last),
  }[plan.kind]();
  return `${text} Pick a month to open it in the calendar.${synthetic ? ' Synthetic data.' : ''}`;
};

/** The hero Radiant's accessible name, before and after its data. */
export const heroRadiantLabel = (preset) => (preset
  ? `Fire calendar of ${preset.label}: rings are years, slices are months. Arrow keys move between months, Enter opens the month in the calendar.`
  : 'Fire calendar overview, loading.');

// Draws the Radiant at once in the placeholder color, on the record's months from the manifest, then
// swaps in the subject's data on the same slices so the colors fade in place: no layout shift.
// Returns {resolve(plan)} for a 'pending' plan that learns its subject once overview.json settles.
const heroRadiant = (art, firstPlan, deps, isLive) => {
  const host = h('div', { class: 'radiant-hero' });
  const cap = h('figcaption');
  art.append(host, cap);
  const keyboard = { label: heroRadiantLabel(null), sliceLabel: () => '' };
  const rad = radiant.mount(host, {
    cells: radiant.placeholderCells({ from: deps.manifest.month0, to: deps.manifest.last_month }),
    placeholder: true, labels: 'abbr', keyboard,
  });
  let started = false;
  const resolve = (plan) => {
    if (started || plan.kind === 'pending') return;
    started = true;
    cap.textContent = heroCaption(plan, deps);
    const subject = plan.kind === 'region'
      ? Promise.resolve(deps.dataRegion?.()).then((bbox) => (bbox ? { id: 'data-region', label: DATA_REGION_NAME, name: DATA_REGION_NAME, bbox } : null))
      : Promise.resolve(plan.preset);
    // The Radiant is decoration until its data arrives: a failed load leaves the placeholder.
    subject.then((preset) => {
      if (!preset) return;
      return deps.loadExample?.(preset).then((r) => {
        if (!r || !isLive()) return;
        rad.reveal({
          cells: r.cells, aoiCells: r.aoiCells, placeholder: false,
          keyboard: { label: heroRadiantLabel(preset), sliceLabel: (c) => cellLabel(c, r.aoiCells) },
          onSelect: (cell) => deps.onPickMonth?.(preset, cell),
        });
      });
    }).catch(() => {});
  };
  resolve(firstPlan);
  return { resolve };
};

// Three examples at most: the ranked hotspots come after the fixture area in fixture mode. Null without any.
const examplesSection = (deps, isLive) => {
  const cards = (deps.presets ?? []).slice(0, 3).map((p) => {
    const ribbon = h('div', { class: 'ribbon', 'aria-hidden': 'true' }, Array.from({ length: 12 }, () => h('i', { class: 'is-loading' })));
    const foot = h('p', { class: 'ex-foot' });
    const card = h('button', { type: 'button', class: 'ex chip-example', 'data-preset': p.id, onclick: () => deps.onPick?.(p.id) },
      h('span', { class: 'ex-t' }, h('span', { text: p.label }), icon('arrow')),
      h('span', { class: 'ex-c mono', text: bboxText(p.bbox) }),
      typeof p.value === 'number' && deps.overview ? h('span', { class: 'ex-v', text: sensorValueLine(p.value, deps.overview) }) : null,
      ribbon,
      h('span', { class: 'ribbon-l', 'aria-hidden': 'true' }, MONTH_ABBR.map((x) => h('span', { text: x[0] }))),
      foot);
    return { p, card, ribbon, foot };
  });
  if (!cards.length) return null;
  // Example data is decoration: a failed load leaves the cards usable without their ribbons.
  cards.forEach(({ p, ribbon, foot }) => {
    deps.loadExample?.(p).then((r) => {
      if (!r || !isLive()) return;
      ribbon.replaceChildren(...ribbonModel(r.typical, r.aoiCells).map((x) => h('i', { class: `bin-${x.bin}` })));
      const span = typicalSpan(r.typical);
      foot.textContent = span ? `Typical year, median ${span} · Preview` : 'Not enough history for a typical year';
    }).catch(() => {});
  });
  return h('section', { class: 'examples', 'aria-labelledby': 'examples-title' },
    h('h2', { id: 'examples-title', class: 'eyebrow', text: 'Or open an example' }),
    h('div', { class: 'ex-grid' }, cards.map((c) => c.card)));
};

/**
 * The first screen. Returns {view, refresh()}: refresh() is for overview.json settling while the view
 * is shown. The hero keeps its Radiant (no remount, so no replayed entrance and no shift) and only
 * learns its subject; the examples join below it.
 */
const emptyView = (m, deps) => {
  const art = h('figure', { class: 'hero-art' });
  const plan = heroPlan(deps);
  if (!plan) art.append(mark('mark hero-mark'));
  let view = null;
  const isLive = () => Boolean(view?.isConnected);
  view = h('div', { class: 'first-run' },
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
    examplesSection(deps, isLive));
  const hero = plan ? heroRadiant(art, plan, deps, isLive) : null;
  const refresh = () => {
    hero?.resolve(heroPlan(deps));
    if (!view.querySelector('.examples')) {
      const ex = examplesSection(deps, isLive);
      if (ex) view.append(ex);
    }
  };
  return { view, refresh };
};

/**
 * mount(container, {presets, overview, overviewSettled, manifest, synthetic, onPick(id), onPickMonth(preset, cell),
 * onRetry(), onDraw(btn), onCoords(btn), loadExample(preset), dataRegion()}). dataRegion() resolves to
 * the bbox of the whole data region, for the hero Radiant when overview.json is missing. presets and overview are read at each show(). Returns {show(state), clear(), refresh(), update(next), destroy()}.
 * The loading skeleton sets aria-busy on the container; any other state clears it.
 */
export const mount = (container, deps = {}) => {
  let empty = null;
  const show = (state) => {
    const m = stateModel(state, { presets: deps.presets, region: deps.overview?.region?.name ?? null });
    container.setAttribute('aria-busy', String(m.busy));
    if (m.kind === 'empty') { empty = emptyView(m, deps); container.replaceChildren(empty.view); return; }
    const nodes = [];
    if (m.title) nodes.push(h('h2', { class: 'state-title', text: m.title }));
    m.lines.forEach((t, i) => nodes.push(h('p', { class: i === 0 ? `state-line state-${m.kind}` : 'hint', text: t })));
    if (m.kind === 'loading') nodes.push(skeleton());
    if (m.action) {
      const run = m.action.id === 'draw' ? (ev) => deps.onDraw?.(ev.currentTarget) : () => deps.onRetry?.();
      nodes.push(h('button', { type: 'button', class: 'btn btn-primary state-action', onclick: run }, m.action.id === 'draw' ? icon('drawArea') : null, m.action.label));
    }
    if (m.chips.length) {
      nodes.push(h('div', { class: 'state-chips', role: 'group', 'aria-label': 'Examples' },
        m.chips.map((c) => h('button', { type: 'button', class: 'chip state-chip', 'data-preset': c.id, text: c.label, onclick: () => deps.onPick?.(c.id) }))));
    }
    const card = m.kind === 'outside' ? ' card state-card' : '';
    container.replaceChildren(h('div', { class: `state state-box-${m.kind}${card}`, role: m.role }, nodes));
  };
  const clear = () => { container.removeAttribute('aria-busy'); container.replaceChildren(); };
  /** Brings the first screen up to date in place (overview.json settled); false when it is not shown. */
  const refresh = () => {
    if (!empty?.view.isConnected) return false;
    empty.refresh();
    return true;
  };
  return { show, clear, refresh, destroy: clear, update: (next) => Object.assign(deps, next) };
};
