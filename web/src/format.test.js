import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbreviateCount, formatCount, formatDensity, monthLabel } from './format.js';

test('abbreviateCount', () => {
  assert.equal(abbreviateCount(0), '0');
  assert.equal(abbreviateCount(999), '999');
  assert.equal(abbreviateCount(1200), '1.2k');
  assert.equal(abbreviateCount(1000), '1k');
  assert.equal(abbreviateCount(12450), '12k');
  assert.equal(abbreviateCount(999950), '1M');
  assert.equal(abbreviateCount(1_250_000), '1.3M');
});

test('formatCount groups thousands, formatDensity trims', () => {
  assert.equal(formatCount(12450), '12,450');
  assert.equal(formatDensity(3.54), '3.5');
  assert.equal(formatDensity(4), '4');
  assert.equal(formatDensity(37.6), '38');
});

test('monthLabel', () => assert.equal(monthLabel(2020, 9), 'September 2020'));
