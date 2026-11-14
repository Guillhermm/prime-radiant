import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANCE_ACKNOWLEDGMENT, methodModel } from './method-drawer.js';

const manifest = {
  dataVersion: 'v1', citation: 'FIRMS cite',
  coverage: { modis: ['2000-11', '2012-12'], viirs: ['2012-02', '2012-12'] },
  satellites: { modis: [{ name: 'Terra', from: '2000-11' }, { name: 'Aqua', from: '2002-07' }], viirs: [{ name: 'S-NPP', from: '2012-02' }] },
};

test('model carries unit, grid assumption, sensor dates, citation and acknowledgment', () => {
  const m = methodModel(manifest);
  assert.match(m.unit, /fire-cell-day/);
  assert.match(m.grid, /0\.1 degree/);
  assert.deepEqual(m.sensors[0], { label: 'MODIS', text: '2000-11 to 2012-12 (Terra from 2000-11, Aqua from 2002-07)' });
  assert.equal(m.citation, 'FIRMS cite');
  assert.equal(m.acknowledgment, LANCE_ACKNOWLEDGMENT);
  assert.equal(m.version, 'v1');
});

test('manifest acknowledgment wins and absent fields are skipped', () => {
  assert.equal(methodModel({ acknowledgment: 'x' }).acknowledgment, 'x');
  const m = methodModel({});
  assert.deepEqual(m.sensors, []);
  assert.deepEqual(methodModel(null).sensors, []);
  assert.equal(m.citation, null);
});

test('timeline: one bar per satellite from its first month, the overlap at the VIIRS start', async () => {
  const { timelineModel, TIMELINE } = await import('./method-drawer.js');
  const t = timelineModel({ ...manifest, last_month: '2012-12' });
  assert.deepEqual(t.rows.map((r) => r.label), ['Terra · MODIS · since Nov 2000', 'Aqua · MODIS · since Jul 2002', 'S-NPP · VIIRS · since Feb 2012']);
  assert.ok(t.rows[0].x0 < t.rows[1].x0 && t.rows[1].x0 < t.rows[2].x0);
  assert.equal(t.rows[0].x1, TIMELINE.width);
  assert.ok(Math.abs(t.overlap - t.rows[2].x0) < 1e-9);
  assert.match(t.label, /all through Dec 2012$/);
  assert.equal(timelineModel({}), null);
  const narrow = timelineModel({ ...manifest, last_month: '2012-12' }, 364);
  assert.equal(narrow.width, 364, 'drawn at the rendered width so CSS text sizes are real pixels');
  assert.equal(narrow.rows[0].x1, 364);
  assert.ok(Math.abs(narrow.rows[2].x0 / 364 - t.rows[2].x0 / TIMELINE.width) < 1e-9);
});

test('drawer steps and lead come from the method copy; synthetic note only for synthetic data', async () => {
  const { STEPS } = await import('./method-drawer.js');
  assert.equal(STEPS.length, 3);
  assert.equal(methodModel(manifest).synthetic, null);
  assert.match(methodModel({ dataVersion: 'synthetic-1' }).synthetic.sentence, /not real fire detections/);
});
