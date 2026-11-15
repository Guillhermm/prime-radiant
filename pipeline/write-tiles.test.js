import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTiles, coarsen, serializeTile, compareTileIds } from './write-tiles.js';

const cov = { modis: [0, 5], viirs: [2, 5], noaa20: [4, 5] };
const M = (o) => new Map(Object.entries(o).map(([k, v]) => [+k, v])); // binRecords month level

test('columns sorted by cell then month; null outside coverage, 0 inside', () => {
  const counts = { modis: { x1y1: { 7: M({ 3: 2 }), 2: M({ 5: 1, 0: 4 }) } }, viirs: { x1y1: { 2: M({ 2: 3 }) } } };
  const t = buildTiles(counts, cov).get('x1y1').fine;
  assert.deepEqual(t.cell, [2, 2, 2, 7]);
  assert.deepEqual(t.month, [0, 2, 5, 3]);
  assert.deepEqual(t.modis, [4, 0, 1, 2]);
  assert.deepEqual(t.viirs, [null, 3, 0, 0]);
  assert.deepEqual(t.noaa20, [null, null, 0, null]);
});
test('terra-only counts merge into the modis column', () => {
  const counts = { modis_terra_only: { x1y1: { 1: M({ 0: 2 }) } }, modis: { x1y1: { 1: M({ 0: 3, 1: 1 }) } } };
  const t = buildTiles(counts, cov).get('x1y1').fine;
  assert.deepEqual(t.modis, [5, 1]);
});
test('coarse is the sum of fine per 1 deg cell, nulls kept, totals equal', () => {
  const fine = { cell: [0, 1, 1020, 9999], month: [0, 0, 0, 0], modis: [3, 2, 1, 0], viirs: [null, null, null, null], noaa20: [null, null, null, null] };
  const c = coarsen(fine, cov);
  assert.deepEqual(c.cell, [0, 12, 99]);
  assert.deepEqual(c.modis, [5, 1, 0]);
  assert.deepEqual(c.viirs, [null, null, null]);
});
test('serialize: one array per line, trailing newline', () => {
  const t = { cell: [0], month: [1], modis: [2], viirs: [null], noaa20: [null] };
  assert.equal(serializeTile(t), '{\n  "cell": [0],\n  "month": [1],\n  "modis": [2],\n  "viirs": [null],\n  "noaa20": [null]\n}\n');
});
test('tile ids sort west to east then south to north', () => {
  assert.deepEqual(['x17y13', 'x2y5', 'x2y15', 'x0y15'].sort(compareTileIds), ['x0y15', 'x2y5', 'x2y15', 'x17y13']);
});
