/** Grid math for the contract: 0.1 degree cells in 10 degree tiles, 1 degree coarse cells. */

export const RES = 0.1;
export const TILE_DEG = 10;
export const COARSE_RES = 1;

// Cell ids are row * 100 + col at every resolution, so a tile holds at most 100 x 100 cells.
const CELL_STRIDE = 100;

// Dividing by 0.1 can land just under an integer (2.9999999999999996); snap first.
const floorSnap = (x) => Math.floor(Number(x.toFixed(6)));

const finite = (name, v) => {
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${v}`);
};

/** Wraps a longitude into [-180, 180). 180 maps to -180. */
export const normalizeLon = (lon) => {
  finite('lon', lon);
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 0 ? 0 : wrapped;
};

/** Clamps a latitude into [-90, 90]. */
export const clampLat = (lat) => {
  finite('lat', lat);
  return Math.min(90, Math.max(-90, lat));
};

/** Tile id string, as used in the manifest and the file path: "0.1/x12y7". */
export const tileId = (res, tx, ty) => `${res}/x${tx}y${ty}`;

/** Parses a tile id into `{res, tx, ty}`; throws on a malformed id. */
export const parseTileId = (id) => {
  const m = /^(\d+(?:\.\d+)?)\/x(\d+)y(\d+)$/.exec(id);
  if (!m) throw new RangeError(`malformed tile id: ${id}`);
  return { res: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) };
};

/** Cell id inside a tile from its row (south to north) and column (west to east). */
export const cellId = (row, col) => row * CELL_STRIDE + col;

/**
 * Locates a point. Tiles count from lon -180 (tx, 0..35) and lat -90 (ty, 0..17).
 * Edge rule: a point on a cell edge belongs to the cell to its east/north. Longitude 180
 * wraps to -180; latitude 90 clamps into the northernmost row; below -90 clamps to the
 * southernmost.
 * @param {number} lon
 * @param {number} lat
 * @param {number} [res=0.1] cell size in degrees (0.1, or 1 for coarse tiles)
 * @returns {{tileId: string, tx: number, ty: number, row: number, col: number, cell: number}}
 */
export const locate = (lon, lat, res = RES) => {
  const perTile = Math.round(TILE_DEG / res);
  const cols = Math.round(360 / res);
  const rows = Math.round(180 / res);
  const gx = Math.min(cols - 1, floorSnap((normalizeLon(lon) + 180) / res));
  const gy = Math.min(rows - 1, floorSnap((clampLat(lat) + 90) / res));
  const tx = Math.floor(gx / perTile);
  const ty = Math.floor(gy / perTile);
  const col = gx % perTile;
  const row = gy % perTile;
  return { tileId: tileId(res, tx, ty), tx, ty, row, col, cell: cellId(row, col) };
};

/**
 * Center of a cell, rounded to 6 decimals.
 * @param {string} id tile id ("0.1/x12y7")
 * @param {number} cell cell id inside that tile
 * @returns {{lon: number, lat: number}}
 */
export const cellCenter = (id, cell) => {
  const { res, tx, ty } = parseTileId(id);
  const row = Math.floor(cell / CELL_STRIDE);
  const col = cell % CELL_STRIDE;
  const lon = -180 + tx * TILE_DEG + (col + 0.5) * res;
  const lat = -90 + ty * TILE_DEG + (row + 0.5) * res;
  return { lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) };
};
