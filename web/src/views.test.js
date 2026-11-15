import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_VIEWS, VIEWS, enabledViews, isEnabledView, viewsFor } from './views.js';

test('lists all four views in order', () => {
  assert.deepEqual(VIEWS.map((v) => v.id), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('calendar, sensors and anomalies are enabled; live waits for gate V3', () => {
  assert.deepEqual(enabledViews().map((v) => v.id), ['calendar', 'sensors', 'anomalies']);
});

test('isEnabledView rejects disabled and unknown ids', () => {
  assert.equal(isEnabledView('calendar'), true);
  assert.equal(isEnabledView('anomalies'), true);
  assert.equal(isEnabledView('live'), false);
  assert.equal(isEnabledView('nope'), false);
});

test('synthetic data or ?preview=1 turns on every view; real data keeps live off', () => {
  const ids = (v) => enabledViews(v.views).map((x) => x.id);
  assert.deepEqual(ids(viewsFor({ synthetic: true, previewParam: false })), ['calendar', 'sensors', 'anomalies', 'live']);
  assert.deepEqual(ids(viewsFor({ synthetic: false, previewParam: true })), ['calendar', 'sensors', 'anomalies', 'live']);
  const real = viewsFor({ synthetic: false, previewParam: false });
  assert.equal(real.preview, false);
  assert.deepEqual(ids(real), ['calendar', 'sensors', 'anomalies']);
});

test('only live carries the preview tag', () => {
  assert.deepEqual(PREVIEW_VIEWS, ['live']);
});
