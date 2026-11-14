import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualTotals } from './series.js';

const mk = (start, values) => ({ id: 'modis', unit: 'fire-cell-days', start, values, method: { id: 'raw', version: 1 }, comparable: false });

test('series starting in January: full years', () => {
  const r = annualTotals(mk('2000-01', [...Array(12).fill(1), ...Array(12).fill(2)]));
  assert.deepEqual(r, [
    { year: 2000, value: 12, months: 12, complete: true },
    { year: 2001, value: 24, months: 12, complete: true },
  ]);
});

test('series starting mid-year splits at the right month', () => {
  // 2000-11, 2000-12, then 2001-01..2001-12, then 2002-01
  const r = annualTotals(mk('2000-11', [1, 2, ...Array(12).fill(10), 5]));
  assert.deepEqual(r, [
    { year: 2000, value: 3, months: 2, complete: false },
    { year: 2001, value: 120, months: 12, complete: true },
    { year: 2002, value: 5, months: 1, complete: false },
  ]);
});

test('nulls are skipped, 0 counts, all-null year gives null', () => {
  const r = annualTotals(mk('2000-11', [null, null, 0, null, 4]));
  assert.deepEqual(r, [
    { year: 2000, value: null, months: 0, complete: false },
    { year: 2001, value: 4, months: 2, complete: false },
  ]);
  assert.equal(annualTotals(mk('2000-01', Array(12).fill(0)))[0].value, 0);
  assert.equal(annualTotals(mk('2000-01', [...Array(11).fill(1), null]))[0].complete, false);
});
