/**
 * Fire-cell-day dedupe, one set per UTC year so a caller can feed one year at a time
 * and free memory with `dropYear`.
 *
 * A fire-cell-day is unique per (family, tile, cell, UTC day); see docs/method.md
 * section 2.
 */

/**
 * @returns {{add(family: string, tile: string, cell: number, utcDay: string): boolean,
 *   dropYear(year: string|number): void, size(): number}}
 *   `add` returns true the first time a key is seen, false for a duplicate.
 */
export function createDedupe() {
  const byYear = new Map();
  return {
    add(family, tile, cell, utcDay) {
      const year = utcDay.slice(0, 4);
      let set = byYear.get(year);
      if (!set) byYear.set(year, (set = new Set()));
      const key = `${family}|${tile}|${cell}|${utcDay}`;
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
