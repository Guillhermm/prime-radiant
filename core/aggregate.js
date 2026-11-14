import { cellCenter } from './grid.js';
import { monthIndex } from './months.js';
import { createDomain } from './domain.js';
import { coverageLookup, checkBbox } from './tiles.js';

/** Above this many fine (0.1 deg) cells in the AOI, seriesForAoi switches to the coarse level. */
export const MAX_FINE_CELLS = 20000;

const MICRO = 1e6;

// Count grid cells of step `step` (deg) whose centers lie in [lo, hi] (edges inclusive),
// on an axis whose grid starts at `origin`. Integer microdegrees avoid float noise.
function centerRange(lo, hi, origin, step) {
  const st = Math.round(step * MICRO);
  return [Math.ceil((Math.round((lo - origin) * MICRO) - st / 2) / st), Math.floor((Math.round((hi - origin) * MICRO) - st / 2) / st)];
}
const centersIn = (lo, hi, origin, step) => { const [a, b] = centerRange(lo, hi, origin, step); return Math.max(0, b - a + 1); };

/**
 * Number of cells of resolution `res` whose centers fall in the bbox (antimeridian-safe).
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {number} [res] 0.1 (default) or 1
 * @returns {number}
 */
export function cellCount(bbox, res = 0.1) {
  const [w, s, e, n] = bbox;
  const lons = w <= e ? centersIn(w, e, -180, res) : centersIn(w, 180, -180, res) + centersIn(-180, e, -180, res);
  return lons * centersIn(s, n, -90, res);
}

/**
 * Sum the fire-cell-days of every cell whose center lies inside a bounding box (edges
 * inclusive) and return one raw Series per sensor (modis, viirs, noaa20), aligned to the manifest span.
 * Months outside a sensor's coverage are null (not operating); months inside it with no
 * rows are 0 (none detected). A bbox with west > east crosses the antimeridian.
 * Throws RangeError on a bad bbox (see checkBbox).
 *
 * Domain: with `opts.domain`, `domain` in the result is `{cells, inside, partial}`: the AOI
 * cells at the level used and how many are in the domain. When inside is 0 every value is
 * null (outside the domain, never 0); when 0 < inside < cells the sums cover the in-domain
 * part (tiles only hold in-domain records) and partial is true. The series then carry
 * flags `{month: null, flag}` with flag "outside-domain" or "partial-domain". Without a
 * domain, inside = cells and there is no flag.
 *
 * Level: with `opts.res` set, that level is used and `tiles` is one flat map of tile id
 * to tile. Without it, `tiles` may be `{fine, coarse}` (each a map of tile id to tile):
 * the coarse level is used when the AOI holds more than MAX_FINE_CELLS fine cells and
 * `coarse` is given, else fine. A flat map without `opts.res` is read as fine.
 *
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {Record<string, object> | {fine?: Record<string, object>, coarse?: Record<string, object>}} tiles tile objects keyed by tile id
 * @param {object} manifest validated manifest
 * @param {{res?: number, domain?: {rows: object}}} [opts] force a tile resolution, 0.1 or 1; a decoded domain.json to apply
 * @returns {{modis: import('./index.js').Series, viirs: import('./index.js').Series, noaa20: import('./index.js').Series, res: number, domain: {cells: number, inside: number, partial: boolean}}} raw series (method {id:"raw", version:1}, comparable false), the resolution used and the domain count
 */
