import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_MEDIAN, ZERO_NOTE, verdictModel } from './verdict-row.js';

const oct = (year, value, o = {}) => ({ year, month: 10, value, status: 'harmonized', estimated: true, ...o });

test('latest month against its core median, with rank and the years behind the median', () => {
  const cells = [oct(2023, 1000), oct(2024, 5000), oct(2025, 2000), oct(2026, 3117, { median: 2959, medianYears: [2023, 2024, 2025] })];
  const m = verdictModel({ cells, kpis: { total: 11117 } });
  assert.equal(m.latest.eyebrow, 'October 2026 · latest month');
  assert.equal(m.latest.value, '3,117');
  assert.deepEqual(m.latest.compare, { kind: 'pct', text: '+5%', dir: 'above' });
  assert.equal(m.latest.versus, 'vs October median 2,959');
  assert.equal(m.latest.sentence, '2nd busiest of 4 Octobers · median of earlier years, 2023–2025');
});

test('regression: a latest month with years of history but no median says so and shows no delta', () => {
  const m = verdictModel({ cells: [oct(2025, 7), oct(2026, 9)], kpis: { total: 16 } });
  assert.equal(m.latest.value, '9');
  assert.equal(m.latest.compare, null);
  assert.equal(m.latest.sentence, NO_MEDIAN);
});

test('no-data latest month is not zero; partial month is named', () => {
  const m = verdictModel({ cells: [oct(2026, null, { status: 'no-data', estimated: false })], kpis: { total: 0 } });
  assert.equal(m.latest.value, 'No data');
  assert.equal(m.facts.find((f) => f.id === 'total').v, 'No data');
  assert.match(verdictModel({ cells: [oct(2026, 1, { status: 'partial' })], kpis: { total: 1 } }).latest.eyebrow, /partial$/);
});

test('all zero: 0 fire-cell-days and the sensors-operating sentence', () => {
  const m = verdictModel({ cells: [oct(2025, 0), oct(2026, 0, { median: 0 })], kpis: { total: 0 } });
  assert.equal(m.latest.value, '0');
  assert.equal(m.latest.sentence, ZERO_NOTE);
  assert.equal(m.facts.find((f) => f.id === 'total').v, '0');
});

test('facts: peak month from the typical year (preview), busiest year and total are plain sums', () => {
  const typical = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, median: i === 8 ? 4545 : 10, from: 2001, to: 2025 }));
  const cells = [oct(2024, 30), oct(2025, 20), { year: 2025, month: 11, value: 15, status: 'harmonized', estimated: true }];
  const [peak, busiest, total] = verdictModel({ cells, kpis: { total: 65 }, typical }).facts;
  assert.deepEqual([peak.v, peak.s, peak.preview], ['September', 'median 4,545, all years 2001–2025', true]);
  assert.deepEqual([busiest.v, busiest.s], ['2025', '35, part of the year']);
  assert.deepEqual([total.v, total.s], ['65', '3 months']);
});

test('empty range has no latest card', () => {
  assert.equal(verdictModel({ cells: [], kpis: { total: 0 } }).latest, null);
});
