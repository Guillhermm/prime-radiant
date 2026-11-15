import { centerLabel, countryWindow, exactScope, matchScope, scopeOptions, dotPins, formatCount, HEAT_LABELS, hotspotRowsLabels, inWindow, isZoomable, listRanks, nearestSquare, regionalWindow, REGIONAL_WIDTH, regionCountry, sameBbox, scopeList, squareFits, squareFor, squareText, stepSquare, valueLine, worldWindow, ZOOM_ASPECT, zoomWindow } from '../places.js';
import { bboxText } from './states.js';
import { comboKey } from './name-field.js';
import { h } from './h.js';
import { icon, svgEl } from './icons.js';

// SVG units per degree; the SVG scales to its box, so this only sets the stroke and pin proportions.
const U = 10;

export const swatch = (bin) => h('i', { class: `hm-sw hm-b${bin}`, 'aria-hidden': 'true' });

// CSS px per SVG unit the rings and pins were drawn at (Brazil filling a 22rem map); a zoomable map
// scales them by its own units per px so they keep that size on screen at every zoom.
const DRAWN_PX_PER_UNIT = 1.1;
// Two numbered pins closer than this on screen would overlap; the lower rank becomes a dot.
const PIN_GAP_PX = 22;
// The pick and focus rings never draw smaller than this on screen, so a square of a few px in the
// world view still shows as one visible ring.
const MIN_RING_PX = 14;

// The click's pointer: touch and pen are coarse; a click without one (keyboard, synthetic) follows the device.
const pointerOf = (ev) => (ev?.pointerType === 'touch' || ev?.pointerType === 'pen' ? 'coarse'
  : ev?.pointerType === 'mouse' ? 'fine'
    : globalThis.matchMedia?.('(pointer: fine)').matches ? 'fine' : 'coarse');

/**
 * The heat map: squares, rank pins and the rings for selection, focus and hover, moved by `place`.
 * `setView(win)` shows a window in degrees (null: the whole map, or `world` when given) and
 * `setScale(k, pxPerUnit)` resizes the rings and pins by k and turns crowded pins into dots.
 */
