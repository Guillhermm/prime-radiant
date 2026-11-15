import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveComparison, liveCaveats, isStale } from './live.js';

// Archive: November 2012..2021 (10 years) = 10,20,...,100 ; other months 0. Series starts 2012-01.
const archive = () => {
  const values = [];
  for (let y = 2012; y <= 2021; y++) for (let m = 1; m <= 12; m++) values.push(m === 11 ? (y - 2011) * 10 : 0);
  return { id: 'harmonized', unit: 'fire-cell-days', start: '2012-01', values, method: { id: 'h', version: 1 }, comparable: true };
};
const day = (start, values) => ({ id: 'live', unit: 'fire-cell-days', comparable: false, step: 'day', start, values, method: { id: 'x', version: 1 } });
const NOW = new Date('2026-11-15T12:00:00Z');

test('month to date: cumulative days against the monthly band scaled by day fraction', () => {
  // November has 30 days. Pool 10..100: median 55, p25 32.5, p75 77.5 (type 7). Live: days 1-3 = 2, 0, 5.
  const r = liveComparison({ live: day('2026-11-01', [2, 0, 5]), harmonized: archive(), fetchedAt: '2026-11-15T06:00:00Z', now: NOW });
  const m = r.month;
  assert.equal(m.live.id, 'live');
  assert.equal(m.live.comparable, false);
  assert.equal(m.live.step, 'day');
  assert.equal(m.live.start, '2026-11-01');
  assert.deepEqual(m.live.values, [2, 2, 7]);
  assert.deepEqual(m.band.median, [55 / 30, 110 / 30, 165 / 30]);
  assert.deepEqual(m.band.p25, [32.5 / 30, 65 / 30, 97.5 / 30]);
  assert.deepEqual(m.band.p75, [77.5 / 30, 155 / 30, 232.5 / 30]);
  assert.equal(m.provisional, true);
  assert.equal(m.basis.years, 10);
  assert.equal(r.stale, false);
});

test('null day: cumulative turns null from it on, never 0; zero stays 0', () => {
  const r = liveComparison({ live: day('2026-11-01', [0, 0, null, 4]), harmonized: archive(), now: NOW });
  assert.deepEqual(r.month.live.values, [0, 0, null, null]);
  assert.equal(r.stale, true); // no fetched_at
});

test('own year and fewer than minYears: nulls in the band, not zeros', () => {
  const a = archive();
  a.values = a.values.slice(0, 12 * 4); // only 2012..2015 -> 4 years < 5
  const r = liveComparison({ live: day('2026-11-01', [1]), harmonized: a, now: NOW });
  assert.deepEqual(r.month.band.median, [null]);
  assert.deepEqual(r.month.live.values, [1]);
});

test('earlier years only, partial months excluded: a partial 2020-11 leaves 9 years', () => {
  const r = liveComparison({ live: day('2026-11-01', [0]), harmonized: archive(), partialMonths: ['2020-11'], now: NOW });
  assert.equal(r.month.basis.years, 9);
  // pool 10..70,90,100 -> median (50) ... sorted: 10 20 30 40 50 60 70 80?? 2020-11 = 90 removed: 10..80,100 -> median 50
  assert.equal(r.month.band.median[0], 50 / 30);
});

test('live data starting after the 1st of the current month: no month, no season, a reason', () => {
  const r = liveComparison({ live: day('2026-11-05', Array(10).fill(1)), harmonized: archive(), now: NOW });
  assert.equal(r.month, null);
  assert.equal(r.season, null);
  assert.match(r.reason, /after the 1st/);
});

test('season: whole months from the first covered one; the current month provisional with a scaled band', () => {
  // 2026-08-20 .. 2026-11-03: August is partial coverage so the season starts in September.
  const n = 12 + 30 + 31 + 3; // Aug 20-31, Sep, Oct, Nov 1-3
  const values = Array(n).fill(1);
  const r = liveComparison({ live: day('2026-08-20', values), harmonized: archive(), now: NOW });
  const s = r.season;
  assert.equal(s.live.step, 'month');
  assert.equal(s.live.start, '2026-09');
  assert.deepEqual(s.live.values, [30, 31, 3]);
  assert.deepEqual(s.band.median, [0, 0, 55 * (3 / 30)]); // Sep, Oct all-zero history; Nov scaled 3/30
  assert.deepEqual(s.band.p75, [0, 0, 77.5 * 0.1]);
  assert.equal(s.live.comparable, false);
  assert.equal(s.provisional, true);
});

test('empty live data', () => {
  const r = liveComparison({ live: day('2026-11-01', []), harmonized: archive(), now: NOW });
  assert.equal(r.month, null);
  assert.equal(r.reason, 'no live data');
});

test('isStale: older than 48 h or missing', () => {
  assert.equal(isStale('2026-11-13T12:00:00Z', NOW), false); // exactly 48 h
  assert.equal(isStale('2026-11-13T11:59:00Z', NOW), true);
  assert.equal(isStale(null, NOW), true);
  assert.equal(isStale('garbage', NOW), true);
});

test('liveCaveats: four kind live items, preliminary until V3', () => {
  const c = liveCaveats();
  assert.deepEqual(c.map((x) => x.id), ['live-nrt', 'live-not-harmonized', 'live-unfiltered', 'live-provisional']);
  assert.ok(c.every((x) => x.kind === 'live' && x.preliminary));
});
