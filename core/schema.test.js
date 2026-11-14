import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, validateTile, validateSeries, validateCalendarCell } from './schema.js';

const manifest = JSON.parse(readFileSync(new URL('../fixtures/manifest.json', import.meta.url), 'utf8'));
const codes = (errs) => errs.map((e) => e.code);
const tile = () => ({ cell: [0, 1], month: [0, 2], modis: [1, 0], viirs: [null, 3], noaa20: [null, null] });
const series = (o = {}) => ({ id: 'modis', unit: 'fire-cell-days', start: '2023-01', values: [1, 0, 2],
  method: { id: 'raw', version: 1 }, comparable: true, ...o });
const cell = (o = {}) => ({ year: 2023, month: 2, value: 3, status: 'observed', estimated: false, ...o });

test('manifest: fixture is valid', () => assert.deepEqual(validateManifest(manifest), []));
test('manifest: errors are named', () => {
  assert.deepEqual(codes(validateManifest(null)), ['NOT_OBJECT']);
  const bad = { ...manifest, schema: 2, month0: '2023-13', granularity: 'day', tiles: ['a'], grid: { res: 0.5 },
    coverage: { modis: ['2023-02', '2023-01'], viirs: [] }, caveats: 'x' };
  const c = codes(validateManifest(bad));
  for (const code of ['BAD_SCHEMA_VERSION', 'BAD_MONTH', 'BAD_GRANULARITY', 'BAD_TILES', 'BAD_GRID', 'BAD_COVERAGE', 'BAD_CAVEATS']) {
    assert.ok(c.includes(code), code);
  }
  assert.ok(codes(validateManifest({ ...manifest, last_month: '2022-12' })).includes('BAD_SPAN'));
  assert.ok(codes(validateManifest({ ...manifest, tiles: ['x1y1', 'x1y1'] })).includes('DUPLICATE_TILE'));
  assert.ok(codes(validateManifest({ ...manifest, tiles: ['x36y0'] })).includes('BAD_TILES'));
});

