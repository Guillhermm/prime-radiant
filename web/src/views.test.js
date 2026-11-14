import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS, enabledViews, isEnabledView } from './views.js';

test('lists all four views in order', () => {
  assert.deepEqual(VIEWS.map((v) => v.id), ['calendar', 'sensors', 'anomalies', 'live']);
});

test('only calendar is enabled until the other views have data', () => {
  assert.deepEqual(enabledViews().map((v) => v.id), ['calendar']);
});

test('isEnabledView rejects disabled and unknown ids', () => {
  assert.equal(isEnabledView('calendar'), true);
  assert.equal(isEnabledView('live'), false);
  assert.equal(isEnabledView('nope'), false);
});
