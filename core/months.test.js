import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMonth, monthIndex, monthAt } from './months.js';

test('month helpers round-trip', () => {
  assert.equal(monthIndex('2000-01', '2012-08'), 151);
  assert.equal(monthAt('2000-01', 151), '2012-08');
  assert.equal(monthAt('2000-11', 2), '2001-01');
});

test('isMonth rejects malformed strings', () => {
  assert.equal(isMonth('2012-13'), false);
  assert.equal(isMonth('2012-8'), false);
  assert.equal(isMonth(null), false);
  assert.throws(() => monthIndex('2000-01', 'nope'), RangeError);
});
