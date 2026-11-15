import { centerLabel, DATA_REGION_NAME, drawerModel, formatCount, hotspotAt, hotspotRowsLabels, mapModel, placeLabel, regionCaption, SENSOR_NAME, squareFor, UNAVAILABLE } from '../places.js';
import { cellLabel } from './calendar-grid.js';
import { hotspotRow, legendEl, mountHeatMap, pressRows, swatch } from './heat-map.js';
import { h } from './h.js';
import { icon, mark } from './icons.js';
import * as radiant from './radiant.js';
import { bboxText } from './states.js';

// The first screen's place flow (docs/ux.md, "First screen"): the heat map plate and a preview card
// whose Radiant follows the pick. A pick here is not written to the hash; it becomes the last chosen
// area, and "Open the calendar" commits it.

const TAGS = { suggested: 'Suggested', pick: 'Your pick', current: 'Current area' };
// Past this the previous Radiant dims under a "Loading the record" pill.
const SLOW_MS = 150;

/** The share of an element's height inside the viewport, 0 to 1. */
const visibleShare = (el) => {
  const r = el.getBoundingClientRect();
  if (!r.height) return 0;
  return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / r.height;
};

const is1deg = (b) => b[2] - b[0] === 1 && b[3] - b[1] === 1;

/**
 * What the preview card says about a subject. kind: 'suggested' (hotspot 1 before any pick), 'pick'
 * (a square or hotspot picked here), 'current' (the last area chosen, back on Home), 'example' (the
 * fixture area) or 'region' (the whole data region, without overview.json). Pure.
 */
export const previewModel = ({ kind, bbox = null, name = null, label = null, overview = null, model = null }) => {
  if (kind === 'pending') return { tag: null, note: null, heading: '', sub: null, value: null, zero: false, cta: false };
  if (kind === 'region') return { tag: null, note: null, heading: DATA_REGION_NAME, sub: null, value: null, zero: false, cta: false };
  const region = overview?.region?.name ?? null;
  const year = overview?.year ?? null;
  const hotspots = overview?.hotspots ?? [];
  const rank = hotspots.findIndex((x) => x.bbox.join() === bbox.join()) + 1;
  const hs = rank ? hotspots[rank - 1] : null;
  const q = squareFor(model, bbox);
  const p = hs?.place?.country ? hs.place : null;
  const note = {
    suggested: `Hottest 1° area in ${region ?? 'the data'}, ${year}`,
    pick: rank ? `Hotspot #${rank} in ${region ?? 'the data'}` : '1° area on the map',
  }[kind] ?? null;
  let heading;
  let sub;
  if (p) {
    heading = p.state ?? p.country;
    sub = `${centerLabel(bbox)} · ${p.country}`;
  } else if (is1deg(bbox) && !name) {
    heading = centerLabel(bbox);
    sub = [region, '1° square, about 110 km across'].filter(Boolean).join(' · ');
  } else {
    heading = name ?? label ?? bboxText(bbox);
    sub = name || label ? bboxText(bbox) : region;
  }
  return {
    tag: TAGS[kind] ?? null,
    note,
    heading,
    sub: sub || null,
    value: q && year ? { n: q.value, bin: q.bin, year, sensor: SENSOR_NAME[overview.sensor] ?? overview.sensor } : null,
    zero: q?.value === 0,
    cta: true,
  };
};

/** The caption under the preview Radiant, from the record's years in the manifest. */
export const previewCaption = (m, { manifest, overview = null, kind, synthetic = false }) => {
  const [first, last] = [manifest.month0, manifest.last_month].map((x) => Number(x.slice(0, 4)));
  const base = kind === 'region'
    ? regionCaption(first, last)
    : m.zero
      ? `No fire detected here in ${overview.year}. Earlier years still show in the rings.`
      : `${first}–${last}. Rings are years, newest outside; slices are months.`;
  return `${base} Pick a month to open it in the calendar.${synthetic ? ' Synthetic data.' : ''}`;
};

/** False when no month of the record has a value: every sensor was off there (null), so there is nothing to draw. */
export const hasRecord = (cells = []) => cells.some((c) => c.value != null);

export const NO_RECORD = 'No record for this area in the data.';

/** The hero Radiant's accessible name, before and after its data. */
export const heroRadiantLabel = (label) => (label
  ? `Fire calendar of ${label}: rings are years, slices are months. Arrow keys move between months, Enter opens the month in the calendar.`
  : 'Fire calendar overview, loading.');

