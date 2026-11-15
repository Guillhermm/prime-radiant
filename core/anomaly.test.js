import test from 'node:test';
import assert from 'node:assert/strict';
import { anomaly, yearRank, flagRule } from './anomaly.js';
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
/** Raw-sensor stand-in: the same values as `h`, so the single-sensor rule agrees with the harmonized one. */
const same = (h) => ({ modis: { ...h.series, id: 'modis' }, viirs: { ...h.series, id: 'viirs' } });
const man = (partial = {}) => ({ partial_months: { modis: [], viirs: [], noaa20: [], ...partial } });

test('percentile rank, ties split evenly, own year excluded', () => {
  // 2013..2022 are the history of 2023 (n = 10): 2,4,4,6,6,6,8,8,10,12 ; value 6
  const h = jan(2013, [2, 4, 4, 6, 6, 6, 8, 8, 10, 12, 6, 100]);
  const a = anomaly(h, man(), { sensors: same(h) });
  // below 6: 2,4,4 = 3 ; equal: 3 ; (3 + 1.5) / 10 = 0.45
  assert.equal(a.values[at(10)], 0.45);
  assert.equal(a.flags[at(10)], false);
  // 2024 = 100 beats all 11 earlier years (2023's own 6 is earlier, so it is in): rank 1, p = 1/12
  assert.equal(a.values[at(11)], 1);
  assert.equal(a.flags[at(11)], true);
  // 2022 (12) ranks against 9 earlier years only (2013..2021), never against 2023 or 2024: p = 1/10
  assert.equal(a.values[at(9)], 1);
  assert.equal(a.flags[at(9)], true);
});

test('flag rule p = (earlier values >= v, plus 1) / (n + 1) <= 0.1, n >= 9, ties count against', () => {
  const r = (n) => Array.from({ length: n }, (_, i) => i + 1); // 1..n
  assert.equal(flagRule(10, r(9)), true); // n = 9: c = 0, p = 1/10
  assert.equal(flagRule(9, r(9)), false); // tie with the max: c = 1, p = 2/10
  assert.equal(flagRule(11, r(10)), true); // n = 10: p = 1/11 = 0.091
  assert.equal(flagRule(10, r(10)), false); // tie with the max: p = 2/11 = 0.18
  assert.equal(flagRule(21, r(20)), true); // n = 20: p = 1/21
  assert.equal(flagRule(20, r(20)), true); // tie with the max: c = 1, p = 2/21 = 0.095
  assert.equal(flagRule(19, r(20)), false); // c = 2, p = 3/21 = 0.143
  assert.equal(flagRule(100, r(8)), false); // n = 8 < 9
  assert.equal(flagRule(9, r(9), { maxP: 0.2 }), true); // opt override
});

test('n < 9 is never flagged and has no rank; default minYears 9, opt overrides', () => {
  const h = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 1000]);
  const a = anomaly(h, man(), { sensors: same(h) });
  assert.ok(a.values.every((v) => v === null));
  assert.ok(a.flags.every((f) => f === false));
  const b = anomaly(h, man(), { minYears: 8, sensors: same(h) });
  assert.equal(b.values[at(8)], 1);
  assert.equal(b.flags[at(8)], false); // n = 8: p = 1/9 > 0.1, even a record cannot flag
  assert.equal(anomaly(h, man(), { minYears: 8, maxP: 0.12, sensors: same(h) }).flags[at(8)], true);
  assert.equal(b.values[at(7)], null);
});

test('flag through anomaly(): n = 9 record flags, a tie with the record does not', () => {
  const hist = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const flagged = (v) => { const h = jan(2013, [...hist, v]); return anomaly(h, man(), { sensors: same(h) }).flags[at(9)]; };
  assert.equal(flagged(10), true);
  assert.equal(flagged(9), false);
  const h = jan(2013, [...hist, 9]);
  assert.equal(anomaly(h, man(), { maxP: 0.2, sensors: same(h) }).flags[at(9)], true);
});

