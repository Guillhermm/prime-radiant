import { cellCenter } from './grid.js';
import { monthIndex } from './months.js';
import { decodeTile, coverageLookup, checkBbox } from './tiles.js';

/** Above this many fine (0.1 deg) cells in the AOI, seriesForAoi switches to the coarse level. */
export const MAX_FINE_CELLS = 20000;

const MICRO = 1e6;

// Count grid cells of step `step` (deg) whose centers lie in [lo, hi] (edges inclusive),
// on an axis whose grid starts at `origin`. Integer microdegrees avoid float noise.
function centersIn(lo, hi, origin, step) {
  const st = Math.round(step * MICRO);
  const a = Math.ceil((Math.round((lo - origin) * MICRO) - st / 2) / st);
  const b = Math.floor((Math.round((hi - origin) * MICRO) - st / 2) / st);
  return Math.max(0, b - a + 1);
}

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
 * Level: with `opts.res` set, that level is used and `tiles` is one flat map of tile id
 * to tile. Without it, `tiles` may be `{fine, coarse}` (each a map of tile id to tile):
 * the coarse level is used when the AOI holds more than MAX_FINE_CELLS fine cells and
 * `coarse` is given, else fine. A flat map without `opts.res` is read as fine.
 *
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {Record<string, object> | {fine?: Record<string, object>, coarse?: Record<string, object>}} tiles tile objects keyed by tile id
 * @param {object} manifest validated manifest
 * @param {{res?: number}} [opts] force a tile resolution, 0.1 or 1
 * @returns {{modis: import('./index.js').Series, viirs: import('./index.js').Series, res: number}} raw series (method {id:"raw", version:1}, comparable false) and the resolution used
 */
export function seriesForAoi(bbox, tiles, manifest, { res } = {}) {
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
  const out = {};
  for (const sensor of ['modis', 'viirs']) {
    const values = Array.from({ length: span }, (_, i) => (covered(sensor, i) ? 0 : null));
    for (const [id, d] of decoded) {
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
      method: { id: 'raw', version: 1 }, comparable: false,
    };
  }
  return { ...out, res: use };
}
