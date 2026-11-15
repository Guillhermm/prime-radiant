import { VIEWS, DEFAULT_VIEW, isEnabledView } from './views.js';

export const LAYERS = ['counts', 'anomaly'];
export const DEFAULT_LAYER = 'counts';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;

// maxAreaDeg2 (H4, area cap in square degrees) and span (manifest {from, to}) are not
// final: with the defaults, the cap and the date span checks are off.
export const defaultState = ({ span = null } = {}) => ({
  bbox: null,
  name: null,
  from: span ? span.from : null,
  to: span ? span.to : null,
  view: DEFAULT_VIEW,
  layer: DEFAULT_LAYER,
});

export const validateBbox = (bbox, { maxAreaDeg2 = Infinity } = {}) => {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return 'bbox must be four numbers';
  const [w, s, e, n] = bbox;
  if (s < -90 || s > 90 || n < -90 || n > 90) return 'latitude out of range [-90, 90]';
  if (w < -180 || w > 180 || e < -180 || e > 180) return 'longitude out of range [-180, 180]';
  if (!(w < e)) return 'west must be less than east';
  if (!(s < n)) return 'south must be less than north';
  if ((e - w) * (n - s) > maxAreaDeg2) return `area exceeds the cap of ${maxAreaDeg2} square degrees`;
  return null;
};

export const NAME_MAX = 60;

// An area's name as it may travel in the link: control characters stripped, trimmed, at most
// NAME_MAX characters (code points, so an accent or emoji is never cut in half). Null when nothing is left.
export const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const name = [...raw.replace(/\p{Cc}/gu, '').trim()].slice(0, NAME_MAX).join('').trim();
  return name || null;
};

const validateMonth = (m, span) => {
  if (typeof m !== 'string' || !MONTH_RE.test(m)) return 'date must be YYYY-MM';
  if (span && (m < span.from || m > span.to)) return `date outside the available span ${span.from} to ${span.to}`;
  return null;
};

export const serializeHash = (state) => {
  const parts = [];
  if (state.bbox) parts.push(`aoi=bbox:${state.bbox.join(',')}`);
  if (state.bbox && state.name) parts.push(`name=${encodeURIComponent(state.name)}`);
  if (state.from) parts.push(`from=${state.from}`);
  if (state.to) parts.push(`to=${state.to}`);
  parts.push(`view=${state.view}`, `layer=${state.layer}`);
  return `#${parts.join('&')}`;
};

// Returns { state, errors }. Each invalid field falls back to its default and adds
// { field, reason } to errors. Unknown keys are ignored.
export const parseHash = (hash, { maxAreaDeg2 = Infinity, span = null, views = VIEWS } = {}) => {
  const state = defaultState({ span });
  const errors = [];
  const fail = (field, reason) => errors.push({ field, reason });
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));

  if (params.has('aoi')) {
    const aoi = params.get('aoi');
    const m = /^bbox:([^,]*),([^,]*),([^,]*),([^,]*)$/.exec(aoi);
    const parts = m ? m.slice(1) : [];
    if (!m || !parts.every((p) => NUM_RE.test(p))) fail('bbox', 'aoi must be bbox:west,south,east,north');
    else {
      const bbox = parts.map(Number);
      const reason = validateBbox(bbox, { maxAreaDeg2 });
      if (reason) fail('bbox', reason);
      else state.bbox = bbox;
    }
  }

  // A name only means something with an area; without one it is dropped quietly.
  if (params.has('name') && state.bbox) {
    const name = cleanName(params.get('name'));
    if (name) state.name = name;
    else fail('name', 'name is empty');
  }

  const dates = {};
  for (const key of ['from', 'to']) {
    if (!params.has(key)) continue;
    const v = params.get(key);
    const reason = validateMonth(v, span);
    if (reason) fail(key, reason);
    else dates[key] = v;
  }
  const from = dates.from ?? state.from;
  const to = dates.to ?? state.to;
  if (from && to && from > to) {
    fail('from', 'from must not be after to');
    fail('to', 'from must not be after to');
  } else {
    if (dates.from) state.from = dates.from;
    if (dates.to) state.to = dates.to;
  }

  if (params.has('view')) {
    const v = params.get('view');
    if (isEnabledView(v, views)) state.view = v;
    else fail('view', `unknown or disabled view "${v}"`);
  }
  if (params.has('layer')) {
    const v = params.get('layer');
    if (LAYERS.includes(v)) state.layer = v;
    else fail('layer', `unknown layer "${v}"`);
  }
  return { state, errors };
};

export const createStore = (initial) => {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      if (Object.keys(next).every((k) => next[k] === state[k] ||
        (Array.isArray(next[k]) && Array.isArray(state[k]) && next[k].join() === state[k].join()))) return;
      state = next;
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
};
