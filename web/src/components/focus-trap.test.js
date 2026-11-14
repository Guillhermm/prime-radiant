import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trapIndex } from './focus-trap.js';

test('focus trap wraps in both directions', () => {
  assert.equal(trapIndex(3, 2, false), 0);
  assert.equal(trapIndex(3, 0, true), 2);
  assert.equal(trapIndex(3, 1, false), 2);
  assert.equal(trapIndex(3, 1, true), 0);
  assert.equal(trapIndex(3, -1, true), 2);
  assert.equal(trapIndex(0, 0, false), -1);
});
