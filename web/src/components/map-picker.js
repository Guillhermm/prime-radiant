import { h } from './h.js';
import { icon } from './icons.js';

export const MAP_DEFAULT = { center: [-15, -55], zoom: 3 };
const PRECISION = 4;
const MIN_SIDE = 0.1; // one grid cell; a smaller box would hold no cell center

const round = (x) => Number(x.toFixed(PRECISION));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// A click point is {lat, lng}. The box is clamped to the world; the form rules (west < east,
// south < north) hold by construction, and null means the two points are the same place.
export const bboxFromCorners = (a, b) => {
  const lons = [a.lng, b.lng].map((v) => clamp(v, -180, 180));
  const lats = [a.lat, b.lat].map((v) => clamp(v, -90, 90));
  const bbox = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)].map(round);
  return bbox[0] < bbox[2] && bbox[1] < bbox[3] ? bbox : null;
};

export const sameBbox = (a, b) => (a === null || b === null ? a === b : a.every((v, i) => v === b[i]));

export const isTooSmall = (bbox) => bbox[2] - bbox[0] < MIN_SIDE || bbox[3] - bbox[1] < MIN_SIDE;

// Leaflet bounds are [[south, west], [north, east]].
export const bboxToBounds = ([w, s, e, n]) => [[s, w], [n, e]];
export const boundsToBbox = ([[s, w], [n, e]]) => [w, s, e, n];