/** The phone selection bar's second line: "1,167 in 2025 · Radiant updated above". */
export const selectionLine = (m) => (m.value ? `${formatCount(m.value.n)} in ${m.value.year} · Radiant updated above` : 'Radiant updated above');

/**
 * The preview card. deps: {manifest, synthetic, loadExample(preset), onOpen(subject), onPickMonth(subject, cell)}.
 * Returns {el, show(subject, overview, model), isOpenable()}. A subject is {kind, bbox, name}.
 */
const previewCard = (deps) => {
  const tag = h('span', { class: 'pv-tag', hidden: true });
  const note = h('span', { class: 'pv-note' });
  const title = h('h2', { id: 'preview-title', class: 'pv-title' });
  const sub = h('p', { class: 'pv-sub' });
  const value = h('p', { class: 'pv-value' });
  const art = h('figure', { class: 'hero-art' });
  const host = h('div', { class: 'radiant-hero' });
  const pill = h('p', { class: 'pv-loading', hidden: true }, h('span', { class: 'pv-spin', 'aria-hidden': 'true' }), 'Loading the record…');
  const error = h('div', { class: 'pv-error', role: 'alert', hidden: true },
    h('p', { class: 'pv-error-title', text: "Couldn't load this area's record." }),
    h('p', { text: 'Check your connection and try again. The map still works.' }),
    h('button', { type: 'button', class: 'btn', onclick: () => load(current) }, icon('refresh'), 'Try again'));
  const empty = h('p', { class: 'pv-empty', hidden: true, text: NO_RECORD });
  const cap = h('figcaption');
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const cta = h('button', { type: 'button', class: 'btn btn-primary btn-lg pv-cta', hidden: true, onclick: () => deps.onOpen?.(current) },
    h('span', { text: 'Open the calendar' }), icon('arrow'));
  const el = h('section', { class: 'card preview-card', 'aria-labelledby': 'preview-title' },
    h('div', { class: 'pv-tagrow' }, tag, note), title, sub, value, art, cta, live);

  let rad = null;
  if (deps.manifest?.month0 && deps.manifest?.last_month) {
    art.append(host, pill, error, empty, cap);
    rad = radiant.mount(host, {
      cells: radiant.placeholderCells({ from: deps.manifest.month0, to: deps.manifest.last_month }),
      placeholder: true, labels: 'abbr', keyboard: { label: heroRadiantLabel(null), sliceLabel: () => '' },
    });
  } else {
    art.append(mark('mark hero-mark'));
  }

  let current = null;
  let loaded = null;
  let seq = 0;
  let ready = false;
  let shown = false;
  const load = (subject) => {
    if (!rad || !subject) return;
    const mine = ++seq;
    ready = false;
    cta.disabled = true;
    error.hidden = true;
    empty.hidden = true;
    cap.hidden = false;
    host.hidden = false;
    art.setAttribute('aria-busy', 'true');
    // The first load has the placeholder to say it is loading; later picks dim the previous Radiant.
    const slow = setTimeout(() => { if (mine === seq && shown) { pill.hidden = false; art.classList.add('is-dim'); } }, SLOW_MS);
    const done = () => { clearTimeout(slow); pill.hidden = true; art.classList.remove('is-dim'); art.removeAttribute('aria-busy'); };
    Promise.resolve(subject.bbox ? subject : deps.dataRegion?.().then((bbox) => (bbox ? { ...subject, bbox, name: DATA_REGION_NAME } : null)))
      .then((s) => {
        if (!s) throw new Error('no region');
        return deps.loadExample?.({ id: s.id ?? 'preview', label: current.label, bbox: s.bbox }).then((r) => ({ r, s }));
      })
      .then(({ r, s } = {}) => {
        if (mine !== seq || !r || !el.isConnected) return;
        done();
        ready = true;
        if (!hasRecord(r.cells)) {
          host.hidden = true;
          cap.hidden = true;
          empty.hidden = false;
          live.textContent = `Preview: ${current.label}. ${NO_RECORD}`;
          return;
        }
        shown = true;
        cta.disabled = false;
        rad.reveal({
          cells: r.cells, aoiCells: r.aoiCells, placeholder: false,
          keyboard: { label: heroRadiantLabel(current.label), sliceLabel: (c) => cellLabel(c, r.aoiCells) },
          onSelect: (cell) => deps.onPickMonth?.(s, cell),
        });
      })
      .catch(() => {
        if (mine !== seq) return;
        done();
        if (subject.kind === 'region') return; // decoration: the placeholder stays
        error.hidden = false;
        host.hidden = true;
      });
  };

  const show = (subject, overview, model) => {
    const m = previewModel({ ...subject, overview, model });
    current = { ...subject, label: m.heading };
    tag.hidden = !m.tag;
    tag.textContent = m.tag ?? '';
    tag.className = `pv-tag is-${subject.kind}`;
    note.textContent = m.note ?? '';
    title.textContent = m.heading;
    sub.textContent = m.sub ?? '';
    value.replaceChildren(...(m.value
      ? [swatch(m.value.bin), h('b', { text: formatCount(m.value.n) }), ` fire-cell-days in ${m.value.year}`, h('span', { class: 'pv-chip', text: m.value.sensor })]
      : []));
    const pending = subject.kind === 'pending';
    cap.textContent = rad && !pending ? previewCaption(m, { manifest: deps.manifest, overview, kind: subject.kind, synthetic: deps.synthetic }) : '';
    cta.hidden = !m.cta;
    if (pending) return m;
    // The same subject again (overview.json arriving after it was shown) keeps the Radiant it has.
    const same = loaded && loaded.kind === subject.kind && String(loaded.bbox) === String(subject.bbox);
    loaded = subject;
    if (rad) live.textContent = `Preview: ${m.heading}, ${deps.manifest.month0.slice(0, 4)}–${deps.manifest.last_month.slice(0, 4)}.`;
    if (!same) load(current);
    return m;
  };

  return { el, show, isReady: () => ready };
};

