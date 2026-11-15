import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { satelliteSpans } from './satellites.js';

const golden = JSON.parse(readFileSync(new URL('../../fixtures/golden/manifest.json', import.meta.url), 'utf8'));

test('spans come from coverage and the Aqua era, in the pipeline manifest shape', () => {
  const m = {
    coverage: { modis: ['2000-11', '2026-08'], viirs: ['2012-01', '2026-07'], noaa20: ['2018-04', '2026-07'] },
    satellites: { modis: ['Terra', 'Aqua'], viirs: ['S-NPP'], noaa20: ['NOAA-20'], eras: { modis_aqua_from: '2002-07-04' } },
  };
  assert.deepEqual(satelliteSpans(m), [
    { family: 'modis', name: 'Terra', from: '2000-11', to: '2026-08' },
    { family: 'modis', name: 'Aqua', from: '2002-07', to: '2026-08' },
    { family: 'viirs', name: 'S-NPP', from: '2012-01', to: '2026-07' },
    { family: 'noaa20', name: 'NOAA-20', from: '2018-04', to: '2026-07' },
  ]);
});

test('an era before the coverage starts at the coverage', () => {
  assert.deepEqual(satelliteSpans(golden).map((s) => [s.name, s.from]), [['Terra', '2023-01'], ['Aqua', '2023-01'], ['S-NPP', '2023-03'], ['NOAA-20', '2023-05']]);
});

test('a family with null coverage or no names has no span; no manifest gives none', () => {
  assert.deepEqual(satelliteSpans({ ...golden, coverage: { ...golden.coverage, noaa20: null } }).map((s) => s.name), ['Terra', 'Aqua', 'S-NPP']);
  assert.deepEqual(satelliteSpans(null), []);
  assert.deepEqual(satelliteSpans({ coverage: { modis: ['2000-11', '2001-01'] }, satellites: {} }), []);
});
