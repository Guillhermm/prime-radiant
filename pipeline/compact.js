/**
 * Compact store for binned counts, so a global build keeps 25 years in memory as typed arrays
 * (5 bytes a row) instead of nested Maps (tens of bytes a row). The build moves a year's
 * counts here once every file of that year is binned: the months of a year only come from
 * that year's files, so its rows are final. `countsOf` turns one tile back into the
 * binRecords shape for the tile writer.
 */

/** @returns {{chunks: Map<string, Map<string, {cell: Uint16Array, month: Uint16Array, n: Uint8Array}[]>>, months: Set<number>}} */
export const createStore = () => ({ chunks: new Map(), months: new Set() });

/**
 * Move binRecords counts into the store and empty them. Throws when a month arrives twice,
 * which would mean a file of one year held records of a year already compacted.
 */
export const compactInto = (store, counts) => {
  const seen = new Set();
  for (const [fam, tiles] of Object.entries(counts)) {
    const byTile = store.chunks.get(fam) ?? store.chunks.set(fam, new Map()).get(fam);
    for (const [tile, cells] of Object.entries(tiles)) {
      let rows = 0;
      for (const months of Object.values(cells)) rows += months.size;
      const chunk = { cell: new Uint16Array(rows), month: new Uint16Array(rows), n: new Uint8Array(rows) };
      let i = 0;
      for (const [cell, months] of Object.entries(cells)) {
        for (const [m, n] of months) {
          if (store.months.has(m)) throw new Error(`compact: month index ${m} was already compacted; a file holds records of another year`);
          if (n > 255) throw new Error(`compact: ${n} fire-cell-days in one cell and month`);
          seen.add(m);
          chunk.cell[i] = +cell;
          chunk.month[i] = m;
          chunk.n[i] = n;
          i++;
        }
      }
      (byTile.get(tile) ?? byTile.set(tile, []).get(tile)).push(chunk);
    }
    delete counts[fam];
  }
  for (const m of seen) store.months.add(m);
};

export const tileIdsOf = (store) => [...new Set([...store.chunks.values()].flatMap((t) => [...t.keys()]))];

/** One tile in the binRecords counts shape: {family: {tile: {cell: Map month -> n}}}. */
export const countsOf = (store, tile) => {
  const out = {};
  for (const [fam, byTile] of store.chunks) {
    const chunks = byTile.get(tile);
    if (!chunks) continue;
    const cells = {};
    for (const c of chunks) {
      for (let i = 0; i < c.cell.length; i++) {
        const months = (cells[c.cell[i]] ??= new Map());
        months.set(c.month[i], (months.get(c.month[i]) ?? 0) + c.n[i]);
      }
    }
    out[fam] = { [tile]: cells };
  }
  return out;
};

/** Fire-cell-days per family. */
export const totalsOf = (store) => Object.fromEntries([...store.chunks].map(([fam, byTile]) =>
  [fam, [...byTile.values()].flat().reduce((a, c) => a + c.n.reduce((b, n) => b + n, 0), 0)]));
