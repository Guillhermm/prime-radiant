import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDedupe } from './dedupe.js';

test('first add is new, repeat is a duplicate', () => {
  const d = createDedupe();
  assert.equal(d.add('modis', 'x1y1', 5, '2020-01-01'), true);
  assert.equal(d.add('modis', 'x1y1', 5, '2020-01-01'), false);
});

test('different family, cell, tile or day is not a duplicate', () => {
  const d = createDedupe();
  d.add('modis', 'x1y1', 5, '2020-01-01');
  assert.equal(d.add('viirs', 'x1y1', 5, '2020-01-01'), true);
  assert.equal(d.add('modis', 'x1y1', 6, '2020-01-01'), true);
  assert.equal(d.add('modis', 'x1y2', 5, '2020-01-01'), true);
  assert.equal(d.add('modis', 'x1y1', 5, '2020-01-02'), true);
});

test('dropYear frees only that year', () => {
  const d = createDedupe();
  d.add('modis', 'x1y1', 5, '2019-12-31');
  d.add('modis', 'x1y1', 5, '2020-01-01');
  d.dropYear(2019);
  assert.equal(d.size(), 1);
  assert.equal(d.add('modis', 'x1y1', 5, '2019-12-31'), true);
  assert.equal(d.add('modis', 'x1y1', 5, '2020-01-01'), false);
});

test('packed keys stay distinct at the extremes (last tile, last cell, Dec 31 of a leap year)', () => {
  const d = createDedupe();
  assert.equal(d.add('noaa20', 'x35y17', 9999, '2024-12-31'), true);
  assert.equal(d.add('noaa20', 'x35y17', 9999, '2024-12-30'), true);
  assert.equal(d.add('noaa20', 'x35y16', 9999, '2024-12-31'), true);
  assert.equal(d.add('noaa20', 'x0y0', 0, '2024-01-01'), true);
  assert.equal(d.add('modis', 'x0y0', 0, '2024-01-01'), true);
  assert.equal(d.add('noaa20', 'x35y17', 9999, '2024-12-31'), false);
  assert.throws(() => d.add('modis', 'x0y0', 10000, '2024-01-01'), RangeError);
});
