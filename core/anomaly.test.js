import test from 'node:test';
import assert from 'node:assert/strict';
import { anomaly, yearRank } from './anomaly.js';
import { kpis } from './calendar.js';
import { baseline } from './baseline.js';
import { partialMonthsFor } from './partial.js';
import { validateSeries } from './schema.js';

const M = { id: 'x', version: 1 };
/** Harmonized wrapper; `vals` are Januaries from `y0`, every other month 0. */
const jan = (y0, vals) => {
  const values = [];
  vals.forEach((v) => values.push(v, ...Array(11).fill(0)));
  return { series: { id: 'harmonized', unit: 'fire-cell-days', start: `${y0}-01`, values, method: M, comparable: true }, R: null, K: null, reasons: [] };
};
const at = (k) => k * 12;
const man = (partial = {}) => ({ partial_months: { modis: [], viirs: [], noaa20: [], ...partial } });

test('percentile rank, ties split evenly, own year excluded', () => {
  // 2013..2022 are the history of 2023 (n = 10): 2,4,4,6,6,6,8,8,10,12 ; value 6
  const h = jan(2013, [2, 4, 4, 6, 6, 6, 8, 8, 10, 12, 6, 100]);
  const a = anomaly(h, man());
  // below 6: 2,4,4 = 3 ; equal: 3 ; (3 + 1.5) / 10 = 0.45
  assert.equal(a.values[at(10)], 0.45);
  assert.equal(a.flags[at(10)], false);
  // 2024 = 100 beats all 11 earlier years (2023's own 6 is earlier, so it is in): rank 1
  assert.equal(a.values[at(11)], 1);
  assert.equal(a.flags[at(11)], true);
  // 2022 (12) ranks against 9 earlier years only (2013..2021), never against 2023 or 2024
  assert.equal(a.values[at(9)], 1);
});

test('n < 9 is never flagged and has no rank; default minYears 9, opt overrides', () => {
  const h = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 1000]);
  const a = anomaly(h, man());
  assert.ok(a.values.every((v) => v === null));
  assert.ok(a.flags.every((f) => f === false));
  const b = anomaly(h, man(), { minYears: 8 });
  assert.equal(b.values[at(8)], 1);
  assert.equal(b.flags[at(8)], true);
  assert.equal(b.values[at(7)], null);
});

test('threshold: flagged at rank >= 0.9, opt overrides', () => {
  // history 1..10, values 9.5 -> below 9 -> rank 0.9 flagged; 8.5 -> 0.8 not flagged
  const hist = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(anomaly(jan(2013, [...hist, 9.5]), man()).flags[at(10)], true);
  assert.equal(anomaly(jan(2013, [...hist, 8.5]), man()).flags[at(10)], false);
  assert.equal(anomaly(jan(2013, [...hist, 8.5]), man(), { threshold: 0.8 }).flags[at(10)], true);
});

