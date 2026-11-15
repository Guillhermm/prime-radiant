import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harmonize } from '../../core/index.js';
import { exampleMonth, fromCore, monthAt, overlapRatio, sensorPoints, sensorsCsv, sensorsSummary as summaryOf } from './sensors-model.js';

const sensorsSummary = (s) => summaryOf(s, harmonize(s));

const series = (id, start, values) => ({ id, unit: 'fire-cell-days', start, values });
// 2011-11 to 2012-03: MODIS throughout, VIIRS from 2012-01.
const sample = () => ({
  modis: series('modis', '2011-11', [10, 20, 2, 0, 3]),
  viirs: series('viirs', '2011-11', [null, null, 6, 0, 9]),
});

test('monthAt rolls over years', () => {
  assert.equal(monthAt('2011-11', 2), '2012-01');
});

test('R is a ratio of sums over the months both sensors report; zero months count but are not "with detections"', () => {
  const r = overlapRatio(sample());
  assert.equal(r.r, 15 / 5);
  assert.equal(r.months, 3);
  assert.equal(r.withFire, 2);
  assert.equal(r.from, '2012-01');
  assert.equal(r.to, '2012-03');
});

test('no overlap or no MODIS fire in it leaves R null', () => {
  assert.equal(overlapRatio({ modis: series('modis', '2011-11', [1, 2]), viirs: series('viirs', '2011-11', [null, null]) }).r, null);
  assert.equal(overlapRatio({ modis: series('modis', '2012-01', [0, 0]), viirs: series('viirs', '2012-01', [4, 0]) }).r, null);
});

test('harmonized is core\'s series, not recomputed here: the value, the sensor it carries, null when neither flew', () => {
  const s = { modis: series('modis', '2011-11', [10, null, 2, null]), viirs: series('viirs', '2011-11', [null, null, 6, 7]) };
  assert.deepEqual(fromCore(s, harmonize(s)), [
    { value: 10, estimated: false, source: 'MODIS' }, { value: null, estimated: false, source: null },
    { value: 2, estimated: false, source: 'MODIS' }, { value: 7, estimated: false, source: 'VIIRS' },
  ]);
  const marked = { ...harmonize(s), values: [30, null, 6, 7], estimated: [true, false, false, false] };
  assert.deepEqual(fromCore(s, marked)[0], { value: 30, estimated: true, source: 'Adjusted by core' });
  assert.throws(() => fromCore(s, { ...harmonize(s), start: '2011-12' }), /does not align/);
});

test('the example month is the busiest one MODIS saw alone', () => {
  assert.deepEqual(exampleMonth(sample(), 3), { month: '2011-12', modis: 20, scaled: 60 });
  assert.equal(exampleMonth({ modis: series('modis', '2012-01', [1]), viirs: series('viirs', '2012-01', [1]) }, 1), null);
});

test('by year sums each sensor and marks a year estimated when any month is', () => {
  const s = sample();
  const marked = { ...harmonize(s), values: [30, 60, 6, 0, 9], estimated: [true, true, false, false, false] };
  const pts = sensorPoints(s, fromCore(s, marked), 'year');
  assert.deepEqual(pts.map((p) => [p.key, p.modis, p.viirs, p.harmonized, p.estimated]), [
    ['2011', 30, null, 90, true],
    ['2012', 5, 15, 15, false],
  ]);
  assert.equal(sensorPoints(s, fromCore(s, marked), 'month').length, 5);
});

test('summary states: ok, no overlap, no fire', () => {
  assert.equal(sensorsSummary(sample()).state, 'ok');
  assert.equal(sensorsSummary({ modis: series('modis', '2011-11', [1]), viirs: series('viirs', '2011-11', [null]) }).state, 'no-overlap');
  assert.equal(sensorsSummary({ modis: series('modis', '2012-01', [0]), viirs: series('viirs', '2012-01', [0]) }).state, 'no-fire');
});

test('CSV: three series by month with a Source column, R and the Preview note in the header', () => {
  const csv = sensorsCsv(sample(), harmonize(sample()), { dataVersion: 'synthetic-test' });
  const lines = csv.trim().split('\n');
  assert.ok(lines.includes('# R: 3 (Preview, explanatory only, not applied to the harmonized column)'));
  assert.ok(lines.includes('# harmonized: core method stub 0, the series the Calendar shows'));
  assert.ok(lines.includes('# dataVersion: synthetic-test'));
  assert.ok(lines.includes('month,modis,viirs,harmonized,source'));
  assert.ok(lines.includes('2011-11,10,,10,MODIS'));
  assert.ok(lines.includes('2012-02,0,0,0,MODIS'), '0 stays 0');
});
