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