const mapSvg = (model, world = null, maxPins = Infinity) => {
  const W = (model.east - model.west) * U;
  const H = (model.north - model.south) * U;
  const box = world ? { width: 1000 * ZOOM_ASPECT, height: 1000 } : { width: W, height: H };
  const x = (q) => (q.w - model.west) * U;
  const y = (q) => (model.north - q.s - 1) * U;
  const svg = svgEl('svg', { class: 'hm', viewBox: `0 0 ${W} ${H}`, width: box.width, height: box.height, 'aria-hidden': 'true', focusable: 'false' });
  const squares = svgEl('g', { class: 'hm-squares' });
  for (const q of model.squares) {
    squares.append(svgEl('rect', { x: x(q) + 0.5, y: y(q) + 0.5, width: U - 1, height: U - 1, rx: 1.8, class: `hm-sq hm-b${q.bin}`, 'data-key': q.key }));
  }
  const ring = (cls, pad, stroke, dash = null) => ({ el: svgEl('rect', { class: cls, hidden: '' }), pad, stroke, dash });
  const rings = {
    sel: [ring('hm-ring hm-sel-in', 1.6, 2.6), ring('hm-ring hm-sel-out', 4.6, 2.2)],
    focus: [ring('hm-ring hm-focus-in', 1.6, 2.6), ring('hm-ring hm-focus-out', 4.6, 2.2)],
    hover: [ring('hm-ring hm-hover', 1.3, 1.6, [3, 2])],
  };
  const at = { sel: null, focus: null, hover: null };
  let k = 1;
  let unitPx = 0;
  const pins = svgEl('g', { class: 'hm-pins' });
  let pinEls = [];
  // The overview's hotspots pile up on one continent at world level, so they hide there; a country's few pins stay.
  let worldPins = false;
  const setPins = (ranks, { atWorld = false } = {}) => {
    worldPins = atWorld;
    pinEls = [];
    for (const [key, rank] of ranks) {
      const q = model.byKey.get(key);
      if (!q || rank > maxPins) continue;
      const cx = x(q) + U - 0.5;
      const cy = y(q) + 0.5;
      const t = svgEl('text', { x: cx, y: cy + 3 });
      t.textContent = String(rank);
      const pin = svgEl('g', { class: 'hm-pin' });
      const circle = svgEl('circle', { cx, cy, r: 7 });
      pin.append(circle, t);
      pinEls.push({ pin, circle, cx, cy, rank });
    }
    pins.replaceChildren(...pinEls.map((p) => p.pin));
  };
  setPins(model.ranks);
  // A custom area (drawn, or from a link) is a blue rectangle over its box instead of a square ring.
  const areaEl = svgEl('rect', { class: 'hm-ring hm-area', hidden: '' });
  let area = null;
  const placeArea = () => {
    if (!area) { areaEl.setAttribute('hidden', ''); return; }
    const [w, so, e, n] = area;
    areaEl.setAttribute('x', (w - model.west) * U);
    areaEl.setAttribute('y', (model.north - n) * U);
    areaEl.setAttribute('width', (e - w) * U);
    areaEl.setAttribute('height', (n - so) * U);
    areaEl.setAttribute('stroke-width', 2.2 * k);
    areaEl.removeAttribute('hidden');
  };
  const setArea = (bbox) => { area = bbox; placeArea(); };
  svg.append(squares, areaEl, ...rings.hover.map((r) => r.el), ...rings.sel.map((r) => r.el), ...rings.focus.map((r) => r.el), pins);
  const place = (which, q) => {
    at[which] = q;
    const outer = Math.max(...rings[which].map((r) => r.pad)) * k;
    const grow = unitPx ? Math.max(0, MIN_RING_PX / unitPx - (U + 2 * outer)) / 2 : 0;
    rings[which].forEach(({ el, pad, stroke, dash }) => {
      if (!q) { el.setAttribute('hidden', ''); return; }
      const p = pad * k + (which === 'hover' ? 0 : grow);
      el.setAttribute('x', x(q) - p);
      el.setAttribute('y', y(q) - p);
      el.setAttribute('width', U + 2 * p);
      el.setAttribute('height', U + 2 * p);
      el.setAttribute('rx', 3 * k);
      el.setAttribute('stroke-width', stroke * k);
      if (dash) el.setAttribute('stroke-dasharray', dash.map((d) => d * k).join(' '));
      el.removeAttribute('hidden');
    });
  };
  const setScale = (next, pxPerUnit) => {
    k = next;
    unitPx = pxPerUnit;
    const vb = svg.viewBox.baseVal;
    const shown = pinEls.filter(({ cx, cy }) => cx >= vb.x && cx <= vb.x + vb.width && cy >= vb.y && cy <= vb.y + vb.height);
    const dots = dotPins(shown.map((p) => ({ rank: p.rank, x: p.cx * pxPerUnit, y: p.cy * pxPerUnit })), PIN_GAP_PX);
    for (const { pin, circle, cx, cy, rank } of pinEls) {
      if (k === 1) pin.removeAttribute('transform');
      else pin.setAttribute('transform', `translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`);
      pin.classList.toggle('is-dot', dots.has(rank));
      circle.setAttribute('r', dots.has(rank) ? 3 : 7);
    }
    for (const which of Object.keys(at)) place(which, at[which]);
    placeArea();
  };
  const setView = (win) => {
    const v = win ?? world;
      pins.toggleAttribute('hidden', Boolean(world) && !win && !worldPins);
    svg.setAttribute('viewBox', v ? `${(v.west - model.west) * U} ${(model.north - v.north) * U} ${v.width * U} ${v.height * U}` : `0 0 ${W} ${H}`);
  };
  /** [lon, lat] under a client point. */
  const degAt = (clientX, clientY) => {
    const pt = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [model.west + pt.x / U, model.north - pt.y / U];
  };
  setView(null);
  return { svg, place, setArea, setPins, setScale, setView, degAt, unitsWide: () => svg.viewBox.baseVal.width };
};

/**
 * The interactive heat map, shared by the place drawer and the first screen: one tab stop
 * (`role="application"`), arrows move a focus ring (Shift five squares, Home hotspot 1), Enter or
 * Space or a click picks, a readout names the square under the pointer or focus, and a polite live
 * region reads each move. A map wider than 40 deg zooms in two levels (see docs/ux.md).
 * mountHeatMap(model, overview, {focus, onPick(q), maxPins}) returns {nodes, select(q), reveal(q), setArea(bbox),
 * start(), stop()}: nodes go in the plate in order; select() rings a square as the pick; reveal()
 * moves the focus ring there and zooms to it; start() and stop() bind and release the resize observer.
 */
