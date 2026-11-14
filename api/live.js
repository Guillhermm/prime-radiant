import { validateBbox } from '../web/src/state.js';
import { locate } from '../core/grid.js';

export const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
export const SNAP_DEG = 0.5;
// Operational cap on the request size (keeps the FIRMS transaction cost and the response small).
export const MAX_AREA_DEG2 = 2500;
const FIRMS = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const NUM_RE = /^-?\d+(\.\d+)?$/;
const DAY_MS = 86400000;
const CACHE = 's-maxage=900, stale-while-revalidate=3600';
const UPSTREAM_TIMEOUT_MS = 8000;

// Applied on every response: whether vercel.json headers reach functions is not verified, so the function sets its own.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const json = (status, body, cache = false) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json', ...(cache ? { 'Cache-Control': CACHE } : { 'Cache-Control': 'no-store' }) },
  });

const fail = (status, error, extra = {}) => json(status, { error, ...extra });
const PARAMS = new Set(['bbox', 'days']);

/** Outward snap to the 0.5 degree grid; the proxy only accepts a bbox already equal to its snap (one cache key per area). */
export const snapBbox = ([w, s, e, n]) => [
  Math.max(-180, Math.floor(w / SNAP_DEG) * SNAP_DEG),
  Math.max(-90, Math.floor(s / SNAP_DEG) * SNAP_DEG),
  Math.min(180, Math.ceil(e / SNAP_DEG) * SNAP_DEG),
  Math.min(90, Math.ceil(n / SNAP_DEG) * SNAP_DEG),
];

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Parses a FIRMS area CSV into `{lon, lat, date}` rows; throws when the header is not a FIRMS one. */
export const parseCsv = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const [iLat, iLon, iDate] = ['latitude', 'longitude', 'acq_date'].map((k) => head.indexOf(k));
  if (iLat < 0 || iLon < 0 || iDate < 0) throw new Error('unexpected upstream payload');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const f = line.split(',');
    // Number('') is 0, so an empty field would land on (0, 0) without the regex check.
    if (!NUM_RE.test(f[iLat] ?? '') || !NUM_RE.test(f[iLon] ?? '') || !f[iDate]) continue;
    rows.push({ lon: Number(f[iLon]), lat: Number(f[iLat]), date: f[iDate] });
  }
  return rows;
};

const fetchSource = async (fetchFn, key, source, bbox, days, start) => {
  const url = `${FIRMS}/${key}/${source}/${bbox.join(',')}/${days}/${start}`;
  let res;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    throw new Error('upstream unreachable');
  }
  if (!res.ok) throw new Error(`upstream status ${res.status}`);
  return parseCsv(await res.text());
};

/**
 * Request handler with injected dependencies (tests stub `fetch`, `env` and `now`).
 * @param {Request} request
 * @param {{fetch?: typeof fetch, env?: object, now?: () => number}} [deps]
 */
export const handle = async (request, { fetch: fetchFn = fetch, env = process.env, now = Date.now } = {}) => {
  if (request.method !== 'GET') return fail(405, 'method not allowed');
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((k) => !PARAMS.has(k)) || new Set(keys).size !== keys.length) return fail(400, 'only bbox and days are allowed, once each');

  const parts = (params.get('bbox') ?? '').split(',');
  if (parts.length !== 4 || !parts.every((p) => NUM_RE.test(p))) return fail(400, 'bbox must be four numbers: west,south,east,north');
  const bbox = parts.map(Number);
  const reason = validateBbox(bbox, { maxAreaDeg2: MAX_AREA_DEG2 });
  if (reason) return fail(400, reason);
  const snapped = snapBbox(bbox);
  if (snapped.some((v, i) => v !== bbox[i])) return fail(400, `bbox must be on the ${SNAP_DEG} degree grid`, { bbox: snapped });

  const days = params.get('days') ?? '1';
  if (days !== '1' && days !== '2') return fail(400, 'days must be 1 or 2');
  const nDays = Number(days);

  const key = env.MAP_KEY;
  if (!key) return fail(503, 'live proxy is not configured');

  const today = Math.floor(now() / DAY_MS) * DAY_MS;
  const start = isoDay(today - (nDays - 1) * DAY_MS);

  let batches;
  try {
    batches = await Promise.all(SOURCES.map((s) => fetchSource(fetchFn, key, s, snapped, nDays, start)));
  } catch {
    return fail(502, 'upstream data source unavailable');
  }

  // A fire-cell-day is a (0.1 degree cell, day) pair with at least one detection from any source.
  const days_ = Array.from({ length: nDays }, (_, i) => isoDay(today - (nDays - 1 - i) * DAY_MS));
  const seen = days_.map(() => new Set());
  const [w, s, e, n] = snapped;
  for (const { lon, lat, date } of batches.flat()) {
    const i = days_.indexOf(date);
    if (i < 0 || lon < w || lon > e || lat < s || lat > n) continue;
    const { tileId, cell } = locate(lon, lat);
    seen[i].add(`${tileId}:${cell}`);
  }

  return json(200, {
    bbox: snapped,
    series: {
      id: 'live',
      comparable: false,
      step: 'day',
      unit: 'fire-cell-days',
      start,
      values: seen.map((s) => s.size),
      method: { id: 'firms-nrt-proxy', version: '1' },
    },
  }, true);
};

export default { fetch: (request) => handle(request) };
