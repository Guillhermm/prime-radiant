import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewAnomaly, previewLive, previewRank, quantile } from './preview-stubs.js';

test('rank splits ties and needs n other years', () => {
  const pool = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(previewRank(5, pool), 4.5 / 9);
  assert.equal(previewRank(0, pool), 0);
  assert.equal(previewRank(99, pool), 1);
  assert.equal(previewRank(5, pool.slice(1)), null);
  assert.equal(previewRank(null, pool), null);
});

test('anomaly series spans the cells and flags the top of the baseline', () => {
  const cells = [];
  for (let y = 2010; y <= 2020; y++) cells.push({ year: y, month: 3, value: y === 2020 ? 5000 : y });
  const s = previewAnomaly(cells);
  assert.equal(s.id, 'anomaly');
  assert.equal(s.start, '2010-03');
  assert.equal(s.values.length, 1 + 10 * 12);
  assert.equal(s.values.at(-1), 1);
  assert.equal(s.flags.at(-1), true);
  assert.equal(s.flags[0], false);
  assert.equal(s.values[1], null);
  assert.equal(previewAnomaly([]), null);
});

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
