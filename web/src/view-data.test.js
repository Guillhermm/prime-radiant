import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildResult, sliceCells, sliceSeries, csvMeta, isSyntheticManifest } from './view-data.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const tiles = { '0.1/x12y7': fx('tiles/0.1/x12y7.json'), '0.1/x0y13': fx('tiles/0.1/x0y13.json') };

test('slices cells to the inclusive range', () => {
  const cells = [{ year: 2012, month: 7 }, { year: 2012, month: 8 }, { year: 2012, month: 9 }, { year: 2012, month: 10 }];
  assert.deepEqual(sliceCells(cells, '2012-08', '2012-09').map((c) => c.month), [8, 9]);
  assert.equal(sliceCells(cells, null, null).length, 4);
});

test('slices a series and moves its start', () => {
  const s = { id: 'x', start: '2000-01', values: Array.from({ length: 24 }, (_, i) => i) };
  const r = sliceSeries(s, '2000-03', '2000-05');
  assert.equal(r.start, '2000-03');
  assert.deepEqual(r.values, [2, 3, 4]);
  assert.deepEqual(sliceSeries(s, '1999-01', '2005-01').values.length, 24);
  assert.equal(sliceSeries(s, '2001-01', '2001-12').values.length, 12);
});

test('Mato Grosso fixture AOI: 2012-08 and 2012-09 match fixtures/README totals', () => {
  const r = buildResult({ bbox: [-60, -20, -50, -10], from: '2012-08', to: '2012-10', manifest, tiles });
  assert.deepEqual(r.cells.map((c) => c.month), [8, 9, 10]);
  // harmonized stub = MODIS where it has data: 8 and 18 (README AOI check), month 10 has no rows.
  assert.deepEqual(r.cells.map((c) => c.value), [8, 18, 0]);
  assert.equal(r.kpis.total, 26);
  assert.equal(r.aoiCells, 100 * 100);
  assert.equal(r.series.start, '2012-08');
});

test('months outside coverage stay null, not zero', () => {
  const r = buildResult({ bbox: [-60, -20, -50, -10], from: '2000-01', to: '2000-02', manifest, tiles });
  assert.deepEqual(r.cells.map((c) => c.value), [null, null]);
  assert.equal(r.kpis.noDataMonths, 2);
});

test('csv meta names region, range and data version', () => {
  const r = buildResult({ bbox: [-60, -20, -50, -10], from: null, to: null, manifest, tiles });
  const m = csvMeta(r);
  assert.match(m.region, /-60,-20,-50,-10/);
  assert.equal(m.range, '2000-01 to 2012-12');
  assert.equal(m.dataVersion, 'fixture-1');
});

test('a synthetic-* dataVersion marks the manifest synthetic', () => {
  assert.equal(isSyntheticManifest({ dataVersion: 'synthetic-20261114' }), true);
  assert.equal(isSyntheticManifest(manifest), false);
  assert.equal(isSyntheticManifest(null), false);
});
