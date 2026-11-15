import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewLive, quantile } from './preview-stubs.js';

test('quantile interpolates', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(quantile([], 0.5), null);
});

test('preview live is a non-comparable series with an aligned band', () => {
  const cells = [];
  for (let y = 2018; y <= 2020; y++) for (let m = 1; m <= 12; m++) cells.push({ year: y, month: m, value: y * 10 + m });
  const now = new Date('2026-11-14T00:00:00Z');
  const l = previewLive(cells, now);
  assert.equal(l.live.comparable, false);
  assert.equal(l.live.start, '2020-01');
  assert.equal(l.live.values.length, 12);
  assert.equal(l.band.median.length, 12);
  assert.equal(l.band.median[0], 2018 * 10 + 1 + 5);
  assert.equal(l.fetched_at, now.toISOString());
});
