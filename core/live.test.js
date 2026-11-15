import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { liveComparison, liveCaveats, isStale, liveSeriesFromTiles, type0Share, typeBiasStatement, LIVE_MIN_CELLS } from './live.js';

// Archive: November 2012..2021 (10 years) = 10,20,...,100; other months 0. Series starts 2012-01.
// 2012-11 .. : 2012 = 10, ..., 2021 = 100. Band uses VIIRS-era years only (2012-02 on).
const archive = (start = '2012-01', years = 10) => {
  const values = [];
  for (let y = 2012; y < 2012 + years; y++) for (let m = 1; m <= 12; m++) values.push(m === 11 ? (y - 2011) * 10 : 0);
  return { id: 'harmonized', unit: 'fire-cell-days', start, values, method: { id: 'h', version: 1 }, comparable: true };
};
// Hand-built share table: by the end of day d a month has d/31 of its fire-cell-days.
const SHARE = Array.from({ length: 12 }, () => Array.from({ length: 31 }, (_, d) => (d + 1) / 31));
const day = (start, values, extra = {}) => ({ id: 'live', unit: 'fire-cell-days', units: 'snpp-equivalent', comparable: false, step: 'day', start, values, method: { id: 'x', version: 1 }, ...extra });
const NOW = new Date('2026-11-15T12:00:00Z');
const run = (live, o = {}) => liveComparison({ live, harmonized: archive(), share: SHARE, now: NOW, ...o });

test('real daily-share table, when present, is 12 x 31 and cumulative', () => {
  const f = new URL('./data/daily-share.json', import.meta.url);
  if (!existsSync(f)) return;
  const t = JSON.parse(readFileSync(f, 'utf8')).share;
  assert.equal(t.length, 12);
  for (const row of t) {
    assert.equal(row.length, 31);
    row.forEach((v, i) => { if (i) assert.ok(v >= row[i - 1]); });
  }
});

test('month to date: cumulative days against the monthly band times the share table', () => {
  // Pool 10..100: median 55, p25 32.5, p75 77.5 (type 7). Live days 1-3 = 2, 0, 5. share = d/31.
  const r = run(day('2026-11-01', [2, 0, 5]), { fetchedAt: '2026-11-15T06:00:00Z' });
  const m = r.month;
  assert.equal(m.live.comparable, false);
  assert.equal(m.live.step, 'day');
  assert.deepEqual(m.live.values, [2, 2, 7]);
  assert.deepEqual(m.band.median, [55 / 31, 110 / 31, 165 / 31]);
  assert.deepEqual(m.band.p25, [32.5 / 31, 65 / 31, 97.5 / 31]);
  assert.deepEqual(m.band.p75, [77.5 / 31, 155 / 31, 232.5 / 31]);
  assert.equal(m.basis.years, 10);
  assert.equal(r.lastCompleteDay, '2026-11-03');
  assert.equal(r.stale, false);
});

test('a null day ends the month to date: it is never counted as 0 and later days do not count', () => {
  const r = run(day('2026-11-01', [4, 1, null, 9]));
  assert.deepEqual(r.month.live.values, [4, 5]);
  assert.equal(r.month.band.median.length, 2);
  assert.equal(r.lastCompleteDay, '2026-11-02');
  assert.equal(r.stale, true); // no fetched_at
});

test('trailing null (the open fetch day) is left out; a zero day stays 0', () => {
  const r = run(day('2026-11-01', [0, 0, null]));
  assert.deepEqual(r.month.live.values, [0, 0]);
});

test('no complete day: no month, a reason', () => {
  const r = run(day('2026-11-01', [null, null]));
  assert.equal(r.month, null);
  assert.equal(r.season, null);
  assert.equal(r.reason, 'no complete live day');
  const first = run(day('2026-11-01', [null, 3]));
  assert.equal(first.month, null);
  assert.match(first.reason, /not a complete day/);
});

test('band uses VIIRS-era years only: a pre-2012-02 Nov and the own year never count', () => {
  const a = archive('2010-01', 12); // Novembers 2010..2021 = 10..120, but 2010 and 2011 are before 2012-02
  const r = liveComparison({ live: day('2026-11-01', [1]), harmonized: a, share: SHARE, now: NOW });
  assert.equal(r.month.basis.years, 10); // 2012..2021, not 12
  assert.equal(r.month.band.median[0], 75 / 31 / 1); // sorted 30..120 -> median 75, share 1/31
});

test('fewer than minYears VIIRS-era years: null band, not zeros', () => {
  const a = archive();
  a.values = a.values.slice(0, 12 * 4);
  const r = liveComparison({ live: day('2026-11-01', [1]), harmonized: a, share: SHARE, now: NOW });
  assert.deepEqual(r.month.band.median, [null]);
});

test('a partial archive month leaves the pool', () => {
  const r = run(day('2026-11-01', [0]), { partialMonths: ['2020-11'] });
  assert.equal(r.month.basis.years, 9);
  assert.equal(r.month.band.median[0], 50 / 31); // 10..80,100
});

test('live data starting after the 1st of the current month: no month, no season, a reason', () => {
  const r = run(day('2026-11-05', Array(10).fill(1)));
  assert.equal(r.month, null);
  assert.equal(r.season, null);
  assert.match(r.reason, /after the 1st/);
});

