import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harmonize } from '../../core/index.js';
import { fromCore, monthAt, sensorPoints, sensorsSummary } from './sensors-model.js';

const series = (id, start, values) => ({ id, unit: 'fire-cell-days', start, values, method: { id: 'raw', version: 1 }, comparable: false });
const months = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// 2010-01 to 2013-12: MODIS throughout; S-NPP 2012-01 to 2013-06 at twice MODIS; NOAA-20 from 2012-07, equal to S-NPP.
const sample = () => {
  const m = months(48, (i) => 10 + (i % 12));
  const sensors = {
    modis: series('modis', '2010-01', m),
    viirs: series('viirs', '2010-01', m.map((v, i) => (i >= 24 && i <= 41 ? 2 * v : null))),
    noaa20: series('noaa20', '2010-01', m.map((v, i) => (i >= 30 ? 2 * v : null))),
  };
  const manifest = {
    month0: '2010-01', last_month: '2013-12',
    coverage: { modis: ['2010-01', '2013-12'], viirs: ['2012-01', '2013-06'], noaa20: ['2012-07', '2013-12'] },
    partial_months: { modis: [], viirs: [], noaa20: [] },
  };
  return { sensors, manifest, h: harmonize([{ level: 'aoi', ...sensors }], manifest) };
};

test('monthAt rolls over years', () => {
  assert.equal(monthAt('2011-11', 2), '2012-01');
});

test('fromCore names the source of every month of core\'s series: MODIS × R, S-NPP, NOAA-20 × K', () => {
  const { sensors, manifest, h } = sample();
  const m = fromCore(sensors, h, manifest);
  assert.deepEqual([m[0].source, m[24].source, m[42].source], ['MODIS × R', 'S-NPP', 'NOAA-20 × K']);
  assert.deepEqual([m[0].estimated, m[24].estimated, m[42].estimated], [true, false, true]);
  assert.equal(m[0].value, h.series.values[0]);
  assert.equal(m[0].value, 20, 'R = 2 here, applied by core');
  assert.equal(m[42].value, 2 * (10 + 6), 'NOAA-20 × K with K = 1');
  assert.deepEqual(m[42].factor, { name: 'K', value: 1 });
  assert.throws(() => fromCore({ ...sensors, modis: { ...sensors.modis, start: '2009-01' } }, h, manifest), /does not align/);
});

test('summary: core R and K, the overlap span, the busiest month scaled from MODIS and from NOAA-20', () => {
  const { sensors, manifest, h } = sample();
  const s = sensorsSummary(sensors, h, manifest);
  assert.equal(s.R.value, 2);
  assert.equal(s.K.value, 1);
  assert.equal(s.state, 'ok');
  assert.deepEqual(s.overlap, { from: '2012-01', to: '2013-06' });
  assert.deepEqual(s.example, { month: '2010-12', count: 21, core: 42, factor: { name: 'R', value: 2 } });
  assert.deepEqual(s.kExample, { month: '2013-12', count: 42, core: 42, factor: { name: 'K', value: 1 } });
  const none = { ...sensors, modis: { ...sensors.modis, values: sensors.modis.values.map(() => 0) } };
  assert.equal(sensorsSummary(none, harmonize([{ level: 'aoi', ...none }], manifest), manifest).state, 'no-r');
});

test('points by year sum each sensor and mark a year estimated when any month is', () => {
  const { sensors, manifest, h } = sample();
  const ms = fromCore(sensors, h, manifest);
  const years = sensorPoints(sensors, ms, 'year');
  assert.deepEqual(years.map((p) => p.key), ['2010', '2011', '2012', '2013']);
  assert.equal(years[0].viirs, null);
  assert.equal(years[0].noaa20, null);
  assert.equal(years[0].harmonized, 2 * years[0].modis);
  assert.deepEqual(years[3].sources, ['S-NPP', 'NOAA-20 × K']);
  assert.equal(years[3].estimated, true);
  assert.equal(years[2].estimated, false);
  assert.equal(sensorPoints(sensors, ms, 'month').length, 48);
});
