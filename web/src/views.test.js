import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, enabledViews, isEnabledView, viewsFor } from './views.js';

test('lists all four views in order', () => {
  assert.deepEqual(VIEWS.map((v) => v.id), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('calendar and sensors are enabled; anomalies and live wait for their gates', () => {
  assert.deepEqual(enabledViews().map((v) => v.id), ['calendar', 'sensors']);
});

test('isEnabledView rejects disabled and unknown ids', () => {
  assert.equal(isEnabledView('calendar'), true);
  assert.equal(isEnabledView('live'), false);
  assert.equal(isEnabledView('nope'), false);
});

test('synthetic data or ?preview=1 turns on every view; real data keeps the gated ones off', () => {
  const ids = (v) => enabledViews(v.views).map((x) => x.id);
  assert.deepEqual(ids(viewsFor({ synthetic: true, previewParam: false })), ['calendar', 'sensors', 'anomalies', 'live']);
  assert.deepEqual(ids(viewsFor({ synthetic: false, previewParam: true })), ['calendar', 'sensors', 'anomalies', 'live']);
  const real = viewsFor({ synthetic: false, previewParam: false });
  assert.equal(real.preview, false);
  assert.deepEqual(ids(real), ['calendar', 'sensors']);
});
