import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seriesForAoi, cellCount, MAX_FINE_CELLS } from './aggregate.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const fine = { x0y15: fx('tiles/0.1/x0y15.json'), x17y13: fx('tiles/0.1/x17y13.json') };
const coarse = { x17y13: fx('tiles/1/x17y13.json') };
const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
const world = [-180, -90, 180, 90];
const tile = [-10, 40, 0, 50]; // whole-degree AOI = tile x17y13

test('fixture totals match fixtures/README.md', () => {
  const r = seriesForAoi(tile, fine, manifest);
  assert.equal(sum(r.modis.values), 35);
  assert.equal(sum(r.viirs.values), 35);
  assert.deepEqual(r.modis.values, [7, 7, 7, 0, 7, 7]);
  assert.deepEqual(r.viirs.values, [null, null, 15, 0, 10, 10]);
  assert.equal(r.res, 0.1);
});

test('viirs is null before its coverage start, 0 inside it with no rows', () => {
  const r = seriesForAoi([0, 0, 1, 1], fine, manifest);
  assert.deepEqual(r.viirs.values, [null, null, 0, 0, 0, 0]);
  assert.deepEqual(r.modis.values, [0, 0, 0, 0, 0, 0]);
});

test('coarse and fine agree for a whole-degree AOI', () => {
  const f = seriesForAoi(tile, { fine }, manifest);
  const c = seriesForAoi(tile, { fine, coarse }, manifest, { res: 1 });
  assert.equal(c.res, 1);
  assert.deepEqual(c.modis.values, f.modis.values);
  assert.deepEqual(c.viirs.values, f.viirs.values);
});

test('cellCount and the automatic switch at MAX_FINE_CELLS', () => {
  assert.equal(cellCount([-10, 40, 0, 50]), 10000);
  assert.equal(cellCount([-10, 40, -9.9, 40.1]), 1);
  assert.equal(cellCount([179, 60, -179, 70]), 2000);
  assert.equal(MAX_FINE_CELLS, 20000);
  // 10x20 deg = 20000 cells: not above the threshold, stays fine
  assert.equal(seriesForAoi([-10, 40, 10, 50], { fine, coarse }, manifest).res, 0.1);
  // 20 x 10.1 deg = 200 x 101 = 20200 cells: coarse
  const r = seriesForAoi([-10, 40, 10, 50.1], { fine, coarse }, manifest);
  assert.equal(r.res, 1);
  assert.equal(sum(r.modis.values), 35);
  // no coarse tiles supplied: stays fine
  assert.equal(seriesForAoi(world, { fine }, manifest).res, 0.1);
});

test('antimeridian bbox wraps; flat tile map still reads as fine', () => {
  const r = seriesForAoi([179, 60, -179, 70], fine, manifest);
  assert.equal(sum(r.modis.values), 2);
  assert.equal(r.res, 0.1);
});

test('bad bbox throws instead of returning zeros', () => {
  assert.throws(() => seriesForAoi([0, 0, NaN, 1], fine, manifest), RangeError);
});
