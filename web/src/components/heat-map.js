import { centerLabel, dotPins, formatCount, HEAT_LABELS, inWindow, isZoomable, nearestSquare, sameBbox, squareText, stepSquare, valueLine, worldWindow, ZOOM_ASPECT, zoomWindow } from '../places.js';
import { bboxText } from './states.js';
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

/**
 * The heat map: squares, rank pins and the rings for selection, focus and hover, moved by `place`.
 * `setView(win)` shows a window in degrees (null: the whole map, or `world` when given) and
 * `setScale(k, pxPerUnit)` resizes the rings and pins by k and turns crowded pins into dots.
 */
const mapSvg = (model, world = null) => {
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
  const pinEls = [];
  for (const [key, rank] of model.ranks) {
    const q = model.byKey.get(key);
    if (!q) continue;
    const cx = x(q) + U - 0.5;
    const cy = y(q) + 0.5;
    const t = svgEl('text', { x: cx, y: cy + 3 });
    t.textContent = String(rank);
    const pin = svgEl('g', { class: 'hm-pin' });
    const circle = svgEl('circle', { cx, cy, r: 7 });
    pin.append(circle, t);
    pins.append(pin);
    pinEls.push({ pin, circle, cx, cy, rank });
  }
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
    // At world level the pins pile up on one continent and hide the squares; they come back zoomed in.
    pins.toggleAttribute('hidden', Boolean(world) && !win);
    svg.setAttribute('viewBox', v ? `${(v.west - model.west) * U} ${(model.north - v.north) * U} ${v.width * U} ${v.height * U}` : `0 0 ${W} ${H}`);
  };
  /** [lon, lat] under a client point. */
  const degAt = (clientX, clientY) => {
    const pt = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [model.west + pt.x / U, model.north - pt.y / U];
  };
  setView(null);
  return { svg, place, setArea, setScale, setView, degAt, unitsWide: () => svg.viewBox.baseVal.width };
};

/**
 * The interactive heat map, shared by the place drawer and the first screen: one tab stop
 * (`role="application"`), arrows move a focus ring (Shift five squares, Home hotspot 1), Enter or
 * Space or a click picks, a readout names the square under the pointer or focus, and a polite live
 * region reads each move. A map wider than 40 deg zooms in two levels (see docs/ux.md).
 * mountHeatMap(model, overview, {focus, onPick(q)}) returns {nodes, select(q), reveal(q), setArea(bbox),
 * start(), stop()}: nodes go in the plate in order; select() rings a square as the pick; reveal()
 * moves the focus ring there and zooms to it; start() and stop() bind and release the resize observer.
 */
export const mountHeatMap = (model, overview, { focus = null, onPick = () => {} } = {}) => {
  const zoomable = isZoomable(model);
  const { svg, place, setArea, setScale, setView, degAt, unitsWide } = mapSvg(model, zoomable ? worldWindow(model) : null);
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

  // Two-level zoom for a map too wide to pick from (the global extent): a click on the whole map
  // shows a window around it, "Show whole map" goes back. No wheel or pinch.
  let zoomCenter = null;
  let win = null;
  const worldBtn = h('button', {
    type: 'button', class: 'icon-btn hm-world', 'aria-label': 'Show whole map', 'data-tip': 'Show whole map', hidden: true,
    onclick: () => { zoomTo(null); mapEl.focus(); },
  }, icon('globe'));
  if (zoomable) readoutRow.append(worldBtn);
  const applyView = () => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    if (zoomable) {
      win = zoomCenter ? zoomWindow(model, zoomCenter, box.width) : null;
      setView(win);
    }
    const pxPerUnit = box.width / unitsWide();
    setScale(zoomable ? DRAWN_PX_PER_UNIT / pxPerUnit : 1, pxPerUnit);
  };
  const zoomTo = (center) => {
    zoomCenter = center;
    worldBtn.hidden = !center;
    applyView();
  };
  const zoomToSquare = (q) => { if (zoomable && q) zoomTo([q.w + 0.5, q.s + 0.5]); };

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
    if (zoomable && !win) {
      const at = degAt(ev.clientX, ev.clientY);
      const near = q ?? nearestSquare(model, at);
      if (near) { focusSq = near; place('focus', near); }
      zoomTo(q || !near ? at : [near.w + 0.5, near.s + 0.5]);
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
export const hotspotRow = ({ hs, rank, q, labels, overview, sub = null, onClick }) => {
  const { title, sub: placeSub, full } = labels;
  const second = placeSub ?? sub;
  const row = h('button', {
    type: 'button', class: 'hs-row', 'aria-pressed': 'false', title: full, 'aria-label': `Hotspot ${rank}, ${full}, ${valueLine(hs.value, overview)}`, onclick: onClick,
  },
    h('span', { class: 'hs-rank', text: String(rank) }),
    h('span', { class: 'hs-name' }, h('b', { text: title }), h('small', { class: second ? '' : 'mono', text: second ?? bboxText(hs.bbox) })),
    h('span', { class: 'hs-val' }, swatch(q.bin), formatCount(hs.value)));
  row._bbox = hs.bbox;
  return row;
};

/** Sets aria-pressed on the rows whose box is `bbox`. */
export const pressRows = (rows, bbox) => rows.forEach((r) => r.setAttribute('aria-pressed', String(Boolean(bbox) && sameBbox(r._bbox, bbox))));

export const legendEl = () => h('ul', { class: 'hm-legend', 'aria-label': 'Fire-cell-days per 1° square' },
  HEAT_LABELS.map((label, bin) => h('li', {}, swatch(bin), label)));

