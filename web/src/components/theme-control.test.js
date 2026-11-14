import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeOptions } from './theme-control.js';

test('themeOptions lists system, light, dark and marks the current one', () => {
  const o = themeOptions('light');
  assert.deepEqual(o.map((x) => x.id), ['system', 'light', 'dark']);
  assert.deepEqual(o.filter((x) => x.selected).map((x) => x.id), ['light']);
  assert.ok(o.every((x) => x.label));
});