test('cross-era: passes the rule on the harmonized series only -> rank kept, flag false, labeled', () => {
  const h = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // 2023 = 11, n = 10, p = 1/11
  const flat = jan(2013, Array(11).fill(5)).series;
  const none = anomaly(h, man(), { sensors: { modis: { ...flat, id: 'modis' }, viirs: { ...flat, id: 'viirs' } } });
  assert.equal(none.values[at(10)], 1);
  assert.equal(none.flags[at(10)], false);
  assert.deepEqual(none.labels[at(10)], ['cross-era']);
  assert.equal(none.labels.length, none.values.length);
  assert.deepEqual(none.labels[at(5)], []); // not a candidate: no label
  // no raw sensors given: nothing can be confirmed, the old call labels instead of flagging
  const old = anomaly(h, man());
  assert.equal(old.flags[at(10)], false);
  assert.deepEqual(old.labels[at(10)], ['unconfirmed']);
  // either sensor alone is enough: VIIRS flat but MODIS also sees the record
  const modisHigh = anomaly(h, man(), { sensors: { modis: { ...h.series, id: 'modis' }, viirs: { ...flat, id: 'viirs' } } });
  assert.equal(modisHigh.flags[at(10)], true);
  assert.equal(modisHigh.confirmedBy[at(10)], 'modis');
  assert.deepEqual(modisHigh.labels[at(10)], []);
  const viirsHigh = anomaly(h, man(), { sensors: { modis: { ...flat, id: 'modis' }, viirs: { ...h.series, id: 'viirs' } } });
  assert.equal(viirsHigh.flags[at(10)], true);
  assert.equal(viirsHigh.confirmedBy[at(10)], 'viirs');
  assert.equal(none.confirmedBy.every((c) => c === null), true);
});

test('a sensor month partial or null for that sensor is not usable: pool under 9, no confirmation', () => {
  const h = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // 2022 = 10 over 9 earlier years
  const s = same(h);
  assert.equal(anomaly(h, man(), { sensors: s }).flags[at(9)], true);
  const viirsNull = { ...s.viirs, values: s.viirs.values.map((v, i) => (i === at(3) ? null : v)) };
  const a = anomaly(h, man({ modis: ['2015-01'] }), { sensors: { modis: s.modis, viirs: viirsNull } });
  assert.equal(a.flags[at(9)], false); // MODIS pool 8 (partial 2015-01), VIIRS pool 8 (null 2016-01)
  assert.deepEqual(a.labels[at(9)], ['cross-era']);
});