test('tile: valid, null vs 0 both accepted', () => assert.deepEqual(validateTile(tile(), { manifest }), []));
test('tile: null vs 0 follows sensor coverage (null = not operating, 0 = none detected)', () => {
  // VIIRS coverage starts at month index 2 in the fixture manifest.
  assert.deepEqual(codes(validateTile({ ...tile(), viirs: [null, null] }, { manifest })), ['NULL_INSIDE_COVERAGE']);
  assert.deepEqual(codes(validateTile({ ...tile(), viirs: [0, 3] }, { manifest })), ['COUNT_OUTSIDE_COVERAGE']);
  assert.deepEqual(codes(validateTile({ ...tile(), modis: [null, 0] }, { manifest })), ['NULL_INSIDE_COVERAGE']);
  assert.deepEqual(validateTile({ ...tile(), viirs: [0, 3] }), []); // no manifest, no coverage check
});
test('tile: noaa20 follows its own coverage (index 4..5 in the fixture)', () => {
  const t = { ...tile(), month: [4, 5], viirs: [2, 3], noaa20: [0, 1] };
  assert.deepEqual(validateTile(t, { manifest }), []);
  assert.deepEqual(codes(validateTile({ ...t, noaa20: [null, 1] }, { manifest })), ['NULL_INSIDE_COVERAGE']);
  assert.deepEqual(codes(validateTile({ ...tile(), noaa20: [0, null] }, { manifest })), ['COUNT_OUTSIDE_COVERAGE']);
  const { noaa20, ...old } = tile();
  assert.deepEqual(codes(validateTile(old)), ['NOT_ARRAY']);
});
test('manifest: coverage.noaa20 and partial_months are required and checked', () => {
  const { noaa20, ...cov } = manifest.coverage;
  assert.ok(codes(validateManifest({ ...manifest, coverage: cov })).includes('BAD_COVERAGE'));
  const { partial_months, ...rest } = manifest;
  assert.deepEqual(codes(validateManifest(rest)), ['BAD_PARTIAL_MONTHS']);
  const bad = { ...manifest, partial_months: { modis: ['2023-6'], viirs: [], noaa20: 'x' } };
  assert.deepEqual(validateManifest(bad).map((e) => e.path), ['partial_months.modis', 'partial_months.noaa20']);
});
test('tile: column length mismatch', () => {
  const t = tile(); t.viirs.pop();
  assert.deepEqual(codes(validateTile(t)), ['COLUMN_LENGTH_MISMATCH']);
});
test('tile: negative, fractional and non-numeric counts', () => {
  const t = tile(); t.modis = [-1, 0.5]; t.viirs = ['3', undefined];
  assert.deepEqual(codes(validateTile(t)), ['BAD_COUNT', 'BAD_COUNT', 'BAD_COUNT', 'BAD_COUNT']);
});
test('tile: month index within manifest span only when manifest given', () => {
  const t = tile(); t.month = [0, 6];
  assert.deepEqual(codes(validateTile(t, { manifest })), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(validateTile(t), []);
  t.month = [0, -1];
  assert.deepEqual(codes(validateTile(t)), ['BAD_MONTH_INDEX']);
});
test('tile: cell range depends on resolution, duplicates rejected, error has path', () => {
  const t = tile(); t.cell = [100, 1];
  assert.deepEqual(validateTile(t, { res: 1 })[0].path, 'cell[0]');
  assert.deepEqual(validateTile(t), []);
  t.cell = [10000, 1];
  assert.deepEqual(codes(validateTile(t)), ['CELL_OUT_OF_RANGE']);
  assert.deepEqual(codes(validateTile({ ...tile(), cell: [1, 1], month: [0, 0] })), ['DUPLICATE_ROW']);
  assert.deepEqual(codes(validateTile({ cell: [] })), ['NOT_ARRAY', 'NOT_ARRAY', 'NOT_ARRAY', 'NOT_ARRAY']);
});

test('series: valid', () => assert.deepEqual(validateSeries(series(), { manifest }), []));
test('series: null vs 0 against sensor coverage (viirs covers months 2..5)', () => {
  const v = (values, start = '2023-01') => validateSeries(series({ id: 'viirs', start, values }), { manifest });
  assert.deepEqual(v([null, null, 0, 3, 0, 1]), []);
  assert.deepEqual(v([null, null, 0, 3, 0, null]).map((x) => [x.code, x.path]), [['NULL_INSIDE_COVERAGE', 'values[5]']]);
  assert.deepEqual(v([0, null, 0, 0, 0, 0]).map((x) => [x.code, x.path]), [['COUNT_OUTSIDE_COVERAGE', 'values[0]']]);
  assert.deepEqual(codes(v([null, 2, 0])), ['COUNT_OUTSIDE_COVERAGE']);
  assert.deepEqual(codes(v([null, 0], '2023-02')), []); // month 1 null outside, month 2 is 0 inside
  assert.deepEqual(codes(validateSeries(series({ values: [1, null, 0] }), { manifest })), ['NULL_INSIDE_COVERAGE']);
  assert.deepEqual(validateSeries(series({ id: 'viirs', values: [0, 1] })), []); // no manifest: no coverage check
  assert.deepEqual(validateSeries(series({ id: 'harmonized', values: [null, 1.5] }), { manifest }), []);
});
test('series: raw sensor counts must be integers >= 0; harmonized may be fractional', () => {
  assert.deepEqual(codes(validateSeries(series({ values: [-1, 0.5] }))), ['BAD_VALUE', 'BAD_VALUE']);
  assert.deepEqual(validateSeries(series({ id: 'harmonized', values: [0.5, 12.25, null] })), []);
  assert.deepEqual(codes(validateSeries(series({ id: 'harmonized', values: [NaN] }))), ['BAD_VALUE']);
});
test('series: header fields', () => {
  const c = codes(validateSeries(series({ id: 'x', unit: 'm', start: '2023', method: {}, comparable: 1 })));
  for (const code of ['BAD_SERIES_ID', 'BAD_UNIT', 'BAD_MONTH', 'BAD_METHOD', 'BAD_COMPARABLE']) assert.ok(c.includes(code), code);
});
test('series: span checked against manifest', () => {
  assert.deepEqual(codes(validateSeries(series({ start: '2023-05', values: [1, 2, 3] }), { manifest })), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(codes(validateSeries(series({ start: '2022-12' }), { manifest })), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(validateSeries(series({ start: '2023-05', values: [1, 2, 3] })), []);
  assert.deepEqual(validateSeries(series({ id: 'live', start: '2026-11', values: [1] }), { manifest }), []);
});

test('calendar cell: valid, zero is observed, no-data needs null', () => {
  assert.deepEqual(validateCalendarCell(cell(), { manifest }), []);
  assert.deepEqual(validateCalendarCell(cell({ value: 0 })), []);
  assert.deepEqual(validateCalendarCell(cell({ value: null, status: 'no-data' })), []);
  assert.deepEqual(codes(validateCalendarCell(cell({ value: 0, status: 'no-data' }))), ['STATUS_VALUE_MISMATCH']);
  assert.deepEqual(codes(validateCalendarCell(cell({ value: null }))), ['STATUS_VALUE_MISMATCH']);
});
test('calendar cell: field errors and span', () => {
  const c = codes(validateCalendarCell({ year: 2023.5, month: 13, value: -1, status: 'x', estimated: 'no', median: 'a' }));
  for (const code of ['BAD_YEAR', 'BAD_MONTH', 'BAD_VALUE', 'BAD_STATUS', 'BAD_ESTIMATED']) assert.ok(c.includes(code), code);
  assert.deepEqual(codes(validateCalendarCell(cell({ year: 2023, month: 7 }), { manifest })), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(codes(validateCalendarCell(cell({ year: 2022, month: 12 }), { manifest })), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(codes(validateCalendarCell('x')), ['NOT_OBJECT']);
});

test('manifest: null coverage for a sensor with no records; its tile and series values must be null', () => {
  const m = { ...manifest, coverage: { ...manifest.coverage, noaa20: null }, partial_months: { ...manifest.partial_months, noaa20: [] } };
  assert.deepEqual(validateManifest(m), []);
  assert.deepEqual(validateTile(tile(), { manifest: m }), []);
  assert.deepEqual(codes(validateTile({ ...tile(), noaa20: [0, null] }, { manifest: m })), ['COUNT_OUTSIDE_COVERAGE']);
  assert.ok(codes(validateManifest({ ...m, coverage: { ...m.coverage, modis: undefined } })).includes('BAD_COVERAGE'));
});
test('manifest: domain is optional; when present it must be {id, version, file, res:0.1}', () => {
  const { domain, ...without } = manifest;
  assert.deepEqual(validateManifest(without), []);
  assert.deepEqual(validateManifest({ ...manifest, domain }), []);
  for (const bad of [{ ...domain, res: 1 }, { ...domain, file: '' }, { ...domain, id: 3 }, 'x']) {
    assert.deepEqual(codes(validateManifest({ ...manifest, domain: bad })), ['BAD_DOMAIN']);
  }
});

test('series: outside-domain skips coverage but must be all null', () => {
  const flags = [{ month: null, flag: 'outside-domain' }];
  assert.deepEqual(validateSeries(series({ values: [null, null, null], flags }), { manifest }), []);
  assert.deepEqual(codes(validateSeries(series({ values: [null, 0, null], flags }))), ['VALUE_OUTSIDE_DOMAIN']);
});
