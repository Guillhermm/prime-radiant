import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLiveManifest, validateLiveTile } from './schema.js';

const gold = (p) => JSON.parse(readFileSync(new URL(`../fixtures/golden/live/${p}`, import.meta.url), 'utf8'));
const manifest = () => gold('manifest.json');
const tile = () => gold('tiles/0.1/x17y13.json');
const codes = (errs) => errs.map((e) => e.code);

test('the golden live manifest and tile are valid', () => {
  assert.deepEqual(validateLiveManifest(manifest()), []);
  assert.deepEqual(validateLiveTile(tile(), { manifest: manifest() }), []);
});

test('live manifest: bad kind, fetch time, days, coverage, sources', () => {
  const bad = (o) => codes(validateLiveManifest({ ...manifest(), ...o }));
  assert.deepEqual(validateLiveManifest(null).map((e) => e.code), ['NOT_OBJECT']);
  assert.ok(bad({ kind: 'archive' }).includes('BAD_KIND'));
  assert.ok(bad({ granularity: 'month' }).includes('BAD_GRANULARITY'));
  assert.ok(bad({ fetched_at: '2026-11-12' }).includes('BAD_FETCHED_AT'));
  assert.ok(bad({ day0: '2026-02-30' }).includes('BAD_DAY'));
  assert.ok(bad({ day0: '2026-11-13' }).includes('DAY_ORDER'));
  assert.ok(bad({ coverage: { ...manifest().coverage, modis: ['2026-11-01', '2026-11-12'] } }).includes('COVERAGE_OUT_OF_SPAN'));
  assert.ok(bad({ coverage: { ...manifest().coverage, viirs: ['2026-11-12', '2026-11-11'] } }).includes('BAD_COVERAGE'));
  assert.ok(bad({ partial_days: { modis: ['2027-01-01'], viirs: [], noaa20: [] } }).includes('BAD_PARTIAL_DAYS'));
  assert.ok(bad({ sources: [] }).includes('BAD_SOURCES'));
  assert.ok(bad({ tiles: ['nope'] }).includes('BAD_TILES'));
  assert.deepEqual(bad({ coverage: { modis: null, viirs: null, noaa20: null } }), []);
});

test('live tile: a partial day must be null and is allowed to be null inside coverage', () => {
  const m = { ...manifest(), partial_days: { modis: ['2026-11-11'], viirs: [], noaa20: [] } };
  const t = tile(); // row 1 and 3 are day 1 (2026-11-11)
  assert.ok(codes(validateLiveTile(t, { manifest: m })).includes('COUNT_ON_PARTIAL_DAY'));
  t.modis[1] = null; t.modis[3] = null;
  assert.deepEqual(validateLiveTile(t, { manifest: m }), []);
});

test('live tile: null/0 rule against day coverage, span and duplicates', () => {
  const t = (f) => { const x = tile(); f(x); return codes(validateLiveTile(x, { manifest: manifest() })); };
  assert.ok(t((x) => { x.viirs[1] = null; }).includes('NULL_INSIDE_COVERAGE'));
  assert.ok(t((x) => { x.viirs[0] = 0; }).includes('COUNT_OUTSIDE_COVERAGE'));
  assert.ok(t((x) => { x.day[0] = 3; }).includes('DAY_OUT_OF_RANGE'));
  assert.ok(t((x) => { x.day[1] = 0; }).includes('DUPLICATE_ROW'));
  assert.ok(t((x) => { x.modis[0] = 1.5; }).includes('BAD_COUNT'));
  assert.ok(t((x) => { x.cell[0] = 10000; }).includes('CELL_OUT_OF_RANGE'));
  assert.ok(t((x) => { x.noaa20.pop(); }).includes('COLUMN_LENGTH_MISMATCH'));
  assert.deepEqual(codes(validateLiveTile({ cell: [0], month: [0] })).slice(0, 1), ['NOT_ARRAY']);
});
