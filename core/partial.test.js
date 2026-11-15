import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supplier } from './partial.js';

const manifest = {
  coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2026-07'], noaa20: ['2018-04', '2026-07'] },
  partial_months: { modis: [], viirs: ['2022-07'], noaa20: [] },
};

test('supplier: observed is viirs; estimated inside S-NPP coverage (outage fill) is noaa20', () => {
  assert.equal(supplier('2022-06', false, manifest), 'viirs');
  assert.equal(supplier('2022-07', true, manifest), 'noaa20');
});

test('supplier: estimated after S-NPP ends is noaa20 when covered, else modis; before S-NPP is modis', () => {
  assert.equal(supplier('2026-08', true, manifest), 'modis');
  assert.equal(supplier('2026-08', true, { ...manifest, coverage: { ...manifest.coverage, noaa20: ['2018-04', '2026-12'] } }), 'noaa20');
  assert.equal(supplier('2005-03', true, manifest), 'modis');
});
