import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_VIEWS, VIEWS, enabledViews, isEnabledView, viewsFor } from './views.js';

test('lists all four views in order', () => {
  assert.deepEqual(VIEWS.map((v) => v.id), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('every view is enabled: anomalies passed gate V2, live gate V3', () => {
  assert.deepEqual(enabledViews().map((v) => v.id), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('isEnabledView rejects disabled and unknown ids', () => {
  assert.equal(isEnabledView('live'), true);
  assert.equal(isEnabledView('live', [{ id: 'live', enabled: false }]), false);
  assert.equal(isEnabledView('nope'), false);
});

test('preview is set by synthetic data or ?preview=1 only', () => {
  const ids = (v) => enabledViews(v.views).map((x) => x.id);
  assert.equal(viewsFor({ synthetic: true, previewParam: false }).preview, true);
  assert.equal(viewsFor({ synthetic: false, previewParam: true }).preview, true);
  const real = viewsFor({ synthetic: false, previewParam: false });
  assert.equal(real.preview, false);
  assert.deepEqual(ids(real), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('only live carries the preview tag (on synthetic data)', () => {
  assert.deepEqual(PREVIEW_VIEWS, ['live']);
});
