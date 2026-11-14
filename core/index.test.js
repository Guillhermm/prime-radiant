import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seriesForAoi, harmonize, baseline, toCalendar, kpis, toCsv, validateSeries, validateCalendarCell } from './index.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = load('manifest.json');
const tiles = { '0.1/x0y13': load('tiles/0.1/x0y13.json'), '0.1/x12y7': load('tiles/0.1/x12y7.json'), '1/x12y7': load('tiles/1/x12y7.json') };
const aoi = [-60, -20, -50, -10];
const sensors = seriesForAoi(aoi, tiles, manifest);

test('seriesForAoi sums cells in the bbox and keeps null outside coverage', () => {
  assert.deepEqual(validateSeries(sensors.modis), []);
  assert.equal(sensors.modis.values.length, 156);
  assert.deepEqual(sensors.modis.values.slice(151, 154), [8, 18, 0]);
  assert.deepEqual(sensors.viirs.values.slice(151, 154), [12, 19, 0]);
  assert.equal(sensors.modis.values[0], null);
  assert.equal(sensors.modis.values[10], 0);
  assert.equal(sensors.viirs.values[144], null);
  assert.equal(sensors.viirs.values[145], 0);
});

test('seriesForAoi ignores cells outside the bbox and coarse tiles', () => {
  const small = seriesForAoi([-55.1, -15.2, -54.9, -15.0], tiles, manifest);
  assert.deepEqual(small.modis.values.slice(151, 153), [7, 15]);
  const none = seriesForAoi([10, 10, 11, 11], tiles, manifest);
  assert.equal(none.modis.values[151], 0);
});

test('seriesForAoi rejects a bad bbox', () => {
  assert.throws(() => seriesForAoi([10, 0, 5, 1], tiles, manifest), RangeError);
});

test('harmonize returns a stub Series', () => {
  const h = harmonize(sensors);
  assert.deepEqual(validateSeries(h), []);
  assert.equal(h.method.id, 'stub');
  assert.equal(h.values[151], 8);
  assert.equal(h.values[0], null);
});

test('baseline returns a stub Series with a same-month median', () => {
  const s = { ...sensors.modis, values: [null, 4, 6, 8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14] };
  const b = baseline({ ...s, start: '2000-01' });
  assert.deepEqual(validateSeries(b), []);
  assert.equal(b.method.id, 'stub');
  assert.equal(b.values[13], 4);
  assert.equal(b.values[14], 6);
  assert.equal(b.values[1], null);
});

test('toCalendar and kpis return valid stub shapes', () => {
  const h = harmonize(sensors);
  const cells = toCalendar(h, baseline(h));
  assert.equal(cells.length, 156);
  for (const c of cells) assert.deepEqual(validateCalendarCell(c), []);
  assert.equal(cells[0].status, 'no-data');
  assert.equal(cells[151].status, 'harmonized');
  assert.equal(cells[151].estimated, true);
  const k = kpis(cells);
  assert.equal(k.method.id, 'stub');
  assert.deepEqual(k.peak, { year: 2012, month: 9, value: 18 });
  assert.equal(k.total, 26);
  assert.equal(k.months, 156);
  assert.equal(k.noDataMonths, 10);
  assert.equal(kpis([]).peak, null);
});

test('toCsv writes a metadata header and a month,value table', () => {
  const csv = toCsv({ ...sensors.modis, start: '2012-08', values: [3, null, 0] }, { region: 'a\nb' });
  assert.equal(csv, [
    '# series: modis', '# unit: fire-cell-days', '# method: aggregate@1', '# comparable: false', '# region: a b',
    'month,value', '2012-08,3', '2012-09,', '2012-10,0', '',
  ].join('\n'));
});
