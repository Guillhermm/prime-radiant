import { cellCenter } from './grid.js';
import { monthIndex } from './months.js';
import { createDomain } from './domain.js';
import { decodeTile, coverageLookup, checkBbox } from './tiles.js';

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
 * inclusive) and return one raw Series per sensor, aligned to the manifest span.
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
 * @returns {{modis: import('./index.js').Series, viirs: import('./index.js').Series, res: number, domain: {cells: number, inside: number, partial: boolean}}} raw series (method {id:"raw", version:1}, comparable false), the resolution used and the domain count
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
  const decoded = Object.entries(set).map(([id, t]) => [id, decodeTile(t, use)]);
  const cells = cellCount(bbox, use);
  let inside = cells;
  if (domain) {
    const lookup = createDomain(domain);
    const ys = centerRange(s, n, -90, use);
    const xs = w <= e ? [centerRange(w, e, -180, use)] : [centerRange(w, 180, -180, use), centerRange(-180, e, -180, use)];
    inside = xs.reduce((a, [x0, x1]) => a + lookup.count(x0, x1, ys[0], ys[1], use), 0);
  }
  const flag = inside === 0 ? 'outside-domain' : inside < cells ? 'partial-domain' : null;
  const out = {};
  for (const sensor of ['modis', 'viirs']) {
    const values = Array.from({ length: span }, (_, i) => (inside > 0 && covered(sensor, i) ? 0 : null));
    for (const [id, d] of inside > 0 ? decoded : []) {
      for (const [month, rows] of d.byMonth) {
        if (month >= span) continue;
        for (const row of rows) {
          const v = row[sensor];
          if (v === null) continue;
          const { lon, lat } = cellCenter(id, row.cell, use);
          const inLon = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
          if (inLon && lat >= s && lat <= n) values[month] += v;
        }
      }
    }
    out[sensor] = {
      id: sensor, unit: 'fire-cell-days', start: manifest.month0, values,
      method: { id: 'raw', version: 1 }, comparable: false, ...(flag ? { flags: [{ month: null, flag }] } : {}),
    };
  }
  return { ...out, res: use, domain: { cells, inside, partial: inside > 0 && inside < cells } };
}
