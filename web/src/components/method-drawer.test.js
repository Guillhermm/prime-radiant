import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANCE_ACKNOWLEDGMENT, STEPS, TIMELINE, methodModel, statusText, timelineModel } from './method-drawer.js';
import { NO_GATES } from '../../../core/caveats.js';

const manifest = {
  dataVersion: 'v1', citation: 'FIRMS cite', last_month: '2025-12',
  coverage: { modis: ['2000-11', '2025-12'], viirs: ['2012-01', '2025-12'], noaa20: ['2018-04', '2025-12'] },
  satellites: { modis: ['Terra', 'Aqua'], viirs: ['S-NPP'], noaa20: ['NOAA-20'], eras: { modis_aqua_from: '2002-07-04' } },
  domain: { id: 'ne10m-brazil', version: '5.1.2', file: 'domain.json', res: 0.1 },
};

test('model carries unit, grid assumption, sensor dates, domain, citation and acknowledgment', () => {
  const m = methodModel(manifest);
  assert.match(m.unit, /fire-cell-day/);
  assert.match(m.grid, /0\.1 degree/);
  assert.deepEqual(m.sensors.map((s) => s.label), ['MODIS', 'VIIRS S-NPP', 'VIIRS NOAA-20']);
  assert.deepEqual(m.sensors[0], { label: 'MODIS', text: '2000-11 to 2025-12 (Terra from 2000-11, Aqua from 2002-07)' });
  assert.match(m.domain, /ne10m-brazil, version 5\.1\.2/);
  assert.equal(m.citation, 'FIRMS cite');
  assert.equal(m.acknowledgment, LANCE_ACKNOWLEDGMENT);
  assert.equal(m.version, 'v1');
  assert.equal(m.method, 'ratio-of-sums, version 1');
});

test('gate V1 passed: no Preliminary badge, a validated status, core caveats with only live data and the global extent preliminary', () => {
  const m = methodModel(manifest);
  assert.equal(m.preliminary, false);
  assert.match(m.status, /validated by the science team \(gate V1/);
  assert.equal(m.caveats.length, 10);
  assert.deepEqual(m.caveats.filter((c) => c.preliminary).map((c) => c.id), ['nrt-unfiltered', 'global-extent']);
  assert.equal(methodModel(manifest, { gates: NO_GATES }).preliminary, true);
  assert.match(statusText(NO_GATES), /preliminary/);
});

test('manifest acknowledgment wins and absent fields are skipped', () => {
  assert.equal(methodModel({ acknowledgment: 'x' }).acknowledgment, 'x');
  const m = methodModel({});
  assert.deepEqual(m.sensors, []);
  assert.deepEqual(methodModel(null).sensors, []);
  assert.equal(m.citation, null);
  assert.equal(m.domain, null);
});

test('timeline: one bar per satellite from its first to its last month, the overlap at the VIIRS start', () => {
  const m = { ...manifest, coverage: { ...manifest.coverage, viirs: ['2012-01', '2024-12'] } };
  const t = timelineModel(m);
  assert.deepEqual(t.rows.map((r) => r.label), ['Terra · MODIS · Nov 2000 to Dec 2025', 'Aqua · MODIS · Jul 2002 to Dec 2025', 'S-NPP · VIIRS · Jan 2012 to Dec 2024', 'NOAA-20 · VIIRS · Apr 2018 to Dec 2025']);
  assert.ok(t.rows[0].x0 < t.rows[1].x0 && t.rows[1].x0 < t.rows[2].x0);
  assert.equal(t.rows[0].x1, TIMELINE.width);
  assert.ok(t.rows[2].x1 < TIMELINE.width, 'S-NPP ends before the record does');
  assert.ok(Math.abs(t.overlap - t.rows[2].x0) < 1e-9);
  assert.equal(timelineModel({}), null);
  const narrow = timelineModel(m, 364);
  assert.equal(narrow.width, 364, 'drawn at the rendered width so CSS text sizes are real pixels');
  assert.equal(narrow.rows[0].x1, 364);
});

test('drawer steps follow the validated method; synthetic note only for synthetic data', () => {
  assert.deepEqual(STEPS.map((s) => s.title), ['Count fire-cell-days', 'Scale MODIS to VIIRS-equivalent', 'Continue after S-NPP', 'Compare with the median']);
  assert.match(STEPS[1].text, /2012 to 2021/);
  assert.equal(methodModel(manifest).synthetic, null);
  assert.match(methodModel({ dataVersion: 'synthetic-1' }).synthetic.sentence, /not real fire detections/);
});