test('viirs-era-record: not flagged on the harmonized series but VIIRS alone passes the rule', () => {
  // harmonized (MODIS x R before 2012-like) history holds a big value; VIIRS history is 1..9, then 10
  const h = jan(2013, [50, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // 2022 = 10: pool has 50, so p = 2/10, no flag
  const v = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).series;
  const a = anomaly(h, man(), { sensors: { modis: { ...h.series, id: 'modis', values: h.series.values.map(() => 0) }, viirs: { ...v, id: 'viirs' } } });
  assert.equal(a.flags[at(9)], false);
  assert.deepEqual(a.labels[at(9)], ['viirs-era-record']);
  assert.equal(a.confirmedBy[at(9)], null);
  // a flagged month never carries it
  const f = jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(anomaly(f, man(), { sensors: same(f) }).labels[at(9)], []);
  // VIIRS-partial months drop out of the pool (n = 8, no record) unless they were filled by NOAA-20 x K
  const m = man({ viirs: ['2016-01'] });
  const hp = jan(2013, [50, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const raw = { modis: { ...hp.series, id: 'modis', values: hp.series.values.map(() => 0) }, viirs: { ...v, id: 'viirs', values: v.values.map((x, i) => (i === at(3) ? 0 : x)) } };
  assert.deepEqual(anomaly(hp, m, { sensors: raw }).labels[at(9)], []);
  hp.series.flags = [{ month: '2016-01', flag: 'viirs-outage-filled' }, { month: '2016-01', flag: 'estimated' }];
  hp.series.values[at(3)] = 4;
  assert.deepEqual(anomaly(hp, m, { sensors: raw }).labels[at(9)], ['viirs-era-record']);
});

test('sparse-baseline: a flag over a median-0 pool carries the label', () => {
  const h = jan(2013, [...Array(9).fill(0), 3]);
  const a = anomaly(h, man(), { sensors: same(h) });
  assert.equal(a.flags[at(9)], true);
  assert.deepEqual(a.labels[at(9)], ['sparse-baseline']);
  const dense = jan(2013, [...Array(9).fill(2), 3]);
  assert.deepEqual(anomaly(dense, man(), { sensors: same(dense) }).labels[at(9)], []);
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
  const z = jan(2013, [...zeros, 0, 3]);
  const a = anomaly(z, man(), { sensors: same(z) });
  assert.equal(a.values[at(10)], 0.5);
  assert.equal(a.flags[at(10)], false);
  assert.equal(a.values[at(11)], 1); // 3 beats eleven earlier values (ten 0s and a 0)
  assert.equal(a.flags[at(11)], true);
  assert.deepEqual(a.labels[at(11)], ['sparse-baseline']);
});

test('Series contract: boolean flags, method, comparable, validates', () => {
  const a = anomaly(jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), man());
  assert.equal(a.id, 'anomaly');
  assert.deepEqual(a.method, { id: 'percentile-rank', version: 2 });
  assert.equal(a.comparable, true);
  assert.equal(a.flags.length, a.values.length);
  assert.ok(a.flags.every((f) => typeof f === 'boolean'));
  assert.equal(a.labels.length, a.values.length);
  assert.deepEqual(validateSeries(a), []);
  assert.equal(validateSeries({ ...a, labels: a.labels.slice(1) })[0].code, 'BAD_LABELS');
  assert.equal(validateSeries({ ...a, flags: a.flags.slice(1) })[0].code, 'BAD_FLAGS');
  assert.equal(validateSeries({ ...a, flags: a.flags.map(() => 'x') })[0].code, 'BAD_FLAGS');
  const sensors = { modis: a, viirs: a };
  const c = anomaly(jan(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), man(), { sensors });
  assert.equal(c.confirmedBy.length, c.values.length);
  assert.deepEqual(validateSeries(c), []);
  assert.equal(validateSeries({ ...c, confirmedBy: c.confirmedBy.slice(1) })[0].code, 'BAD_CONFIRMED_BY');
  assert.equal(validateSeries({ ...c, confirmedBy: c.confirmedBy.map(() => 'noaa20') })[0].code, 'BAD_CONFIRMED_BY');
});

/** Full-year series: each year constant `v` per month (12 * v total). */
const years = (y0, vs) => ({ series: { id: 'harmonized', unit: 'fire-cell-days', start: `${y0}-01`, values: vs.flatMap((v) => Array(12).fill(v)), method: M, comparable: true }, R: null, K: null, reasons: [] });

test('yearRank: 1 = most, ties share rank, incomplete and partial years excluded with reason', () => {
  const h = years(2013, [1, 3, 3, 2]);
  h.series.values.push(5); // 2017-01 only
  const r = yearRank(h, man());
  assert.equal(r.n, 4);
  assert.deepEqual(r.years.map((y) => [y.year, y.total, y.rank]), [[2013, 12, 4], [2014, 36, 1], [2015, 36, 1], [2016, 24, 3]]);
  assert.ok(r.years.every((y) => y.scaledTotal === y.total && !y.scaled));
  assert.deepEqual(r.excluded, [{ year: 2017, reason: 'year not fully in the series' }]);
  const g = years(2011, [1, 1]);
  g.series.values[12] = null;
  const r2 = yearRank(g, man());
  assert.deepEqual(r2.years.map((y) => y.year), [2011]);
  assert.deepEqual(r2.excluded, [{ year: 2012, reason: '2012-01 has no data' }]);
  const p = years(2013, [1, 1, 1]);
  const r3 = yearRank(p, man({ viirs: ['2014-05'] }));
  assert.deepEqual(r3.excluded, [{ year: 2014, reason: '2014-05 is partial and has no acquisition days to scale by' }]);
});

test('yearRank A4: observed and scaled totals; same rank -> rank, else rankRange with reason', () => {
  const ad = (extra) => ({ SNPP: { '2013-01': 31, '2015-12': 31, ...extra } });
  const mk = (v) => { const h = years(2013, [2, 2, 2]); h.series.values[16] = v; return h; }; // 2014-05
  // value 1, 15 of 31 days: observed 2013 = 24, 2014 = 23, 2015 = 24 ; scaled 2014 = 22 + 31/15 = 24.07
  const r = yearRank(mk(1), { ...man({ viirs: ['2014-05'] }), acquisition_days: ad({ '2014-05': 15 }) });
  const y = (yr) => r.years.find((e) => e.year === yr);
  assert.ok(Math.abs(y(2014).scaledTotal - (22 + 31 / 15)) < 1e-9);
  assert.equal(y(2014).scaled, true);
  assert.deepEqual([y(2013).rank, y(2013).rankRange], [null, [1, 2]]); // observed 1 (tie), scaled 2
  assert.deepEqual(y(2014).rankRange, [1, 3]); // observed 3, scaled 1
  assert.deepEqual(y(2015).rankRange, [1, 2]);
  assert.match(y(2014).reason, /rank 3 as observed, 1 with partial months scaled/);
  // value 0 in the partial month: scaling adds nothing, both totals agree
  const z = yearRank(mk(0), { ...man({ viirs: ['2014-05'] }), acquisition_days: ad({ '2014-05': 15 }) });
  assert.deepEqual(z.years.map((e) => [e.year, e.rank]), [[2013, 1], [2014, 3], [2015, 1]]);
});

test('yearRank A4: MODIS x R month scales by the fewer days of Terra and Aqua; a missing satellite month is 0 days', () => {
  const h = years(2013, [2, 2]);
  h.series.values[4] = 1; // 2013-05
  h.series.flags = [{ month: '2013-05', flag: 'estimated' }];
  const m = (aqua) => ({ ...man({ modis: ['2013-05'] }), coverage: { viirs: null, noaa20: null },
    acquisition_days: { Terra: { '2013-01': 31, '2013-05': 10, '2014-12': 31 }, Aqua: { '2013-01': 31, ...aqua, '2014-12': 31 } } });
  const r = yearRank(h, m({ '2013-05': 20 }));
  assert.ok(Math.abs(r.years[0].scaledTotal - (22 + 31 / 10)) < 1e-9); // min(10, 20)
  const none = yearRank(h, m({}));
  assert.equal(none.n, 1); // Aqua has no days that month inside its span: 0 days, cannot scale
  assert.deepEqual(none.excluded, [{ year: 2013, reason: '2013-05 is partial and has no acquisition days to scale by' }]);
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

test('kpis carries flagged count, cross-era count, year rank and latest rank', () => {
  const h = years(2013, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]);
  const sensors = same(h);
  const k = kpis(h, null, { last_month: '2023-12' }, { sensors });
  assert.equal(k.anomaly.flagged, 24); // 2022 (9 earlier years) and 2023 (10) each top their history
  assert.equal(k.anomaly.crossEra, 0);
  assert.deepEqual(k.anomaly.yearRank, { year: 2023, rank: 1, n: 11 });
  assert.deepEqual(k.anomaly.excludedYears, []);
  assert.equal(k.anomaly.latest.month, '2023-12');
  assert.equal(k.anomaly.latest.rank, 1);
  assert.equal(k.anomaly.latest.flagged, true);
  const r = kpis(h, null, { last_month: '2023-12' }, { from: '2021-01', to: '2021-12', sensors });
  assert.equal(r.anomaly.flagged, 0);
  const noSensors = kpis(h, null, { last_month: '2023-12' });
  assert.equal(noSensors.anomaly.flagged, 0);
  assert.equal(noSensors.anomaly.crossEra, 0);
  assert.equal(noSensors.anomaly.unconfirmed, 24);
  assert.equal(noSensors.anomaly.latest.flagged, false);
});

test('kpis yearRank shows rankRange and reason when the totals disagree', () => {
  const h = years(2013, [2, 2, 2]);
  h.series.values[16] = 1;
  const man2 = { ...man({ viirs: ['2014-05'] }), last_month: '2015-12', acquisition_days: { SNPP: { '2013-01': 31, '2014-05': 15, '2015-12': 31 } } };
  const k = kpis(h, null, man2);
  assert.deepEqual(k.anomaly.yearRank, { year: 2015, rank: null, rankRange: [1, 2], reason: 'rank 1 as observed, 2 with partial months scaled to a full month', n: 3 });
});
