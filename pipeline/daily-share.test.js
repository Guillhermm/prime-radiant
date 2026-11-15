import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareTable, dailyCounts } from './daily-share.js';

const dir = new URL('../fixtures/daily-share/', import.meta.url).pathname;
const domainFile = new URL('../fixtures/domain/box.geojson', import.meta.url).pathname;
const pad = (o) => { const a = new Array(31).fill(0); for (const [d, n] of Object.entries(o)) a[d - 1] = n; return a; };

test('shareTable: mean cumulative share, partial months and empty months left out, null for an unseen month', () => {
  const t = shareTable({ '2023-03': pad({ 1: 1, 2: 1 }), '2024-03': pad({ 2: 2 }), '2025-03': pad({ 1: 9 }), '2023-04': pad({}) }, ['2025-03']);
  assert.deepEqual(t[2].slice(0, 3), [0.25, 1, 1]); // d1: (1/2 + 0) / 2, d2: (1 + 1) / 2
  assert.equal(t[3], null);
  assert.equal(t.length, 12);
  assert.equal(t[2].length, 31);
});

test('dailyCounts on the fixtures: type 0, domain clip and dedupe, per day', async () => {
  const { counts, years } = await dailyCounts({ dir, years: [2022, 2023, 2024], domainFile });
  assert.deepEqual(years, [2023, 2024]);
  assert.deepEqual(counts['2023-03'], pad({ 1: 2, 3: 1, 4: 1 })); // dup, type 2 and the point outside the box left out
  assert.deepEqual(counts['2023-05'], pad({ 1: 1, 2: 3 }));
  assert.deepEqual(counts['2024-03'], pad({ 1: 1, 3: 3 }));
});

test('fixture table: hand-computed March mean over 2023 and 2024, May, and the partial April excluded', async () => {
  const { counts } = await dailyCounts({ dir, years: [2023, 2024], domainFile });
  const t = shareTable(counts, ['2023-04']);
  assert.deepEqual(t[2].slice(0, 5), [0.375, 0.375, 0.875, 1, 1]);
  assert.deepEqual(t[4].slice(0, 3), [0.25, 1, 1]);
  assert.equal(t[3], null);
  assert.equal(t[2][30], 1);
});
