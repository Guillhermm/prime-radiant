import { cellCenter, parseTileId } from './grid.js';
import { monthIndex } from './months.js';

const UNIT = 'fire-cell-days';

const sensorSeries = (id, manifest, count) => {
  const [from, to] = manifest.coverage[id];
  const lo = monthIndex(manifest.month0, from);
  const hi = monthIndex(manifest.month0, to);
  const values = Array.from({ length: count }, (_, i) => (i >= lo && i <= hi ? 0 : null));
  return {
    id,
    unit: UNIT,
    start: manifest.month0,
    values,
    method: { id: 'aggregate', version: '1' },
    comparable: false,
  };
};

/**
 * Sums the 0.1 degree cells whose center lies inside `bbox` into one monthly series per
 * sensor. Months outside a sensor's coverage are null, months inside it with no rows are 0.
 * Coarse tiles are ignored. A bbox crossing the antimeridian (w > e) is not supported yet.
 * @param {[number, number, number, number]} bbox [west, south, east, north] in degrees
 * @param {Record<string, object>} tiles parsed tiles keyed by tile id ("0.1/x12y7")
 * @param {object} manifest parsed manifest
 * @returns {{modis: object, viirs: object}} two Series from `month0` to `last_month`
 */
export const seriesForAoi = (bbox, tiles, manifest) => {
  const [w, s, e, n] = bbox;
  if (!bbox.every(Number.isFinite) || w >= e || s >= n) throw new RangeError(`invalid bbox: ${bbox}`);
  const count = monthIndex(manifest.month0, manifest.last_month) + 1;
  const out = { modis: sensorSeries('modis', manifest, count), viirs: sensorSeries('viirs', manifest, count) };
  for (const [id, tile] of Object.entries(tiles)) {
    if (parseTileId(id).res !== manifest.grid.res) continue;
    for (let i = 0; i < tile.cell.length; i++) {
      const { lon, lat } = cellCenter(id, tile.cell[i]);
      if (lon < w || lon >= e || lat < s || lat >= n) continue;
      for (const sensor of ['modis', 'viirs']) {
        const v = tile[sensor][i];
        if (v !== null) out[sensor].values[tile.month[i]] = (out[sensor].values[tile.month[i]] ?? 0) + v;
      }
    }
  }
  return out;
};