export const mountHeatMap = (model, overview, { focus = null, onPick = () => {}, maxPins = Infinity } = {}) => {
  const zoomable = isZoomable(model);
  const { svg, place, setArea, setPins, setScale, setView, degAt, unitsWide } = mapSvg(model, zoomable ? worldWindow(model) : null, maxPins);
  let announceTimer = 0;
  let resizeObs = null;
  let picked = null;
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const readout = h('p', { class: 'hm-readout', 'aria-hidden': 'true' });
  const readoutRow = h('div', { class: zoomable ? 'hm-bar is-zoomable' : 'hm-bar' }, readout);
  const mapEl = h('div', {
    class: zoomable ? 'hm-map is-zoomable' : 'hm-map', tabindex: '0', role: 'application', 'aria-roledescription': 'map',
    'aria-label': `Fire map of ${overview.year}. Arrow keys move one square, Shift and an arrow five, Home goes to hotspot 1, Enter picks the square.`,
  }, svg);
  let focusSq = focus ?? stepSquare(model, null, 'Home');
  const showReadout = (q) => {
    readout.replaceChildren(...(q ? [swatch(q.bin), h('b', { text: centerLabel(q.bbox) }), ` ${valueLine(q.value, overview)}`] : []));
  };

  // Zoom for a map too wide to pick from (the global extent), in levels: the whole map, a country
  // from the scope select, a regional window around a click, and the pick window. A click that cannot
  // pick goes one level down; "Show whole map" goes back to the whole map. No wheel or pinch.
  let level = 'world';
  let center = null;
  let box = null;
  let win = null;
  const worldBtn = h('button', {
    type: 'button', class: 'icon-btn hm-world', 'aria-label': 'Show whole map', 'data-tip': 'Show whole map', hidden: true,
    onclick: () => { box = null; zoomTo('world'); mapEl.focus(); },
  }, icon('globe'));
  if (zoomable) readoutRow.append(worldBtn);
  const windowFor = (width) => ({
    world: null, country: box, regional: center && regionalWindow(model, center), pick: center && zoomWindow(model, center, width),
  })[level];
  const applyView = () => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    if (zoomable) {
      win = windowFor(rect.width);
      setView(win);
    }
    const pxPerUnit = rect.width / unitsWide();
    setScale(zoomable ? DRAWN_PX_PER_UNIT / pxPerUnit : 1, pxPerUnit);
  };
  const zoomTo = (next, at = center) => {
    level = next;
    center = at;
    worldBtn.hidden = level === 'world';
    applyView();
  };
  // A click picks where a square is big enough to aim at with that pointer (WCAG 2.2 target size for
  // touch); the keyboard and the coordinates form reach every square anyway.
  const canPick = (ev) => {
    if (!zoomable) return true;
    const width = svg.getBoundingClientRect().width;
    const shown = (win ?? worldWindow(model)).width;
    return squareFits(width / shown, pointerOf(ev));
  };
  const nextLevel = () => (level === 'world' || (level === 'country' && (box?.width ?? Infinity) > REGIONAL_WIDTH) ? 'regional' : 'pick');
  const zoomToSquare = (q) => { if (zoomable && q) zoomTo('pick', [q.w + 0.5, q.s + 0.5]); };

  const moveFocus = (q, { follow = false } = {}) => {
    focusSq = q;
    if (follow && win && !inWindow(win, q)) zoomToSquare(q);
    place('focus', q);
    showReadout(q);
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = squareText(model, q, overview); }, 150);
  };

  mapEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (focusSq) onPick(focusSq); return; }
    const next = stepSquare(model, focusSq, ev.key, { by: ev.shiftKey ? 5 : 1 });
    if (!next) return;
    ev.preventDefault();
    moveFocus(next, { follow: true });
  });
  mapEl.addEventListener('focus', () => { if (focusSq) moveFocus(focusSq); });
  mapEl.addEventListener('blur', () => showReadout(picked));
  const squareAt = (ev) => model.byKey.get(ev.target.closest?.('[data-key]')?.dataset.key) ?? null;
  svg.addEventListener('pointermove', (ev) => {
    const q = squareAt(ev);
    place('hover', q);
    showReadout(q ?? picked);
  });
  svg.addEventListener('pointerleave', () => { place('hover', null); showReadout(picked); });
  svg.addEventListener('click', (ev) => {
    const q = squareAt(ev);
    if (!canPick(ev)) {
      const at = degAt(ev.clientX, ev.clientY);
      const near = q ?? nearestSquare(model, at);
      if (near) { focusSq = near; place('focus', near); }
      zoomTo(nextLevel(), q || !near ? at : [near.w + 0.5, near.s + 0.5]);
      return;
    }
    if (!q) return;
    focusSq = q;
    place('focus', q);
    onPick(q);
  });

  return {
    nodes: [mapEl, readoutRow, live],
    mapEl,
    select: (q) => { picked = q; place('sel', q); showReadout(q); },
    reveal: (q) => { if (!model.byKey.has(q.key)) return; focusSq = q; place('focus', q); zoomToSquare(q); },
    setArea,
    /** Pins for the squares the list shows (null: the overview's hotspots). */
    setPins: (ranks) => { setPins(ranks ?? model.ranks, { atWorld: Boolean(ranks) }); applyView(); },
    /** Shows a window around a country (null: the whole map); a window too wide to help is the whole map. */
    showBox: (w) => { if (!zoomable) return; box = w; zoomTo(w ? 'country' : 'world'); },
    start: () => {
      resizeObs?.disconnect();
      resizeObs = new ResizeObserver(applyView);
      resizeObs.observe(svg);
    },
    stop: () => { resizeObs?.disconnect(); resizeObs = null; clearTimeout(announceTimer); },
  };
};