const deg = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v < 0 ? neg : pos}`;
/** "Area set: 8.0°S to 12.5°S, 45.0°W to 50.0°W." for [west, south, east, north]: north then south, east then west. */
export const areaSetText = ([w, s, e, n]) => `Area set: ${deg(n, 'N', 'S')} to ${deg(s, 'N', 'S')}, ${deg(e, 'E', 'W')} to ${deg(w, 'E', 'W')}.`;

export const ARM_TEXT = 'Click two opposite corners.';

const vendorUrl = (name) => new URL(`../../vendor/leaflet/${name}`, import.meta.url).href;

let loading = null;
// Leaflet is a classic script that sets window.L; loaded once, on first use.
const loadLeaflet = () => {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  loading ??= new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: vendorUrl('leaflet.css') }));
    const script = h('script', { src: vendorUrl('leaflet.js') });
    script.addEventListener('load', () => resolve(globalThis.L));
    script.addEventListener('error', () => { loading = null; reject(new Error('Leaflet failed to load')); });
    document.head.append(script);
  });
  return loading;
};

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * mount(container, {bbox, onChange, skipTo}). Draw by clicking two opposite corners; Escape
 * cancels a half-drawn box. `onChange(bbox)` fires only for user edits, so a form `setBbox`
 * never loops back. Desktop: a toolbar (Draw, Clear, Map) over a collapsible map. Phone: hidden
 * until `openFull()`, then full screen with Done and Cancel (Cancel restores the area from when it
 * opened). show() and openFull() arm Draw.
 * Returns {setBbox(bbox), show(), openFull(), closeFull(), destroy()}.
 */
export const mount = (container, { bbox = null, onChange = () => {}, skipTo = '#main-view' } = {}) => {
  let L = null;
  let map = null;
  let rect = null;
  let first = null;
  let drawing = false;
  let current = bbox;
  let saved = null;

  const status = h('p', { class: 'map-status', role: 'status' });
  const tool = (cls, ic, label, attrs) => h('button', { type: 'button', class: `icon-btn map-tool ${cls}`, 'aria-label': label, 'data-tip': label, ...attrs }, icon(ic));
  const draw = tool('map-draw', 'drawArea', 'Draw a rectangle', { 'aria-pressed': 'false' });
  const clear = tool('map-clear', 'close', 'Clear area', {});
  const toggle = tool('map-toggle', 'map', 'Show map', { 'aria-expanded': 'false', 'aria-controls': 'map-body' });
  const done = h('button', { type: 'button', class: 'btn btn-primary map-done' }, 'Done');
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost map-cancel' }, 'Cancel');
  const skip = h('a', { class: 'skip-link', href: skipTo }, 'Skip map');
  const canvas = h('div', {
    class: 'map-canvas', role: 'group',
    'aria-label': 'Map for drawing an area. Optional: the Area fields hold the same values',
  });
  const body = h('div', { class: 'map-body is-collapsed', id: 'map-body', inert: '' }, h('div', { class: 'map-body-inner' }, canvas, status));
  const bar = h('div', { class: 'map-bar' }, h('span', { class: 'map-label', text: 'Map' }), h('div', { class: 'map-tools' }, draw, clear, toggle));
  const full = h('div', { class: 'map-full-bar' }, cancel, h('h2', { class: 'map-full-title', text: 'Draw an area' }), done);
  const panel = h('section', { class: 'map-panel', 'aria-label': 'Map picker' }, skip, full, bar, body);
  container.replaceChildren(panel);

  const say = (msg) => { status.textContent = msg; };
  const paintClear = () => {
    if (current) clear.removeAttribute('aria-disabled');
    else clear.setAttribute('aria-disabled', 'true');
  };
  paintClear();

  const accent = () => getComputedStyle(panel).getPropertyValue('--color-accent').trim();
  const drawRect = (b) => {
    if (!map) return;
    if (!b) { rect?.remove(); rect = null; return; }
    const style = { color: accent(), weight: 2, fillOpacity: 0.15, interactive: false };
    if (rect) rect.setBounds(bboxToBounds(b)).setStyle(style);
    else rect = L.rectangle(bboxToBounds(b), style).addTo(map);
  };

  const stopDrawing = () => {
    drawing = false;
    first = null;
    draw.setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    drawRect(current);
  };
  const arm = () => {
    drawing = true;
    first = null;
    draw.setAttribute('aria-pressed', 'true');
    canvas.classList.add('is-drawing');
    say(ARM_TEXT);
  };

  const finish = (b) => {
    stopDrawing();
    if (!b || isTooSmall(b)) { say('That area is too small. Click two corners at least 0.1 degrees apart.'); return; }
    current = b;
    drawRect(b);
    paintClear();
    say(areaSetText(b));
    onChange(b);
  };

  const onClick = (ev) => {
    if (!drawing) return;
    if (!first) { first = ev.latlng; say('First corner set. Click the opposite corner.'); return; }
    finish(bboxFromCorners(first, ev.latlng));
  };
  const onMove = (ev) => {
    if (drawing && first) drawRect(bboxFromCorners(first, ev.latlng));
  };

  draw.addEventListener('click', () => {
    if (drawing) { stopDrawing(); say('Drawing canceled.'); return; }
    if (!isOpen()) setOpen(true);
    arm();
  });
  clear.addEventListener('click', () => {
    if (!current) return;
    stopDrawing();
    current = null;
    drawRect(null);
    paintClear();
    say('Area cleared.');
    onChange(null);
  });
  panel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (drawing) { ev.stopPropagation(); stopDrawing(); say('Drawing canceled.'); }
    else if (panel.classList.contains('is-full')) closeFull(true);
  });

  const fit = () => {
    if (!map) return;
    map.invalidateSize();
    if (current) map.fitBounds(bboxToBounds(current), { maxZoom: 8, padding: [16, 16] });
  };

  const init = async () => {
    if (map) return;
    try {
      L = await loadLeaflet();
    } catch {
      say('The map could not load. Use the Area fields instead.');
      return;
    }
    map = L.map(canvas, {
      center: MAP_DEFAULT.center, zoom: MAP_DEFAULT.zoom, minZoom: 2, maxBounds: [[-90, -180], [90, 180]], maxBoundsViscosity: 1,
      worldCopyJump: false,
    });
    // Leaflet's own prefix carries a flag icon; it is credited in the footer instead. OSM's credit stays.
    map.attributionControl.setPrefix(false);
    L.tileLayer(OSM, { attribution: ATTRIBUTION, maxZoom: 18, noWrap: true }).addTo(map);
    map.on('click', onClick);
    map.on('mousemove', onMove);
    drawRect(current);
    fit();
  };

  // The body collapses by height (CSS); while collapsed it is inert, so nothing inside takes focus.
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    const label = open ? 'Hide map' : 'Show map';
    toggle.setAttribute('aria-label', label);
    toggle.dataset.tip = label;
    body.classList.toggle('is-collapsed', !open);
    body.inert = !open;
    if (open) init().then(fit);
    else if (drawing) { stopDrawing(); say(''); }
  };
  body.addEventListener('transitionend', (ev) => { if (ev.target === body && isOpen()) fit(); });
  toggle.addEventListener('click', () => setOpen(!isOpen()));

  let opener = null;
  const closeFull = (revert) => {
    panel.classList.remove('is-full');
    document.body.classList.remove('map-open');
    stopDrawing();
    if (revert) {
      current = saved;
      drawRect(current);
      paintClear();
      onChange(current);
    }
    opener?.focus?.();
  };
  done.addEventListener('click', () => closeFull(false));
  cancel.addEventListener('click', () => closeFull(true));

  return {
    setBbox(b) {
      if (sameBbox(b, current)) return;
      current = b;
      drawRect(b);
      paintClear();
      if (b && map) map.fitBounds(bboxToBounds(b), { maxZoom: 8, padding: [16, 16] });
    },
    show() {
      if (!isOpen()) setOpen(true);
      arm();
      draw.focus();
    },
    openFull() {
      opener = document.activeElement;
      saved = current;
      panel.classList.add('is-full');
      document.body.classList.add('map-open');
      setOpen(true);
      arm();
      draw.focus();
    },
    /** Leaves full screen keeping the area drawn so far, without moving focus (another overlay takes it). */
    closeFull() {
      if (!panel.classList.contains('is-full')) return;
      opener = null;
      closeFull(false);
    },
    destroy: () => { map?.remove(); container.replaceChildren(); },
  };
};
