import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareToMedian, medianYears, ordinal, partialNote, peakMonth, rankSentence, sameMonth, typicalYear, yearTotals } from './stats.js';

const cell = (year, month, value, o = {}) => ({ year, month, value, status: 'harmonized', estimated: true, ...o });

test('ordinal suffixes, teens included', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
});

test('year totals: newest first, share of the busiest, partial years and null for all-null years', () => {
  const cells = [cell(2024, 11, 5), cell(2024, 12, 5), ...Array.from({ length: 12 }, (_, i) => cell(2025, i + 1, i === 8 ? 40 : 0)), cell(2026, 1, null)];
  const t = yearTotals(cells);
  assert.deepEqual(t.map((y) => y.year), [2026, 2025, 2024]);
  assert.equal(t[0].total, null);
  assert.equal(t[1].total, 40);
  assert.equal(t[1].busiest, true);
  assert.equal(t[1].partial, false);
  assert.equal(t[2].share, 0.25);
  assert.equal(t[2].partial, true);
  assert.equal(partialNote(t[2]), '2024 from November');
  assert.equal(partialNote({ year: 2026, first: 1, last: 10 }), '2026 through October');
  assert.equal(partialNote({ year: 2026, first: 3, last: 10 }), '2026, March to October');
});

test('same month: rank among years with data, ties share the better rank, null never ranked', () => {
  const cells = [cell(2001, 9, 10), cell(2002, 9, 30), cell(2003, 9, 30), cell(2004, 9, null), cell(2005, 9, 5), cell(2005, 10, 99)];
  const r = sameMonth(cells, cells[2]);
  assert.equal(r.list.length, 5);
  assert.equal(r.count, 4);
  assert.equal(r.rank, 1);
  assert.equal(sameMonth(cells, cells[0]).rank, 3);
  assert.equal(sameMonth(cells, cells[3]).rank, null);
  assert.equal(rankSentence(sameMonth(cells, cells[0]), 9), '3rd busiest of 4 Septembers');
  assert.equal(rankSentence(r, 9), 'Busiest of 4 Septembers');
  assert.equal(rankSentence({ rank: 1, count: 1 }, 9), null);
});

test('compare to median: ratio at 2x and under half, percent between, honest zero cases', () => {
  assert.deepEqual(compareToMedian(12122, 4545), { kind: 'ratio', text: '2.7×', dir: 'above' });
  assert.deepEqual(compareToMedian(3117, 2959), { kind: 'pct', text: '+5%', dir: 'above' });
  assert.deepEqual(compareToMedian(88, 100), { kind: 'pct', text: '−12%', dir: 'below' });
  assert.equal(compareToMedian(20, 100).text, '0.2×');
  assert.equal(compareToMedian(100, 100).text, 'equal to the median');
  assert.equal(compareToMedian(0, 0).text, 'equal to the median');
  assert.equal(compareToMedian(3, 0).text, 'median is 0');
  assert.equal(compareToMedian(5, undefined), null);
  assert.equal(compareToMedian(null, 5), null);
});

test('median years: earlier years of the same month with a value', () => {
  const all = [cell(2000, 9, null), cell(2001, 9, 1), cell(2002, 9, 2), cell(2003, 9, 3), cell(2002, 8, 9)];
  assert.deepEqual(medianYears(all, { year: 2003, month: 9 }), { count: 2, from: 2001, to: 2002 });
  assert.equal(medianYears(all, { year: 2001, month: 9 }), null);
});

test('typical year: core.baseline median per month over complete years only', () => {
  // Nov 2000 to Oct 2003: complete years 2001 and 2002, Nov and Dec also 2000.
  const values = [];
  for (let i = 0; i < 36; i++) values.push(i);
  const t = typicalYear({ id: 'h', unit: 'fire-cell-days', start: '2000-11', values });
  assert.equal(t.length, 12);
  // January: 2001 (index 2) and 2002 (index 14), median 8. October 2003 (index 35) is not used.
  assert.deepEqual(t[0], { month: 1, median: 8, from: 2001, to: 2002 });
  // November: 2000, 2001, 2002 -> indexes 0, 12, 24 -> median 12.
  assert.deepEqual(t[10], { month: 11, median: 12, from: 2000, to: 2002 });
  // October 2001 and 2002 (indexes 11 and 23) give 17, the largest median.
  assert.equal(peakMonth(t).month, 10);
});

test('typical year without a complete year is all null', () => {
  const t = typicalYear({ id: 'h', unit: 'u', start: '2012-01', values: [1, 2, 3] });
  assert.ok(t.every((x) => x.median === null));
  assert.equal(peakMonth(t), null);
});
