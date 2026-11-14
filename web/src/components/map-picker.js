import { h } from './h.js';

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
 * never loops back. Desktop: collapsible panel. Phone: hidden until `openFull()`, then full
 * screen with Done and Cancel (Cancel restores the area from when it opened).
 * Returns {setBbox(bbox), openFull(), destroy()}.
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
  const phone = Boolean(globalThis.matchMedia?.('(max-width: 40rem)').matches);
  const toggle = h('button', { type: 'button', class: 'map-toggle', 'aria-expanded': String(phone), 'aria-controls': 'map-body' }, 'Map');
  const draw = h('button', { type: 'button', class: 'map-draw', 'aria-pressed': 'false' }, 'Draw rectangle');
  const clear = h('button', { type: 'button', class: 'map-clear' }, 'Clear');
  const done = h('button', { type: 'button', class: 'map-done btn-primary' }, 'Done');
  const cancel = h('button', { type: 'button', class: 'map-cancel' }, 'Cancel');
  const skip = h('a', { class: 'skip-link', href: skipTo }, 'Skip map');
  const canvas = h('div', {
    class: 'map-canvas', role: 'group',
    'aria-label': 'Map for drawing an area. Optional: the Area fields hold the same values',
  });
  const body = h('div', { class: 'map-body', id: 'map-body' },
    h('div', { class: 'map-tools' }, draw, clear, h('span', { class: 'map-hint' }, 'Click two opposite corners of the area.')),
    canvas, status);
  const full = h('div', { class: 'map-full-bar' }, cancel, done);
  const panel = h('section', { class: 'map-panel', 'aria-label': 'Map picker' }, skip, h('div', { class: 'map-head' }, toggle), full, body);
  container.replaceChildren(panel);

  const say = (msg) => { status.textContent = msg; };

  const drawRect = (b) => {
    if (!map) return;
    if (!b) { rect?.remove(); rect = null; return; }
    if (rect) rect.setBounds(bboxToBounds(b));
    else rect = L.rectangle(bboxToBounds(b), { color: '#0b5cad', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(map);
  };

  const stopDrawing = () => {
    drawing = false;
    first = null;
    draw.setAttribute('aria-pressed', 'false');
    canvas.classList.remove('is-drawing');
    drawRect(current);
  };

  const finish = (b) => {
    stopDrawing();
    if (!b || isTooSmall(b)) { say('That area is too small. Click two corners at least 0.1 degrees apart.'); return; }
    current = b;
    drawRect(b);
    say(`Area set: west ${b[0]}, south ${b[1]}, east ${b[2]}, north ${b[3]}.`);
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
    drawing = true;
    draw.setAttribute('aria-pressed', 'true');
    canvas.classList.add('is-drawing');
    say('Click the first corner.');
  });
  clear.addEventListener('click', () => {
    stopDrawing();
    current = null;
    drawRect(null);
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
    L.tileLayer(OSM, { attribution: ATTRIBUTION, maxZoom: 18, noWrap: true }).addTo(map);
    map.on('click', onClick);
    map.on('mousemove', onMove);
    drawRect(current);
    fit();
  };

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) { init().then(fit); }
  });

  let opener = null;
  const closeFull = (revert) => {
    panel.classList.remove('is-full');
    document.body.classList.remove('map-open');
    stopDrawing();
    if (revert) {
      current = saved;
      drawRect(current);
      onChange(current);
    }
    opener?.focus?.();
  };
  done.addEventListener('click', () => closeFull(false));
  cancel.addEventListener('click', () => closeFull(true));

  // Closed until asked on both widths: the calendar, not the map, is what the first screen is for, and
  // Leaflet and the tiles are not fetched for nothing.
  body.hidden = !phone;

  return {
    setBbox(b) {
      if (sameBbox(b, current)) return;
      current = b;
      drawRect(b);
      if (b && map) map.fitBounds(bboxToBounds(b), { maxZoom: 8, padding: [16, 16] });
    },
    openFull() {
      opener = document.activeElement;
      saved = current;
      panel.classList.add('is-full');
      document.body.classList.add('map-open');
      init().then(fit);
      draw.focus();
    },
    destroy: () => { map?.remove(); container.replaceChildren(); },
  };
};
