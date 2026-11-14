import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, validateTile, validateSeries, validateCalendarCell } from './schema.js';

const manifest = () => ({
  schema: 1, dataVersion: 'v1', generated_at: '2026-11-14T00:00:00Z', base_url: 'x/',
  grid: { res: 0.1, tile_deg: 10, coarse_res: 1 }, month0: '2000-01', last_month: '2012-12', granularity: 'month',
  coverage: { modis: ['2000-11', '2012-12'], viirs: ['2012-02', '2012-12'] }, satellites: {},
  tiles: ['0.1/x0y13'], citation: 'c', caveats: [],
});
const tile = () => ({ cell: [1, 2], month: [0, 1], modis: [3, null], viirs: [0, 4] });
const series = () => ({ id: 'modis', unit: 'fire-cell-days', start: '2012-08', values: [1, null, 0], method: { id: 'm', version: '1' }, comparable: false });
const codes = (errors) => errors.map((e) => e.code);

test('valid manifest, tile, series and cell pass', () => {
  assert.deepEqual(validateManifest(manifest()), []);
  assert.deepEqual(validateTile(tile(), { monthCount: 2 }), []);
  assert.deepEqual(validateSeries(series()), []);
  assert.deepEqual(validateCalendarCell({ year: 2012, month: 8, value: null, status: 'no-data', estimated: false }), []);
});

test('manifest errors are named', () => {
  const m = manifest();
  m.schema = 2;
  m.last_month = '1999-12';
  m.coverage.viirs = ['2012-02', '2013-01'];
  m.tiles = ['bad'];
  assert.deepEqual(codes(validateManifest(m)).sort(), ['manifest.coverage', 'manifest.coverage', 'manifest.month-order', 'manifest.schema', 'manifest.tiles'].sort());
  assert.deepEqual(codes(validateManifest(null)), ['manifest.not-object']);
});

test('tile with mismatched column lengths fails', () => {
  const t = tile();
  t.viirs.pop();
  assert.deepEqual(codes(validateTile(t)), ['tile.length-mismatch']);
});

test('tile with a month out of range fails', () => {
  const t = tile();
  t.month[1] = 2;
  assert.deepEqual(codes(validateTile(t, { monthCount: 2 })), ['tile.month-out-of-range']);
  t.month[1] = -1;
  assert.deepEqual(codes(validateTile(t)), ['tile.month-out-of-range']);
});

test('tile with a negative or fractional count fails', () => {
  const t = tile();
  t.modis[0] = -1;
  t.viirs[1] = 1.5;
  assert.deepEqual(codes(validateTile(t)), ['tile.negative-count', 'tile.not-integer']);
});

test('tile cell range depends on resolution, duplicates and missing columns are caught', () => {
  assert.deepEqual(codes(validateTile({ cell: [404], month: [0], modis: [1], viirs: [1] }, { cellsPerSide: 10 })), []);
  assert.deepEqual(codes(validateTile({ cell: [1010], month: [0], modis: [1], viirs: [1] }, { cellsPerSide: 10 })), ['tile.cell-out-of-range']);
  assert.deepEqual(codes(validateTile({ cell: [10000], month: [0], modis: [1], viirs: [1] })), ['tile.cell-out-of-range']);
  assert.deepEqual(codes(validateTile({ cell: [1, 1], month: [0, 0], modis: [1, 1], viirs: [1, 1] })), ['tile.duplicate-row']);
  assert.deepEqual(codes(validateTile({ cell: [] })), ['tile.missing-column', 'tile.missing-column', 'tile.missing-column']);
});

test('tile null must match sensor coverage', () => {
  const coverage = { modis: [0, 1], viirs: [1, 1] };
  assert.deepEqual(codes(validateTile({ cell: [1, 1], month: [0, 1], modis: [0, 2], viirs: [null, 0] }, { coverage })), []);
  assert.deepEqual(codes(validateTile({ cell: [1, 1], month: [0, 1], modis: [null, 2], viirs: [0, 0] }, { coverage })),
    ['tile.null-vs-coverage', 'tile.null-vs-coverage']);
});

test('series errors are named', () => {
  const s = series();
  s.id = 'x';
  s.unit = 'pixels';
  s.values = [1, undefined];
  s.comparable = 'no';
  assert.deepEqual(codes(validateSeries(s)).sort(), ['series.comparable', 'series.id', 'series.unit', 'series.values']);
});

test('calendar cell errors are named', () => {
  const c = { year: 2012, month: 13, value: 5, status: 'no-data', estimated: false };
  assert.deepEqual(codes(validateCalendarCell(c)), ['cell.month', 'cell.no-data-value']);
  assert.deepEqual(codes(validateCalendarCell({ year: 2012, month: 8, value: null, status: 'observed', estimated: false })), ['cell.null-needs-no-data']);
});
