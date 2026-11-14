import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINS, NODATA, aoiCellCount, binClass, density } from './bins.js';

const CELLS = 1000; // density = count

test('seven classes with the documented labels', () => {
  assert.deepEqual(BINS.map((b) => b.label), ['0', '1-3', '4-15', '16-63', '64-255', '256-1023', '1024+']);
});

test('class edges at 4^k, lower edge inclusive', () => {
  const at = (n) => binClass(n, CELLS);
  assert.deepEqual([1, 3, 4, 15, 16, 63, 64, 255, 256, 1023, 1024, 50000].map(at), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test('zero is its own class, null is no data, never the same', () => {
  assert.equal(binClass(0, CELLS), 0);
  assert.equal(binClass(null, CELLS), NODATA);
  assert.notEqual(binClass(0, CELLS), binClass(null, CELLS));
});

test('a positive density below 1 is class 1, not 0', () => {
  assert.equal(binClass(1, 100000), 1);
  assert.equal(density(1, 100000), 0.01);
});

test('the same count bins lower in a larger AOI', () => {
  assert.equal(binClass(1100, 1000), 6);
  assert.equal(binClass(1100, 100000), 2);
});

test('a positive count with no cells throws; density is null', () => {
  assert.throws(() => binClass(5, 0), RangeError);
  assert.equal(density(5, 0), null);
  assert.equal(density(null, 10), null);
});

test('aoiCellCount follows the center rule of core/aggregate', () => {
  assert.equal(aoiCellCount([-60, -20, -50, -10], 0.1), 10000);
  assert.equal(aoiCellCount([-60, -20, -50, -10], 1), 100);
  // centers at -59.95 ... : west edge on a cell edge keeps that cell, east edge excludes its neighbor
  assert.equal(aoiCellCount([0, 0, 0.1, 0.1], 0.1), 1);
  // a box thinner than a cell that holds no center
  assert.equal(aoiCellCount([0.01, 0.01, 0.04, 0.04], 0.1), 0);
  // misaligned edges: centers 0.05 and 0.15 lie inside [0.02, 0.18)
  assert.equal(aoiCellCount([0.02, 0, 0.18, 0.1], 0.1), 2);
});
