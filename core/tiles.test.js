import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeTile, coverageLookup, tilesForBbox, checkBbox } from './tiles.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');

test('decodeTile: lookups by cell and by month agree', () => {
  const d = decodeTile(fx('tiles/0.1/x0y15.json'));
  assert.equal(d.byCell.get(99).get(2).viirs, 3);
  assert.equal(d.byCell.get(0).get(0).viirs, null);
  assert.deepEqual(d.byMonth.get(5).map((r) => r.cell), [9999]);
  assert.equal(d.byCell.get(0).get(1), undefined);
  assert.equal(d.byMonth.get(3), undefined);
  assert.equal(d.byCell.get(99).get(2), d.byMonth.get(2)[0]);
});

test('coverageLookup: viirs starts at index 2', () => {
  const c = coverageLookup(manifest);
  assert.deepEqual([0, 1, 2, 5].map((i) => c('viirs', i)), [false, false, true, true]);
  assert.deepEqual([0, 5, 6].map((i) => c('modis', i)), [true, true, false]);
});

test('tilesForBbox: only ids listed in the manifest', () => {
  assert.deepEqual(tilesForBbox([-10, 40, -9, 41], manifest), ['x17y13']);
  assert.deepEqual(tilesForBbox([-180, -90, 180, 90], manifest).sort(), ['x0y15', 'x17y13']);
  assert.deepEqual(tilesForBbox([0, 0, 1, 1], manifest), []);
});

test('tilesForBbox: antimeridian bbox takes both sides; east edge on a boundary stays out', () => {
  const m = { tiles: ['x0y15', 'x35y15', 'x1y15'] };
  assert.deepEqual(tilesForBbox([175, 60, -175, 65], m).sort(), ['x0y15', 'x35y15']);
  assert.deepEqual(tilesForBbox([-180, 60, -170, 65], m), ['x0y15']);
  assert.deepEqual(tilesForBbox([170, 60, 180, 65], m), ['x35y15']);
});

test('checkBbox: rejects malformed input, allows antimeridian order', () => {
  for (const b of [null, [0, 0, 1], [0, 0, NaN, 1], [0, 2, 1, 1], [-181, 0, 0, 1], [0, -91, 1, 0], ['0', 0, 1, 1]]) {
    assert.throws(() => checkBbox(b), RangeError, JSON.stringify(b));
    assert.throws(() => tilesForBbox(b, manifest), RangeError);
  }
  assert.doesNotThrow(() => checkBbox([170, 0, -170, 1]));
});
