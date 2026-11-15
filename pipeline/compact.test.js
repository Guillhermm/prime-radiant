import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactInto, countsOf, createStore, tileIdsOf, totalsOf } from './compact.js';

const counts = (rows) => {
  const c = {};
  for (const [fam, tile, cell, m, n] of rows) (((c[fam] ??= {})[tile] ??= {})[cell] ??= new Map()).set(m, n);
  return c;
};

test('compacted years read back per tile in the binRecords shape, and the counts are emptied', () => {
  const store = createStore();
  const y1 = counts([['modis', 'x1y1', 5, 0, 3], ['modis', 'x1y1', 5, 1, 2], ['viirs', 'x2y2', 9999, 1, 31]]);
  compactInto(store, y1);
  assert.deepEqual(y1, {});
  compactInto(store, counts([['modis', 'x1y1', 5, 12, 4], ['modis', 'x1y1', 7, 12, 1]]));
  assert.deepEqual(tileIdsOf(store).sort(), ['x1y1', 'x2y2']);
  const t = countsOf(store, 'x1y1');
  assert.deepEqual(Object.keys(t), ['modis']);
  assert.deepEqual([...t.modis.x1y1[5]], [[0, 3], [1, 2], [12, 4]]);
  assert.deepEqual([...t.modis.x1y1[7]], [[12, 1]]);
  assert.deepEqual(totalsOf(store), { modis: 10, viirs: 31 });
});

test('a month compacted twice means a file held another year: it throws', () => {
  const store = createStore();
  compactInto(store, counts([['modis', 'x1y1', 5, 3, 1]]));
  assert.throws(() => compactInto(store, counts([['viirs', 'x1y1', 6, 3, 1]])), /already compacted/);
});
