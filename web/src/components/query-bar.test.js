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