/** The pending card: the placeholder Radiant and empty lines until overview.json settles. */
const pendingSubject = { kind: 'pending' };

/**
 * The heat map plate of the first screen: title and unit, the map with its legend, the top three
 * hotspots and the manual path. deps: {onPick(q), onDraw(btn), onCoords(btn)}.
 * Returns {el, select(bbox), reveal(q), setArea(bbox), start(), stop()}.
 */
const plateEl = (overview, model, deps, focus) => {
  const m = drawerModel(overview);
  const map = mountHeatMap(model, overview, { focus, onPick: (q) => deps.onPick(q) });
  const rowLabels = hotspotRowsLabels(overview.hotspots ?? []);
  const rows = (overview.hotspots ?? []).slice(0, 3).map((hs, i) => {
    const q = squareFor(model, hs.bbox) ?? { key: hs.bbox.join(), bbox: hs.bbox, value: hs.value, bin: 6 };
    return hotspotRow({ hs, rank: i + 1, q, labels: rowLabels[i], overview, sub: m.rowSub, onClick: () => { deps.onPick(q); map.reveal(q); } });
  });
  const region = overview.region?.name ?? null;
  const list = rows.length
    ? h('ol', { class: 'ad-rows hp-rows' }, rows.map((r) => h('li', {}, r)))
    : h('p', { class: 'hp-none', text: `No fire detected in ${region ?? 'the data'} in ${overview.year}.` });
  const el = h('section', { class: 'plate hero-plate', 'aria-labelledby': 'plate-title' },
    h('div', { class: 'hp-head' }, h('h2', { id: 'plate-title', text: `Where it burned in ${overview.year}` }), h('p', { class: 'hp-unit', text: m.unit })),
    h('div', { class: 'hp-body' },
      h('div', { class: 'hp-map' }, ...map.nodes, legendEl()),
      h('div', { class: 'hp-side' },
        h('h3', { class: 'hp-list-title', text: `${m.listTitle}, ${overview.year}` }),
        h('p', { class: 'hp-list-sub', text: m.listSub }),
        list,
        manualEl(deps, 'hp-manual'))),
    m.border ? h('p', { class: 'plate-note', text: m.border }) : null);
  return {
    el,
    select: (q, bbox) => { map.select(q); pressRows(rows, bbox); map.setArea(q ? null : bbox); },
    reveal: map.reveal,
    start: map.start,
    stop: map.stop,
  };
};

const manualEl = (deps, cls) => h('div', { class: cls },
  h('p', { class: 'hp-or', text: 'Or set it yourself' }),
  h('div', { class: 'cta' },
    h('button', { type: 'button', class: 'btn btn-primary', onclick: (ev) => deps.onDraw?.(ev.currentTarget) }, icon('drawArea'), 'Draw an area'),
    h('button', { type: 'button', class: 'btn', onclick: (ev) => deps.onCoords?.(ev.currentTarget) }, icon('crosshair'), 'Enter coordinates')));