/**
 * A ranked hotspot row (`aria-pressed` button): rank disc, the place in two lines, the value with its
 * swatch. `labels` is the row's entry from hotspotRowsLabels; `sub` replaces the second line when the
 * hotspot has no place (the region name, else the box).
 */
export const hotspotRow = ({ hs, rank, q, labels, overview, sub = null, prefix = 'Hotspot', onClick }) => {
  const { title, sub: placeSub, full } = labels;
  const second = placeSub ?? sub;
  const row = h('button', {
    type: 'button', class: 'hs-row', 'aria-pressed': 'false', title: full, 'aria-label': `${prefix} ${rank}, ${full}, ${valueLine(hs.value, overview)}`, onclick: onClick,
  },
    h('span', { class: 'hs-rank', text: String(rank) }),
    h('span', { class: 'hs-name' }, h('b', { text: title }), h('small', { class: second ? '' : 'mono', text: second ?? bboxText(hs.bbox) })),
    h('span', { class: 'hs-val' }, q.bin == null ? null : swatch(q.bin), formatCount(hs.value)));
  row._bbox = hs.bbox;
  return row;
};

/** Sets aria-pressed on the rows whose box is `bbox`. */
export const pressRows = (rows, bbox) => rows.forEach((r) => r.setAttribute('aria-pressed', String(Boolean(bbox) && sameBbox(r._bbox, bbox))));

export const legendEl = () => h('ul', { class: 'hm-legend', 'aria-label': 'Fire-cell-days per 1° square' },
  HEAT_LABELS.map((label, bin) => h('li', {}, swatch(bin), label)));


let listIds = 0;

/**
 * The country scope as an editable combobox (WAI-ARIA APG, list autocomplete, the Name field's keys):
 * focus shows every suggestion, typing filters them, Enter or a click commits one. Only a suggestion
 * is ever committed: Escape, or leaving with text that names none, puts the last one back.
 * Returns {el, input, set(value)}.
 */
const scopeCombo = ({ id, options, onPick }) => {
  const listId = `${id}-list`;
  const byValue = new Map(options.map((o) => [o.value, o]));
  const input = h('input', {
    id, type: 'text', class: 'hl-combo', autocomplete: 'off', spellcheck: 'false', value: options[0].name,
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
  });
  const list = h('ul', { id: listId, role: 'listbox', class: 'combo-list hl-list', 'aria-label': 'Countries by fire activity', hidden: true });
  const status = h('span', { class: 'sr-only', role: 'status' });
  let current = options[0];
  let matches = [];
  let open = false;
  let active = -1;

  const paint = () => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    const opts = [...list.children];
    opts.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (open && active >= 0) {
      input.setAttribute('aria-activedescendant', opts[active].id);
      opts[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const restore = () => { input.value = current.name; open = false; active = -1; status.textContent = ''; paint(); };
  const commit = (o) => {
    const changed = o.value !== current.value;
    current = o;
    restore();
    if (changed) onPick(o.value);
  };
  const fill = (query) => {
    matches = matchScope(options, query);
    list.replaceChildren(...matches.map((o, i) => h('li', {
      id: `${listId}-${i}`, role: 'option', class: `combo-opt hl-opt${o.value === current.value ? ' is-current' : ''}`, 'aria-selected': 'false',
      onpointerdown: (ev) => ev.preventDefault(), onclick: () => commit(o),
    }, h('span', { class: 'combo-name', text: o.label }), o.region ? h('span', { class: 'combo-sub', text: 'Your region' }) : null)));
    open = matches.length > 0;
    active = -1;
    status.textContent = matches.length ? '' : 'No country matches.';
    paint();
  };

  // The current value lists everything; anything else typed filters.
  const query = () => (input.value === current.name ? '' : input.value);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('click', () => { if (!open) fill(query()); });
  input.addEventListener('input', () => fill(input.value));
  input.addEventListener('blur', restore);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && (open || input.value !== current.name)) { ev.preventDefault(); ev.stopPropagation(); restore(); return; }
    if (ev.key === 'Enter' && !(open && active >= 0)) {
      ev.preventDefault();
      const o = exactScope(options, input.value);
      if (o) commit(o); else restore();
      return;
    }
    if (!open && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) fill(query());
    const next = comboKey(ev.key, { open, active, count: matches.length }, { alt: ev.altKey });
    if (!next) return;
    ev.preventDefault();
    ev.stopPropagation();
    if ('pick' in next) { commit(matches[next.pick]); return; }
    ({ open, active } = next);
    paint();
  });
  const el = h('span', { class: 'hl-pick combo' }, input, icon('chevron', 'hl-chev'), list, status);
  return {
    el, input,
    set(value) { current = byValue.get(value) ?? options[0]; restore(); },
  };
};

