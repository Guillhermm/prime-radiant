/**
 * Fire-cell-day dedupe, one set per UTC year so a caller can feed one year at a time
 * and free memory with `dropYear`.
 *
 * A fire-cell-day is unique per (family, tile, cell, UTC day); see docs/method.md
 * section 2. Keys are packed into one integer (family, tile, cell, day of year) rather
 * than a string: about 8x less memory, which matters for a global year (millions of keys).
 */
import { parseTileId, TILES_Y } from '../core/grid.js';

const CELLS = 10000; // 0.1 deg cells per tile
const TILES = 36 * TILES_Y;
const DAYS = 366;
const MAX_FAMILIES = 16; // 16 * 648 * 10000 * 366 < 2^53

function dayOfYear(utcDay) {
  const y = +utcDay.slice(0, 4);
  return (Date.UTC(y, +utcDay.slice(5, 7) - 1, +utcDay.slice(8, 10)) - Date.UTC(y, 0, 1)) / 864e5;
}

/**
 * @returns {{add(family: string, tile: string, cell: number, utcDay: string): boolean,
 *   dropYear(year: string|number): void, size(): number}}
 *   `add` returns true the first time a key is seen, false for a duplicate.
 */
export function createDedupe() {
  const byYear = new Map();
  const families = new Map();
  const tiles = new Map();
  return {
    add(family, tile, cell, utcDay) {
      let f = families.get(family);
      if (f === undefined) {
        if (families.size >= MAX_FAMILIES) throw new RangeError(`too many families: ${family}`);
        families.set(family, (f = families.size));
      }
      let t = tiles.get(tile);
      if (t === undefined) {
        const { tx, ty } = parseTileId(tile);
        tiles.set(tile, (t = tx * TILES_Y + ty));
      }
      if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new RangeError(`bad cell: ${cell}`);
      const year = utcDay.slice(0, 4);
      let set = byYear.get(year);
      if (!set) byYear.set(year, (set = new Set()));
      const key = ((f * TILES + t) * CELLS + cell) * DAYS + dayOfYear(utcDay);
      if (set.has(key)) return false;
      set.add(key);
      return true;
    },
    dropYear(year) {
      byYear.delete(String(year));
    },
    size() {
      let n = 0;
      for (const s of byYear.values()) n += s.size;
      return n;
    },
  };
}
