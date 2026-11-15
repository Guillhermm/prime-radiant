import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canApply, applyPatch, layerChoices } from './query-bar.js';
import { VIEWS } from '../views.js';

const aoi = { valid: true, bbox: [0, 0, 1, 1] };
const dates = { valid: true, from: '2020-01', to: '2020-12' };

test('apply requires both parts valid', () => {
  assert.equal(canApply(aoi, dates), true);
  assert.equal(canApply({ valid: false }, dates), false);
  assert.equal(canApply(aoi, { valid: false }), false);
  assert.equal(canApply(undefined, dates), false);
});

test('applyPatch carries bbox and dates, or null', () => {
  assert.deepEqual(applyPatch(aoi, dates), { bbox: [0, 0, 1, 1], name: null, from: '2020-01', to: '2020-12' });
  assert.equal(applyPatch(aoi, dates, '  Pantanal\n').name, 'Pantanal');
  assert.equal(applyPatch(aoi, dates, '   ').name, null, 'a blank name is no name');
  assert.equal(applyPatch({ valid: false }, dates), null);
});

test('layer switch appears only when Anomalies is enabled', () => {
  assert.deepEqual(layerChoices(VIEWS), []);
  const on = VIEWS.map((v) => (v.id === 'anomalies' ? { ...v, enabled: true } : v));
  assert.deepEqual(layerChoices(on).map((c) => c.id), ['counts', 'anomaly']);
});

import { chipModel, presetPatch } from './query-bar.js';

test('presetPatch sets the bbox and keeps or defaults the dates', () => {
  const p = { bbox: [1, 2, 3, 4] };
  assert.deepEqual(presetPatch(p, { from: '2010-01', to: '2011-01' }, null), { bbox: [1, 2, 3, 4], name: null, from: '2010-01', to: '2011-01' });
  assert.deepEqual(presetPatch(p, { from: null, to: null }, { from: '2000-11', to: '2012-12' }), { bbox: [1, 2, 3, 4], name: null, from: '2000-11', to: '2012-12' });
  assert.deepEqual(presetPatch(p, { from: null, to: null }, null), { bbox: [1, 2, 3, 4], name: null, from: null, to: null });
});

test('chipModel words the area and period chips', () => {
  const m = chipModel({ bbox: [-59, -19, -52, -12], from: '2001-01', to: '2026-10' });
  assert.equal(m.area, '19°S–12°S · 59°W–52°W');
  assert.equal(m.period, 'Jan 2001 – Oct 2026');
  assert.equal(m.areaLabel, 'Area: 19°S to 12°S, 59°W to 52°W. Change area');
  assert.equal(m.periodLabel, 'Period: Jan 2001 to Oct 2026. Change period');
});

test('chipModel without an area or dates', () => {
  assert.equal(chipModel({ bbox: null, from: null, to: null }).area, 'No area chosen');
  assert.equal(chipModel({ bbox: null, from: null, to: null }).period, 'All available');
  assert.equal(chipModel({ bbox: null, from: null, to: null }, { from: '2000-11', to: '2012-12' }).period, 'Nov 2000 – Dec 2012');
});

test('presetPatch carries a hotspot\'s place name', () => {
  assert.equal(presetPatch({ bbox: [1, 2, 3, 4], name: 'Pará, Brazil' }, { from: null, to: null }).name, 'Pará, Brazil');
});

test('chipModel shows a name when the area has one, coordinates in the label', () => {
  const m = chipModel({ bbox: [-59, -19, -52, -12], name: 'Pantanal', from: null, to: null });
  assert.equal(m.area, 'Pantanal');
  assert.equal(m.named, true);
  assert.match(m.areaLabel, /^Area: Pantanal, 19°S to 12°S/);
  assert.equal(chipModel({ bbox: null, name: 'Pantanal' }).area, 'No area chosen');
  assert.equal(chipModel({ bbox: [-59, -19, -52, -12], name: null }).named, false);
});
