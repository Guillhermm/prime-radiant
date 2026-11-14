import { TILE_DEG, TILES_X, TILES_Y, tileId } from './grid.js';
import { monthIndex } from './months.js';

/**
 * @typedef {{cell: number, modis: number|null, viirs: number|null, noaa20: number|null}} TileRow
 * @typedef {{res: number, byCell: Map<number, Map<number, TileRow>>, byMonth: Map<number, TileRow[]>}} DecodedTile
 */

/**
 * Decode a columnar tile ({cell, month, modis, viirs, noaa20} parallel arrays) into lookups.
 * `byCell.get(cell).get(month)` and `byMonth.get(month)` give the same row objects.
 * A (cell, month) pair absent from the tile has no row: the caller decides 0 vs null
 * from coverage (see `covered`).
 * @param {{cell: number[], month: number[], modis: (number|null)[], viirs: (number|null)[], noaa20: (number|null)[]}} tile
 * @param {number} [res] tile resolution, 0.1 or 1
 * @returns {DecodedTile}
 */
export function decodeTile(tile, res = 0.1) {
  const byCell = new Map();
  const byMonth = new Map();
  tile.cell.forEach((cell, i) => {
    const month = tile.month[i];
    const row = { cell, modis: tile.modis[i], viirs: tile.viirs[i], noaa20: tile.noaa20[i] };
    if (!byCell.has(cell)) byCell.set(cell, new Map());
    byCell.get(cell).set(month, row);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(row);
  });
  return { res, byCell, byMonth };
}

/**
 * Coverage lookup for a manifest: `covered(sensor, monthIdx)` is true when the sensor
 * operated in that month (index counted from manifest.month0), false means null, not 0.
 * @param {object} manifest validated manifest
 * @returns {(sensor: 'modis'|'viirs'|'noaa20', monthIdx: number) => boolean}
 */
export function coverageLookup(manifest) {
  const m0 = monthIndex(manifest.month0);
  const range = {};
  for (const s of ['modis', 'viirs', 'noaa20']) range[s] = manifest.coverage[s].map((c) => monthIndex(c) - m0);
  return (sensor, i) => i >= range[sensor][0] && i <= range[sensor][1];
}

/**
 * Throw RangeError unless bbox is [west, south, east, north] with finite degrees,
 * |lon| <= 180, |lat| <= 90 and south <= north. west > east is allowed (antimeridian).
 * @param {unknown} bbox
 */
export function checkBbox(bbox) {
  const ok = Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite) &&
    Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 &&
    Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90 && bbox[1] <= bbox[3];
  if (!ok) throw new RangeError(`bad bbox: ${JSON.stringify(bbox)}`);
}

function tileRange(lo, hi, offset, max) {
  const a = Math.min(max - 1, Math.max(0, Math.floor((lo + offset) / TILE_DEG)));
  const b = Math.min(max - 1, Math.max(a, Math.ceil((hi + offset) / TILE_DEG) - 1));
  return [a, b];
}

/**
 * Tile ids a bbox touches, restricted to ids listed in manifest.tiles (empty tiles are
 * not published). A bbox with west > east crosses the antimeridian. Throws RangeError on a bad bbox.
 * @param {[number, number, number, number]} bbox [west, south, east, north] degrees
 * @param {{tiles: string[]}} manifest
 * @returns {string[]} tile ids, sorted by row then column
 */
export function tilesForBbox(bbox, manifest) {
  checkBbox(bbox);
  const [w, s, e, n] = bbox;
  const lons = w <= e ? [[w, e]] : [[w, 180], [-180, e]];
  const [ty0, ty1] = tileRange(s, n, 90, TILES_Y);
  const listed = new Set(manifest.tiles);
  const ids = new Set();
  for (const [lo, hi] of lons) {
    const [tx0, tx1] = tileRange(lo, hi, 180, TILES_X);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) if (listed.has(tileId(tx, ty))) ids.add(tileId(tx, ty));
    }
  }
  return [...ids];
}
