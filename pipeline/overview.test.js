import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, fullYear, pickHotspots, pickSource } from './overview.js';
import { validateOverview } from '../core/schema.js';
import { cellId } from '../core/grid.js';
import { monthIndex } from '../core/months.js';

const manifest = (over = {}) => ({
  dataVersion: 't1', month0: '2024-01', last_month: '2025-12',
  coverage: { modis: ['2024-01', '2025-12'], viirs: ['2024-01', '2025-12'], noaa20: ['2024-06', '2025-12'] },
  partial_months: { modis: [], viirs: ['2024-05', '2025-03'], noaa20: [] },
  ...over,
});
const idx = (ym) => monthIndex(ym) - monthIndex('2024-01');
// Two 1 deg cells of tile x12y8 (lon -60..-50, lat -10..0): (-56, -3) and (-51, -9).
const a = cellId(-55.5, -2.5, 1);
const b = cellId(-50.5, -8.5, 1);
const coarse = {
  x12y8: {
    cell: [a, a, a, b, b],
    month: [idx('2024-12'), idx('2025-01'), idx('2025-12'), idx('2025-06'), idx('2026-01') - 1],
    modis: [1, 1, 1, 1, 1],
    viirs: [100, 7, 5, 3, 4],
    noaa20: [null, 9, 9, 9, 9],
  },
};

test('fullYear: the newest calendar year the sensor covers in the span; none when no year is whole', () => {
  assert.equal(fullYear(manifest(), 'viirs'), 2025);
  assert.equal(fullYear(manifest({ last_month: '2025-11' }), 'viirs'), 2024);
  assert.equal(fullYear(manifest({ coverage: { viirs: ['2024-02', '2025-06'] } }), 'viirs'), null);
  assert.equal(fullYear(manifest({ coverage: { viirs: null } }), 'viirs'), null);
});

test('pickSource: S-NPP on a tie, NOAA-20 once it has the newer full year', () => {
  assert.deepEqual(pickSource(manifest()), { sensor: 'viirs', year: 2025 });
  const ended = manifest({ month0: '2024-01', last_month: '2026-12', coverage: { viirs: ['2024-01', '2026-10'], noaa20: ['2024-01', '2026-12'] } });
  assert.deepEqual(pickSource(ended), { sensor: 'noaa20', year: 2026 });
});

test('buildOverview sums one sensor over the year into [west, south, value] cells, schema-valid', () => {
  const o = buildOverview(manifest(), coarse);
  assert.equal(o.sensor, 'viirs');
  assert.equal(o.year, 2025);
  assert.deepEqual(o.cells, [[-51, -9, 7], [-56, -3, 12]]);
  assert.deepEqual(o.partial_months, ['2025-03']);
  assert.deepEqual(o.hotspots, [{ bbox: [-56, -3, -55, -2], value: 12 }, { bbox: [-51, -9, -50, -8], value: 7 }]);
  assert.deepEqual(validateOverview(o), []);
});

test('buildOverview returns null when no VIIRS sensor covers a full year', () => {
  assert.equal(buildOverview(manifest({ last_month: '2024-11', coverage: { viirs: ['2024-01', '2024-11'], noaa20: null } }), coarse), null);
});

test('pickHotspots: ranked, cells closer than 3 degrees on both axes are skipped, zeros never listed', () => {
  const cells = [[0, 0, 50], [2, 2, 40], [3, 0, 30], [0, -3, 20], [10, 10, 0]];
  assert.deepEqual(pickHotspots(cells).map((h) => h.bbox.slice(0, 2)), [[0, 0], [3, 0], [0, -3]]);
  assert.equal(pickHotspots(cells, { n: 1 }).length, 1);
});

test('validateOverview names bad cells, duplicates and an unranked list', () => {
  const ok = buildOverview(manifest(), coarse);
  const codes = (o) => validateOverview(o).map((e) => e.code);
  assert.deepEqual(codes({ ...ok, cells: [[-56, -3, 1.5]] }), ['BAD_CELL']);
  assert.deepEqual(codes({ ...ok, cells: [[-56, -3, 1], [-56, -3, 2]] }), ['DUPLICATE_CELL']);
  assert.deepEqual(codes({ ...ok, hotspots: [...ok.hotspots].reverse() }), ['HOTSPOTS_NOT_RANKED']);
  assert.deepEqual(codes({ ...ok, hotspots: [{ bbox: [-56, -3, -54, -2], value: 3 }] }), ['BAD_HOTSPOT']);
  assert.deepEqual(codes({ ...ok, partial_months: ['2024-05'] }), ['BAD_FIELD']);
  assert.deepEqual(codes(null), ['NOT_OBJECT']);
});