test('partial months and null never enter the baseline; 2012-01 is partial', () => {
  // Januaries 2012..2023: 2012 is KNOWN partial, 2014 null, 2015 partial via manifest
  const h = jan(2012, [999, 1, null, 999, 2, 3, 4, 5, 6, 7, 8, 9, 5]);
  h.series.values[at(2)] = null;
  const a = anomaly(h, man({ viirs: ['2015-01'] }), { minYears: 9 });
  // usable earlier years for 2024-01: 2013,2016..2023 = 9 ; values 1,2,3,4,5,6,7,8,9 ; 5 -> (4 + .5)/9
  assert.equal(a.values[at(12)], 4.5 / 9);
  // the partial month itself gets no rank
  const own = jan(2012, [999, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(anomaly(own, man()).values[0], null);
});

test('Terra-only era months are excluded from every baseline', () => {
  // 2002-01..2002-07 are Terra-only / partial; the Januaries of 2001..2010 count only from 2003
  const h = jan(2001, [50, 50, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const a = anomaly(h, man(), { minYears: 5 });
  // 2013-01 ranks against 2003..2012 minus 2012 partial: 2003..2011 = 9 values 1..9? (2003=1 ... 2011=9)
  // 2012 is KNOWN partial (value 10 dropped); 2013 value 11 -> above all 9 -> rank 1
  assert.equal(a.values[at(12)], 1);
  assert.equal(a.values[at(0)], null);
  assert.equal(a.values[at(1)], null); // 2002-01 excluded itself
  assert.equal(baseline(h.series, { minYears: 5 }).yearsUsed[at(12)].includes(2001), false);
});

test('all-zero history: a zero ties (rank 0.5, not flagged), any positive ranks 1 and flags', () => {
  const zeros = Array(10).fill(0);
  const z = anomaly(jan(2013, [...zeros, 0, 3]), man());
  assert.equal(z.values[at(10)], 0.5);
  assert.equal(z.flags[at(10)], false);
  assert.equal(z.values[at(11)], 1); // 3 beats eleven earlier values (ten 0s and a 0)
  const p = anomaly(jan(2013, [...zeros, 3]), man());
  assert.equal(p.values[at(10)], 1);
  assert.equal(p.flags[at(10)], true);
});

test('Series contract: boolean flags, method, comparable, validates', () => {
  const a = anomaly(jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), man());
  assert.equal(a.id, 'anomaly');
  assert.deepEqual(a.method, { id: 'percentile-rank', version: 1 });
  assert.equal(a.comparable, true);
  assert.equal(a.flags.length, a.values.length);
  assert.ok(a.flags.every((f) => typeof f === 'boolean'));
  assert.deepEqual(validateSeries(a), []);
  assert.equal(validateSeries({ ...a, flags: a.flags.slice(1) })[0].code, 'BAD_FLAGS');
  assert.equal(validateSeries({ ...a, flags: a.flags.map(() => 'x') })[0].code, 'BAD_FLAGS');
});

/** Full-year series: each year constant `v` per month (12 * v total). */
const years = (y0, vs) => ({ series: { id: 'harmonized', unit: 'fire-cell-days', start: `${y0}-01`, values: vs.flatMap((v) => Array(12).fill(v)), method: M, comparable: true }, R: null, K: null, reasons: [] });

test('yearRank: 1 = most, ties share rank, incomplete and partial years excluded with reason', () => {
  const h = years(2013, [1, 3, 3, 2]);
  h.series.values.push(5); // 2017-01 only
  const r = yearRank(h, man());
  assert.equal(r.n, 4);
  assert.deepEqual(r.years.map((y) => [y.year, y.total, y.rank]), [[2013, 12, 4], [2014, 36, 1], [2015, 36, 1], [2016, 24, 3]]);
  assert.deepEqual(r.excluded, [{ year: 2017, reason: 'year not fully in the series' }]);
  const g = years(2011, [1, 1]);
  g.series.values[12] = null;
  const r2 = yearRank(g, man());
  assert.deepEqual(r2.years.map((y) => y.year), [2011]);
  assert.deepEqual(r2.excluded, [{ year: 2012, reason: '2012-01 has no data' }]);
  const p = years(2013, [1, 1, 1]);
  const r3 = yearRank(p, man({ viirs: ['2014-05'] }));
  assert.deepEqual(r3.excluded, [{ year: 2014, reason: '2014-05 is a partial or Terra-only month' }]);
});

test('partial months follow the supplying sensor: S-NPP observed, MODIS x R, NOAA-20 x K', () => {
  const h = years(2013, [1, 1, 1]); // 2013..2015
  const est = (ym) => ({ month: ym, flag: 'estimated' });
  h.series.flags = [est('2013-03'), est('2015-11')];
  const m = { coverage: { viirs: ['2012-01', '2015-10'], noaa20: ['2012-01', '2015-12'] },
    partial_months: { modis: ['2013-03', '2014-06'], viirs: ['2013-04', '2015-11'], noaa20: ['2014-07', '2015-11'] } };
  assert.deepEqual(partialMonthsFor(h, m), ['2013-03', '2013-04', '2015-11']);
  // 2014-06 (MODIS) and 2014-07 (NOAA-20) are observed S-NPP months: not partial for this series
});

test('kpis carries flagged count, year rank and latest rank', () => {
  const h = years(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]);
  const k = kpis(h, null, { last_month: '2023-12' });
  assert.equal(k.anomaly.flagged, 24); // 2022 (9 earlier years) and 2023 (10) each top their history
  assert.deepEqual(k.anomaly.yearRank, { year: 2023, rank: 1, n: 11 });
  assert.deepEqual(k.anomaly.excludedYears, []);
  assert.equal(k.anomaly.latest.month, '2023-12');
  assert.equal(k.anomaly.latest.rank, 1);
  assert.equal(k.anomaly.latest.flagged, true);
  const r = kpis(h, null, { last_month: '2023-12' }, { from: '2021-01', to: '2021-12' });
  assert.equal(r.anomaly.flagged, 0);
});