test('season: whole months, current month to its last complete day with the share band', () => {
  const values = [...Array(12).fill(1), ...Array(30).fill(1), ...Array(31).fill(1), 1, 1, 1, null]; // Aug 20.. Nov 3, Nov 4 null
  const r = run(day('2026-08-20', values));
  const s = r.season;
  assert.equal(s.live.start, '2026-09');
  assert.deepEqual(s.live.values, [30, 31, 3]);
  assert.deepEqual(s.band.median, [0, 0, 55 * (3 / 31)]);
  assert.deepEqual(s.band.p75, [0, 0, 77.5 * (3 / 31)]);
});

test('units must be snpp-equivalent: others are refused', () => {
  assert.throws(() => run(day('2026-11-01', [1], { units: 'modis' })), RangeError);
  assert.throws(() => run({ ...day('2026-11-01', [1]), units: undefined }), /snpp-equivalent/);
});

test('share table is required and checked', () => {
  assert.throws(() => liveComparison({ live: day('2026-11-01', [1]), harmonized: archive(), now: NOW }), TypeError);
  assert.throws(() => liveComparison({ live: day('2026-11-01', [1]), harmonized: archive(), share: [[1]], now: NOW }), TypeError);
});

test('small AOI: low confidence under the cell threshold, null when unknown', () => {
  assert.equal(run(day('2026-11-01', [1], { cells: LIVE_MIN_CELLS - 1 })).lowConfidence, true);
  assert.equal(run(day('2026-11-01', [1], { cells: LIVE_MIN_CELLS })).lowConfidence, false);
  assert.equal(run(day('2026-11-01', [1])).lowConfidence, null);
});

test('type filter: without a table the value stays and the month bias is stated; with one it is scaled', () => {
  const plain = run(day('2026-11-01', [10]));
  assert.equal(plain.typeAdjusted, false);
  assert.equal(plain.typeBias, typeBiasStatement(11));
  assert.match(plain.typeBias, /0\.4% to 1\.5%/);
  assert.deepEqual(plain.month.live.values, [10]);
  const t0 = Array(12).fill(0.98);
  const adj = run(day('2026-11-01', [10]), { type0Share: t0 });
  assert.equal(adj.typeAdjusted, true);
  assert.equal(adj.typeBias, null);
  assert.deepEqual(adj.month.live.values, [9.8]);
  assert.match(typeBiasStatement(3), /3% to 10%/);
  assert.match(typeBiasStatement(1), /not measured/);
});

test('type0Share: per calendar month ratio, VIIRS era, null when no detections', () => {
  const all = { start: '2012-01', values: [10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const t0 = { start: '2012-01', values: [9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const r = type0Share(all, t0);
  assert.equal(r[0], 0.5); // 2012-01 is before the VIIRS era and out; 2013-01 = 10 / 20
  assert.equal(r[1], 19 / 20); // Feb 2012 9/10 + Feb 2013 10/10
  assert.equal(r[5], null);
});

test('liveSeriesFromTiles: NOAA-20 x K inside the bbox; partial, uncovered and fetch days are null', () => {
  const manifest = { day0: '2026-11-01', last_day: '2026-11-05', fetched_at: '2026-11-05T10:00:00Z',
    coverage: { noaa20: ['2026-11-02', '2026-11-05'] }, partial_days: { noaa20: ['2026-11-04'] } };
  // tile x17y13 cell 0 center (-9.95, 40.05); cell 1 center (-9.85, 40.05)
  const tile = { cell: [0, 0, 0, 0, 1, 2], day: [1, 2, 3, 4, 2, 2], noaa20: [3, 2, 7, 9, 4, 1] };
  // day index 2 (11-03): cell 0 count 2 + cell 1 count 4 = 6; cell 2 (center -9.75) is outside the bbox
  const s = liveSeriesFromTiles({ x17y13: tile }, manifest, [-10, 40, -9.8, 40.1], { K: 2, cells: 4 });
  assert.deepEqual(s.values, [null, 6, 12, null, null]); // 11-02: 3 x 2; 11-03: 6 x 2; 11-04 partial; 11-05 fetch day
  assert.equal(s.units, 'snpp-equivalent');
  assert.equal(s.comparable, false);
  assert.equal(s.cells, 4);
  const only0 = liveSeriesFromTiles({ x17y13: tile }, manifest, [-10, 40, -9.9, 40.1], { K: 2 });
  assert.deepEqual(only0.values, [null, 6, 4, null, null]); // cell 1 left out: 11-03 = 2 x 2
  assert.throws(() => liveSeriesFromTiles({}, manifest, [-10, 40, -9.9, 40.1], { K: null }), RangeError);
  assert.throws(() => liveSeriesFromTiles({}, manifest, [-10, 40, -9.9, 40.1], { K: { value: 0 } }), RangeError);
});

test('isStale: older than 48 h or missing', () => {
  assert.equal(isStale('2026-11-13T12:00:00Z', NOW), false);
  assert.equal(isStale('2026-11-13T11:59:00Z', NOW), true);
  assert.equal(isStale(null, NOW), true);
  assert.equal(isStale('garbage', NOW), true);
});

test('liveCaveats: kind live, preliminary until V3, carry the V3 wording', () => {
  const c = liveCaveats();
  assert.equal(c.length, 8);
  assert.ok(c.every((x) => x.kind === 'live' && x.preliminary));
  const text = c.map((x) => x.long).join(' ');
  for (const w of ['approximate', 'NOAA-20', 'S-NPP', 'last complete', '2026-11-02', 'Earthdata Login', '2-3 month lag', 'type']) assert.ok(text.includes(w), w);
});
