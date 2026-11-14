/**
 * Grid math for the Prime Radiant tile contract.
 *
 * The world is cut into tiles of TILE_DEG x TILE_DEG degrees, indexed from the
 * south-west corner (lon -180, lat -90): tx = 0..35 west to east, ty = 0..17
 * south to north. A tile id is `x{tx}y{ty}`.
 *
 * Inside a tile, cells have side `res` (0.1 deg fine, 1 deg coarse). A cell id is
 * `row * perSide + col`, row counted from the tile's south edge and col from its
 * west edge, with perSide = TILE_DEG / res (100 fine, 10 coarse).
 *
 * Integer math: a coordinate is first converted to integer microdegrees with
 * Math.round(deg * 1e6), which removes float noise (0.1 * 3 style errors), and only
 * then divided and floored. Cell steps are 100000 (fine) or 1000000 (coarse)
 * microdegrees, so a point exactly on a cell edge lands on the integer boundary and
 * floor puts it in the cell east/north of the edge. Rounding to 1e-6 deg (about 0.1 m)
 * is far below any FIRMS coordinate precision. (Rounding to 0.1 deg directly would
 * misplace points such as 0.06, so the finer scale is used.)
 *
 * Edge rules: lon 180 maps to -180 (antimeridian wraps to tile x0); lat 90 clamps
 * into the top row (ty 17, row perSide-1). Out-of-range or non-finite input throws
 * a RangeError.
 */

export const TILE_DEG = 10;
export const RES = 0.1;
export const COARSE_RES = 1;
export const TILES_X = 36;
export const TILES_Y = 18;

const MICRO = 1e6;
const STEP = new Map([[RES, 1e5], [COARSE_RES, 1e6]]);

function stepFor(res) {
  const step = STEP.get(res);
  if (step === undefined) throw new RangeError(`unsupported resolution: ${res}`);
  return step;
}

/** Cells per tile side for a resolution: 100 for 0.1 deg, 10 for 1 deg. */
export function cellsPerSide(res = RES) {
  return (TILE_DEG * MICRO) / stepFor(res);
}

/** Build a tile id from tile indexes. */
export function tileId(tx, ty) {
  return `x${tx}y${ty}`;
}

/** Parse `x{tx}y{ty}`; returns {tx, ty} or throws RangeError. */
export function parseTileId(id) {
  const m = /^x(0|[1-9]\d*)y(0|[1-9]\d*)$/.exec(id);
  if (!m) throw new RangeError(`bad tile id: ${id}`);
  const tx = Number(m[1]);
  const ty = Number(m[2]);
  if (tx >= TILES_X || ty >= TILES_Y) throw new RangeError(`tile id out of range: ${id}`);
  return { tx, ty };
}

/**
 * Locate a point: tile id, cell id inside the tile, and row/col.
 * @param {number} lon degrees, -180..180 (180 maps to -180)
 * @param {number} lat degrees, -90..90 (90 clamps into the top row)
 * @param {number} [res] 0.1 or 1
 * @returns {{tile: string, tx: number, ty: number, cell: number, row: number, col: number}}
 */
export function locate(lon, lat, res = RES) {
  const step = stepFor(res);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    throw new RangeError(`point out of range: ${lon}, ${lat}`);
  }
  let lx = Math.round(lon * MICRO);
  const ly = Math.round(lat * MICRO);
  if (lx === 180 * MICRO) lx = -180 * MICRO;
  const maxGy = (180 * MICRO) / step - 1;
  const gx = Math.floor((lx + 180 * MICRO) / step);
  const gy = Math.min(Math.floor((ly + 90 * MICRO) / step), maxGy);
  const per = cellsPerSide(res);
  const tx = Math.floor(gx / per);
  const ty = Math.floor(gy / per);
  const col = gx - tx * per;
  const row = gy - ty * per;
  return { tile: tileId(tx, ty), tx, ty, cell: row * per + col, row, col };
}

/** Cell id inside its tile for a point. */
export function cellId(lon, lat, res = RES) {
  return locate(lon, lat, res).cell;
}

/** Tile id for a point (same for both resolutions). */
export function tileOf(lon, lat) {
  return locate(lon, lat, RES).tile;
}

/**
 * Center of a cell.
 * @param {string} tile tile id
 * @param {number} cell cell id inside the tile
 * @param {number} [res] 0.1 or 1
 * @returns {{lon: number, lat: number}}
 */
export function cellCenter(tile, cell, res = RES) {
  const step = stepFor(res);
  const per = cellsPerSide(res);
  if (!Number.isInteger(cell) || cell < 0 || cell >= per * per) {
    throw new RangeError(`cell out of range: ${cell}`);
  }
  const { tx, ty } = parseTileId(tile);
  const gx = tx * per + (cell % per);
  const gy = ty * per + Math.floor(cell / per);
  return {
    lon: (gx * step + step / 2 - 180 * MICRO) / MICRO,
    lat: (gy * step + step / 2 - 90 * MICRO) / MICRO,
  };
}
