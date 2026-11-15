import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caveat } from '../../../core/caveats.js';
import { anomalyCaveats, periodLabel, periodModel, periodsInRange, yearRankModel } from './anomaly-summary.js';

// 2018-11 to 2019-04: flagged Dec 2018 to Feb 2019 (crossing the year) and Apr 2019.
const series = {
  id: 'anomaly', start: '2018-11',
  values: [0.5, 0.95, 1, 0.92, 0.4, 0.97],
  flags: [false, true, true, true, false, true],
  confirmedBy: [null, 'viirs', 'modis', 'viirs', null, 'modis'],
};

test('periods group consecutive flagged months, newest first', () => {
  const p = periodsInRange(series);
  assert.deepEqual(p.map((x) => [x.from, x.to, x.months]), [['2019-04', '2019-04', 1], ['2018-12', '2019-02', 3]]);
  assert.deepEqual(p[1].confirmedBy, ['modis', 'viirs']);
  assert.equal(p[1].maxRank, 1);
});

test('periods are cut to the range shown, so a run the range splits starts at its edge', () => {
  assert.deepEqual(periodsInRange(series, '2019-01', '2019-03').map((x) => [x.from, x.to]), [['2019-01', '2019-02']]);
  assert.deepEqual(periodsInRange(series, '2020-01', '2020-12'), []);
  assert.deepEqual(periodsInRange(null), []);
});

test('labels: one month, a run inside a year, a run across years', () => {
  assert.equal(periodLabel({ from: '2011-12', to: '2011-12' }), 'Dec 2011');
  assert.equal(periodLabel({ from: '2019-08', to: '2019-10' }), 'Aug–Oct 2019');
  assert.equal(periodLabel({ from: '2018-12', to: '2019-02' }), 'Dec 2018–Feb 2019');
});

test('a period row says its length, peak and confirming sensors, and selects its first month', () => {
  const m = periodModel({ from: '2018-12', to: '2019-02', months: 3, maxRank: 1, confirmedBy: ['modis', 'viirs'] });
  assert.equal(m.meta, '3 months · record high · confirmed on MODIS and VIIRS');
  assert.equal(m.name, 'December 2018 to February 2019, 3 months, record high, confirmed on MODIS and VIIRS');
  assert.deepEqual(m.first, { year: 2018, month: 12 });
  assert.equal(periodModel({ from: '2019-04', to: '2019-04', months: 1, maxRank: 0.97, confirmedBy: ['viirs'] }).meta, '1 month · peak 97th percentile · confirmed on VIIRS');
});

const yr = {
  n: 3,
  years: [
    { year: 2016, total: 1500, scaledTotal: 1500, scaled: false, rank: 2 },
    { year: 2017, total: 900, scaledTotal: 900, scaled: false, rank: 3 },
    { year: 2018, total: 1490, scaledTotal: 1600, scaled: true, rank: null, rankRange: [1, 2], reason: 'rank 2 as observed, 1 with partial months scaled to a full month' },
  ],
  excluded: [{ year: 2019, reason: 'year not fully in the series' }],
};

test('year rank: the newest complete year of the range, a range when observed and scaled disagree', () => {
  const m = yearRankModel(yr);
  assert.equal(m.year, 2018);
  assert.equal(m.value, '1–2');
  assert.equal(m.total, '2018 had 1,490 fire-cell-days. Rank 1 is the year with the most.');
  assert.equal(m.of, 'of 3 complete years, 2016–2018');
  assert.equal(m.note, 'Range: rank 2 as observed, 1 with partial months scaled to a full month.');
  const plain = yearRankModel(yr, { from: '2015-01', to: '2017-06' });
  assert.deepEqual([plain.year, plain.value, plain.note], [2017, '3', null]);
  assert.equal(yearRankModel(yr, { from: '2019-01', to: '2019-12' }).year, null, 'no complete year in the range');
  assert.equal(yearRankModel({ n: 0, years: [], excluded: [] }), null);
});

test('anomaly caveats: the anomaly kind and the flag items the rule produces, nothing about counts', () => {
  const list = ['unit-fire-cell-days', 'anomaly-rule', 'anomaly-small-n', 'cross-era', 'estimated', 'viirs-era-record'].map((id) => caveat(id));
  assert.deepEqual(anomalyCaveats(list).map((c) => c.id), ['anomaly-rule', 'anomaly-small-n', 'cross-era', 'viirs-era-record']);
  assert.ok(anomalyCaveats(list).every((c) => !c.preliminary), 'gate V2 passed');
});