const missingEl = (deps) => h('section', { class: 'hp-missing' },
  h('p', { class: 'hp-missing-title', text: UNAVAILABLE.split('. ')[0].concat('.') }),
  h('p', { text: UNAVAILABLE.split('. ').slice(1).join('. ') }),
  h('div', { class: 'cta' },
    h('button', { type: 'button', class: 'btn btn-primary', onclick: (ev) => deps.onDraw?.(ev.currentTarget) }, icon('drawArea'), 'Draw an area on the map'),
    h('button', { type: 'button', class: 'btn', onclick: (ev) => deps.onCoords?.(ev.currentTarget) }, icon('crosshair'), 'Enter coordinates')));

const skeletonEl = () => h('div', { class: 'plate hero-plate hp-skeleton', 'aria-hidden': 'true' },
  h('span', { class: 'hp-sk-title' }), h('span', { class: 'hp-sk-map' }), h('span', { class: 'hp-sk-row' }), h('span', { class: 'hp-sk-row' }));

/**
 * The first screen's place flow. deps: {manifest, synthetic, overview, overviewSettled, presets,
 * currentArea() ({bbox, name} or null), loadExample, dataRegion(), onPreview({bbox, name}), onOpen({bbox, name}),
 * onPickMonth({bbox, name}, cell), onDraw(btn), onCoords(btn)}.
 * Returns {preview, plate, bar, refresh(), destroy()}: preview and plate are the two grid items, bar the
 * phone selection bar; refresh() is for overview.json settling while the screen is shown.
 */
export const mountHeroPlace = (deps) => {
  const card = previewCard({ ...deps, onOpen: (s) => deps.onOpen?.(nameOf(s)), onPickMonth: (s, cell) => deps.onPickMonth?.(nameOf(s), cell) });
  const plateSlot = h('div', { class: 'hp-slot' }, skeletonEl());
  const barText = h('button', { type: 'button', class: 'sb-text', onclick: () => card.el.scrollIntoView({ block: 'center' }) });
  const bar = h('div', { class: 'sel-bar', role: 'status', hidden: true }, barText,
    h('button', { type: 'button', class: 'btn btn-primary sb-open', text: 'Open', onclick: () => deps.onOpen?.(nameOf(subject)) }));
  let overview = null;
  let model = null;
  let plate = null;
  let subject = null;
  let settled = false;

  const nameOf = (s) => ({ bbox: s.bbox, name: s.name ?? placeLabel(hotspotAt(overview, s.bbox)) ?? (is1deg(s.bbox) ? centerLabel(s.bbox) : null) });

  const setSubject = (s, { fromPick = false } = {}) => {
    subject = s;
    const m = card.show(s, overview, model);
    if (plate && s.bbox) plate.select(squareFor(model, s.bbox), s.bbox);
    if (fromPick) {
      deps.onPreview?.(nameOf(s));
      barText.replaceChildren(...(m.value ? [swatch(m.value.bin)] : []), h('span', {}, h('b', { text: m.heading }), h('small', { text: selectionLine(m) })));
      bar.hidden = visibleShare(card.el) >= 0.5;
    }
  };

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([e]) => { if (e.intersectionRatio >= 0.5) bar.hidden = true; }, { threshold: [0, 0.5, 1] })
    : null;
  io?.observe(card.el);

  const initial = () => {
    const cur = deps.currentArea?.();
    if (cur?.bbox) return { kind: 'current', bbox: cur.bbox, name: cur.name ?? null };
    if (overview?.hotspots?.length) return { kind: 'suggested', bbox: overview.hotspots[0].bbox, name: null };
    const ex = deps.presets?.[0];
    if (ex) return { kind: 'example', bbox: ex.bbox, name: ex.name ?? null, label: ex.label };
    return settled ? { kind: 'region', bbox: null } : null;
  };

  const resolve = () => {
    settled = Boolean(deps.overviewSettled);
    overview = deps.overview ?? null;
    if (!settled && !overview) {
      const s = initial();
      if (s) setSubject(s);
      else card.show(pendingSubject, null, null);
      return;
    }
    model = overview ? mapModel(overview) : null;
    plate?.stop();
    plate = null;
    if (model) {
      const s = initial();
      plate = plateEl(overview, model, { ...deps, onPick: (q) => setSubject({ kind: 'pick', bbox: q.bbox, name: null }, { fromPick: true }) }, squareFor(model, s?.bbox ?? []));
      plateSlot.replaceChildren(plate.el);
      plate.start();
      setSubject(s);
    } else {
      plateSlot.replaceChildren(missingEl(deps));
      const s = initial();
      if (s) setSubject(s);
    }
  };

  resolve();
  return {
    preview: card.el,
    plate: plateSlot,
    bar,
    refresh: resolve,
    destroy: () => { plate?.stop(); io?.disconnect(); },
  };
};
