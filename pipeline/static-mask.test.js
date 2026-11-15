import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMaskBuilder, maskKey } from './static-mask.js';

const rec = (lat, lon, utcDay, type = 0, sensor = 'viirs') => ({ lat, lon, utcDay, type, hasType: true, sensor });
const days = (n, y = 2024) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10));

const run = (files) => {
  const mb = createMaskBuilder();
  for (const [, recs] of files) {
    mb.startFile();
    for (const r of recs) mb.add(r);
    mb.endFile();
  }
  return mb.finish();
};

test('maskKey bins at 0.01 degree; neighbors are one row or column apart', () => {
  assert.equal(maskKey(31.805, 6.105), maskKey(31.809, 6.101));
  assert.notEqual(maskKey(31.805, 6.105), maskKey(31.815, 6.105));
  assert.equal(maskKey(-90, -180), 0);
  assert.equal(maskKey(0, 180), maskKey(0, -180));
  assert.equal(maskKey(90, 0), maskKey(89.995, 0));
});

test('type 3 (also inland water, wetlands) does not seed the mask; type 1 does', () => {
  assert.equal(run([['2024', [rec(-18.5, -57.5, '2024-08-01', 3)]]]).stats.cells, 0);
  assert.equal(run([['2024', [rec(-18.5, -57.5, '2024-08-01', 1)]]]).stats.cells, 9);
});

test('MODIS records seed nothing', () => {
  const ten = (y) => days(10, y).map((d) => rec(5.005, 5.005, d, 0, 'modis'));
  assert.equal(run([['2024', [rec(-18.5, -57.5, '2024-08-01', 2, 'modis')]]]).stats.cells, 0);
  assert.equal(run([['2023', ten(2023)], ['2024', ten(2024)]]).stats.cells, 0);
});

test('neighbors wrap across the antimeridian and stop at the poles', () => {
  const { mask } = run([['2024', [rec(0.005, 179.995, '2024-01-01', 2)]]]);
  assert.ok(mask.has(maskKey(0.005, -179.995)));
  assert.equal(run([['2024', [rec(-89.995, 0.005, '2024-01-01', 2)]]]).stats.typed_cells, 6);
});

test('the year comes from the day, so one undated file spanning two years is persistent', () => {
  assert.equal(run([[null, [...days(10, 2019), ...days(10, 2020)].map((d) => rec(5.005, 5.005, d))]]).stats.persistent_cells, 1);
});

test('the same days repeated in a second CSV entry of one file are not counted twice', () => {
  const five = (y) => days(5, y).map((d) => rec(5.005, 5.005, d));
  assert.equal(run([['2023', [...five(2023), ...five(2023)]], ['2024', [...five(2024), ...five(2024)]]]).stats.persistent_cells, 0);
});

test('a typed detection masks its cell and the 8 neighbors, not further', () => {
  const { mask, stats } = run([['2024', [rec(31.805, 6.105, '2024-01-01', 2)]]]);
  assert.equal(stats.typed_cells, 9);
  assert.ok(mask.has(maskKey(31.815, 6.115)) && mask.has(maskKey(31.795, 6.095)));
  assert.ok(!mask.has(maskKey(31.825, 6.105)));
});

test('a cell burning on 10 days in two years is persistent; in one year it is not', () => {
  const ten = (y) => days(10, y).map((d) => rec(31.805, 6.105, d));
  assert.equal(run([['2023', ten(2023)], ['2024', ten(2024)]]).stats.persistent_cells, 1);
  assert.equal(run([['2024', ten(2024)], ['2024', ten(2024)]]).stats.persistent_cells, 0);
  assert.equal(run([['2023', ten(2023).slice(1)], ['2024', ten(2024)]]).stats.persistent_cells, 0);
});

test('many detections on one day count once', () => {
  const one = Array.from({ length: 50 }, () => rec(-10.005, -50.005, '2024-08-01'));
  assert.equal(run([['2023', one], ['2024', one]]).stats.persistent_cells, 0);
});

test('records without a type are ignored', () => {
  const { stats } = run([['2024', [{ lat: 0, lon: 0, utcDay: '2024-01-01', hasType: false }]]]);
  assert.equal(stats.cells, 0);
});
