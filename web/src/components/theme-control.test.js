import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextThemeIndex, themeOptions } from './theme-control.js';

test('themeOptions lists light, dark, system with icons and marks the current one', () => {
  const o = themeOptions('dark');
  assert.deepEqual(o.map((x) => x.id), ['light', 'dark', 'system']);
  assert.deepEqual(o.map((x) => x.icon), ['sun', 'moon', 'monitor']);
  assert.deepEqual(o.filter((x) => x.selected).map((x) => x.label), ['Dark']);
});

test('arrow keys move through the radio group and wrap', () => {
  assert.equal(nextThemeIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextThemeIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextThemeIndex('ArrowDown', 0, 3), 1);
  assert.equal(nextThemeIndex('Enter', 0, 3), null);
});