/**
 * The hottest list beside a heat map, shared by the first screen and the place picker. Without
 * `countries` in overview.json it is the hotspot list under a plain title. With them the title holds
 * a country combobox, "Hottest in [World], {year}": the world lists countries by total (a row or the
 * combobox scopes to that country), a country zooms the map to it and lists its top squares, and the
 * pins follow. The browser's region is the first suggestion under World when it has data.
 * hottestList({overview, model, map, limit, title, titleClass, rowSub, onPick(q)}) returns
 * {head, list, live, press(bbox)}: head is the title element, list the rows' host.
 */
export const hottestList = ({ overview, model, map, limit, title, titleClass, rowSub = null, onPick, lang = globalThis.navigator?.language }) => {
  const id = `hl-${++listIds}`;
  const list = h('div', { class: 'hl-host' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  let rows = [];
  let pressed = null;
  const countries = scopeList(overview).kind === 'countries' ? overview.countries : null;
  let combo = null;

  const squareRows = (items) => {
    const labels = hotspotRowsLabels(items);
    return items.map((hs, i) => {
      const q = squareFor(model, hs.bbox) ?? { key: hs.bbox.join(), bbox: hs.bbox, value: hs.value, bin: 6 };
      return hotspotRow({ hs, rank: i + 1, q, labels: labels[i], overview, sub: rowSub, onClick: () => { onPick(q); map.reveal(q); } });
    });
  };
  const countryRows = (items) => items.map((c, i) => hotspotRow({
    hs: { bbox: c.bbox, value: c.value }, rank: i + 1, q: { bin: null }, labels: { title: c.country, sub: 'Whole country', full: c.country },
    overview, prefix: 'Country', onClick: () => { setScope(c.country); combo.input.focus(); },
  }));

  const render = (l) => {
    const items = l.items.slice(0, limit);
    rows = l.kind === 'countries' ? countryRows(items) : squareRows(items);
    list.replaceChildren(rows.length
      ? h('ol', { class: 'ad-rows hl-rows', 'data-kind': l.kind }, rows.map((r) => h('li', {}, r)))
      : h('p', { class: 'hp-none', text: `No fire detected in ${overview.region?.name ?? 'the data'} in ${overview.year}.` }));
    pressRows(rows, pressed);
  };

  const setScope = (name) => {
    const l = scopeList(overview, name);
    combo?.set(l.scope);
    render(l);
    map.setPins(listRanks(l));
    map.showBox(l.country ? countryWindow(l.country.bbox) : null);
    live.textContent = l.country ? `Hottest in ${l.country.country}: ${rows.length} squares` : `Hottest countries, ${overview.year}`;
  };

  let head;
  if (countries) {
    combo = scopeCombo({ id, options: scopeOptions(overview, regionCountry(lang, countries)), onPick: setScope });
    head = h('h3', { class: `${titleClass} hl-title` },
      h('label', { for: id, text: 'Hottest in' }), combo.el, h('span', { class: 'hl-year', text: `, ${overview.year}` }));
    render(scopeList(overview, ''));
  } else {
    head = h('h3', { class: titleClass, text: title });
    render(scopeList(overview, ''));
  }
  return {
    head, list, live,
    press: (bbox) => { pressed = bbox; pressRows(rows, bbox); },
  };
};