export function seriesForAoi(bbox, tiles, manifest, { res, domain } = {}) {
  checkBbox(bbox);
  const leveled = tiles.fine !== undefined || tiles.coarse !== undefined;
  let use = res;
  if (use === undefined) {
    use = leveled && tiles.coarse && cellCount(bbox, 0.1) > MAX_FINE_CELLS ? 1 : 0.1;
  }
  const set = leveled ? (use === 1 ? tiles.coarse : tiles.fine) ?? {} : tiles;
  const [w, s, e, n] = bbox;
  const m0 = monthIndex(manifest.month0);
  const span = monthIndex(manifest.last_month) - m0 + 1;
  const covered = coverageLookup(manifest);
  const cells = cellCount(bbox, use);
  let inside = cells;
  if (domain) {
    const lookup = createDomain(domain);
    const ys = centerRange(s, n, -90, use);
    const xs = w <= e ? [centerRange(w, e, -180, use)] : [centerRange(w, 180, -180, use), centerRange(-180, e, -180, use)];
    inside = xs.reduce((a, [x0, x1]) => a + lookup.count(x0, x1, ys[0], ys[1], use), 0);
  }
  const flag = inside === 0 ? 'outside-domain' : inside < cells ? 'partial-domain' : null;
  const SENSORS = ['modis', 'viirs', 'noaa20'];
  const values = Object.fromEntries(SENSORS.map((sensor) =>
    [sensor, Array.from({ length: span }, (_, i) => (inside > 0 && covered(sensor, i) ? 0 : null))]));
  const inLon = (lon) => (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);
  const per = use === 1 ? 10 : 100;
  for (const [id, t] of inside > 0 ? Object.entries(set) : []) {
    // Skip tiles wholly outside the bbox, then test each cell center once (not once per row).
    const sw = cellCenter(id, 0, use);
    const ne = cellCenter(id, per * per - 1, use);
    if (ne.lat < s || sw.lat > n || (w <= e ? ne.lon < w || sw.lon > e : ne.lon < w && sw.lon > e)) continue;
    const inc = new Uint8Array(per * per);
    for (let c = 0; c < per * per; c++) {
      const { lon, lat } = cellCenter(id, c, use);
      inc[c] = inLon(lon) && lat >= s && lat <= n ? 1 : 0;
    }
    for (let i = 0; i < t.cell.length; i++) {
      const month = t.month[i];
      if (!inc[t.cell[i]] || month >= span) continue;
      for (const sensor of SENSORS) {
        const v = t[sensor][i];
        if (v !== null) values[sensor][month] += v;
      }
    }
  }
  const out = {};
  for (const sensor of SENSORS) {
    out[sensor] = {
      id: sensor, unit: 'fire-cell-days', start: manifest.month0, values: values[sensor],
      method: { id: 'raw', version: 1 }, comparable: false, ...(flag ? { flags: [{ month: null, flag }] } : {}),
    };
  }
  return { ...out, res: use, domain: { cells, inside, partial: inside > 0 && inside < cells } };
}

const wrapLon = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const WORLD = [-180, -90, 180, 90];

// Whole 10 deg tiles [a, b] (columns on the unwrapped axis) that cover the AOI, plus rows [r0, r1].
function tileSpan(bbox) {
  const [w, s, e, n] = bbox;
  const eu = w <= e ? e : e + 360;
  const a = Math.floor((w + 180) / 10);
  const b = Math.max(a, Math.ceil((eu + 180) / 10) - 1);
  const r0 = Math.min(17, Math.max(0, Math.floor((s + 90) / 10)));
  const r1 = Math.min(17, Math.max(r0, Math.ceil((n + 90) / 10) - 1));
  return { a, b, r0, r1 };
}

function spanBbox({ a, b, r0, r1 }, grow) {
  if ((b - a + 1 + 2 * grow) * 10 >= 360) return [-180, Math.max(0, r0 - grow) * 10 - 90, 180, Math.min(18, r1 + 1 + grow) * 10 - 90];
  const east = wrapLon((b + 1 + grow) * 10 - 180);
  return [wrapLon((a - grow) * 10 - 180), Math.max(0, r0 - grow) * 10 - 90, east === -180 ? 180 : east, Math.min(18, r1 + 1 + grow) * 10 - 90];
}

/**
 * Fallback levels for a sparse AOI (docs/method.md 4.3), narrowest first: the AOI itself, the
 * union of the 10 deg tiles it touches, that union plus the surrounding ring of tiles, and
 * the whole world. Latitudes are clamped to [-90, 90]; a box that reaches around the globe
 * becomes [-180, ., 180, .]; a box across the antimeridian keeps west > east. `manifest` is
 * accepted for a future domain bbox and is not read yet.
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {object} [manifest] validated manifest
 * @returns {{level: import('./index.js').FallbackLevel, bbox: [number, number, number, number]}[]}
 */
export function fallbackLevels(bbox, manifest) { // eslint-disable-line no-unused-vars
  checkBbox(bbox);
  const span = tileSpan(bbox);
  return [
    { level: 'aoi', bbox: [...bbox] },
    { level: 'tiles', bbox: spanBbox(span, 0) },
    { level: 'ring', bbox: spanBbox(span, 1) },
    { level: 'global', bbox: [...WORLD] },
  ];
}

/**
 * Raw series for every fallback level, ready for harmonize. `tiles` must already hold the
 * tiles of the widest level wanted (the caller loads them); each level reuses seriesForAoi.
 * @param {[number, number, number, number]} bbox the AOI
 * @param {Record<string, object> | {fine?: object, coarse?: object}} tiles as for seriesForAoi
 * @param {object} manifest validated manifest
 * @param {{res?: number, domain?: {rows: object}}} [opts] passed to seriesForAoi
 * @returns {{level: import('./index.js').FallbackLevel, modis: import('./index.js').Series, viirs: import('./index.js').Series, noaa20: import('./index.js').Series}[]}
 */
export function seriesForLevels(bbox, tiles, manifest, opts) {
  return fallbackLevels(bbox, manifest).map(({ level, bbox: b }) => {
    const { modis, viirs, noaa20 } = seriesForAoi(b, tiles, manifest, opts);
    return { level, modis, viirs, noaa20 };
  });
}
