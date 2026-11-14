import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearOf, inBbox } from './build.js';

test('yearOf reads the file name, then the folder, else null', () => {
  assert.equal(yearOf('raw/country/modis_2003_Brazil.csv'), '2003');
  assert.equal(yearOf('raw/firms-2026/fire_archive_M-C61_849178.dbf'), '2026');
  assert.equal(yearOf('raw/x/fire_849178.dbf'), null);
});
test('inBbox handles the antimeridian and edges', () => {
  assert.ok(inBbox([-10, 40, 0, 50], -10, 40));
  assert.ok(!inBbox([-10, 40, 0, 50], 0.1, 45));
  assert.ok(inBbox([170, -10, -170, 10], 179, 0) && inBbox([170, -10, -170, 10], -175, 0));
  assert.ok(!inBbox([170, -10, -170, 10], 0, 0));
});
