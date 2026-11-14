import { cellCenter } from './grid.js';
import { monthIndex } from './months.js';

/**
 * Sum the fire-cell-days of every cell whose center lies inside a bounding box (edges
 * inclusive) and
 * return one raw Series per sensor, aligned to the manifest span.
 * Months outside a sensor's coverage are null (not operating); months inside it with no
 * rows are 0 (none detected). A bbox with west > east crosses the antimeridian.
 *
 * Fixture-grade version for M0: reads whichever tiles are given, one level only
 * (no coarse switch, no tile loading). M1-K5 replaces it.
 *
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {Record<string, object>} tiles tile objects keyed by tile id, all at `opts.res`
 * @param {object} manifest validated manifest
 * @param {{res?: number}} [opts] tile resolution, 0.1 (default) or 1
 * @returns {{modis: import('./index.js').Series, viirs: import('./index.js').Series}} raw series, method {id:"raw", version:1}, comparable false
 */
export function seriesForAoi(bbox, tiles, manifest, { res = 0.1 } = {}) {
  const [w, s, e, n] = bbox;
  const m0 = monthIndex(manifest.month0);
  const span = monthIndex(manifest.last_month) - m0 + 1;
  const out = {};
  for (const sensor of ['modis', 'viirs']) {
    const [from, to] = manifest.coverage[sensor].map((c) => monthIndex(c) - m0);
    const values = Array.from({ length: span }, (_, i) => (i >= from && i <= to ? 0 : null));
    for (const [id, t] of Object.entries(tiles)) {
      t.cell.forEach((c, i) => {
        const v = t[sensor][i];
        if (v === null || t.month[i] >= span) return;
        const { lon, lat } = cellCenter(id, c, res);
        const inLon = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
        if (inLon && lat >= s && lat <= n) values[t.month[i]] += v;
      });
    }
    out[sensor] = {
      id: sensor, unit: 'fire-cell-days', start: manifest.month0, values,
      method: { id: 'raw', version: 1 }, comparable: false,
    };
  }
  return out;
}
