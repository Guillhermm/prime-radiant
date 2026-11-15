import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareToMedian, yearsSpan, ordinal, partialNote, peakMonth, rankSentence, sameMonth, typicalYear, yearTotals } from './stats.js';

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

test('years span: count and range of the years core.baseline used', () => {
  assert.deepEqual(yearsSpan([2003, 2001, 2002]), { count: 3, from: 2001, to: 2003 });
  assert.equal(yearsSpan([]), null);
  assert.equal(yearsSpan(undefined), null);
});

test('typical year: core.baseline median per month over complete years, its 5-year and partial-month rules', () => {
  // Jan 2003 to Mar 2010: complete years 2003 to 2009; value = index.
  const values = Array.from({ length: 87 }, (_, i) => i);
  const series = { id: 'harmonized', unit: 'fire-cell-days', start: '2003-01', values };
  const t = typicalYear(series);
  assert.equal(t.length, 12);
  // January: indexes 0, 12, ..., 72 (2003 to 2009), median 36. March 2010 (index 86) is not used.
  assert.deepEqual(t[0], { month: 1, median: 36, from: 2003, to: 2009 });
  assert.equal(peakMonth(t).month, 12);
  // An outage month leaves the median; with fewer than 5 Januaries left there is none.
  const outage = typicalYear(series, { partialMonths: ['2003-01', '2004-01', '2005-01'] });
  assert.equal(outage[0].median, null);
  assert.equal(outage[1].median, 37);
});

test('typical year without a complete year is all null', () => {
  const t = typicalYear({ id: 'h', unit: 'u', start: '2012-01', values: [1, 2, 3] });
  assert.ok(t.every((x) => x.median === null));
  assert.equal(peakMonth(t), null);
});

test('year totals: Terra-only months make a year partial, and a year of them only reads Terra only', async () => {
  const cell = (year, month, value, flags = []) => ({ year, month, value, flags });
  const cells = [
    ...Array.from({ length: 12 }, (_, i) => cell(2001, i + 1, null, ['terra-only'])),
    ...Array.from({ length: 12 }, (_, i) => (i < 6 ? cell(2002, i + 1, null, ['terra-only']) : cell(2002, i + 1, 10))),
  ];
  const [y2002, y2001] = yearTotals(cells);
  assert.deepEqual([y2002.total, y2002.partial, y2002.terraOnly, y2002.first], [60, true, true, 7]);
  assert.equal(partialNote(y2002), '2002 from July, Terra only before');
  assert.deepEqual([y2001.total, y2001.terraOnly], [null, true]);
});
