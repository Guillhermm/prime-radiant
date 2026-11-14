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
  assert.deepEqual(applyPatch(aoi, dates), { bbox: [0, 0, 1, 1], from: '2020-01', to: '2020-12' });
  assert.equal(applyPatch({ valid: false }, dates), null);
});

test('layer switch appears only when Anomalies is enabled', () => {
  assert.deepEqual(layerChoices(VIEWS), []);
  const on = VIEWS.map((v) => (v.id === 'anomalies' ? { ...v, enabled: true } : v));
  assert.deepEqual(layerChoices(on).map((c) => c.id), ['counts', 'anomaly']);
});

import { presetPatch, summaryModel } from './query-bar.js';

test('presetPatch sets the bbox and keeps or defaults the dates', () => {
  const p = { bbox: [1, 2, 3, 4] };
  assert.deepEqual(presetPatch(p, { from: '2010-01', to: '2011-01' }, null), { bbox: [1, 2, 3, 4], from: '2010-01', to: '2011-01' });
  assert.deepEqual(presetPatch(p, { from: null, to: null }, { from: '2000-11', to: '2012-12' }), { bbox: [1, 2, 3, 4], from: '2000-11', to: '2012-12' });
  assert.deepEqual(presetPatch(p, { from: null, to: null }, null), { bbox: [1, 2, 3, 4], from: null, to: null });
});

test('summaryModel words the two phone chips', () => {
  const m = summaryModel({ bbox: [-58.2, -20.1, -55, -15.3], from: '2000-11', to: '2012-12' });
  assert.equal(m.area, 'Area: -20.1, -58.2 to -15.3, -55 (15.4 sq deg)');
  assert.equal(m.range, 'Range: 2000-11 to 2012-12');
});

test('summaryModel without an area or dates', () => {
  assert.equal(summaryModel({ bbox: null, from: null, to: null }).area, 'No area chosen');
  assert.equal(summaryModel({ bbox: null, from: null, to: null }).range, 'Range: all available');
  assert.equal(summaryModel({ bbox: null, from: null, to: null }, { from: '2000-11', to: '2012-12' }).range, 'Range: 2000-11 to 2012-12');
});
