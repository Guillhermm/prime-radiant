import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIVE_EXAMPLES, liveInput, loadLiveTables, LIVE_REASONS, runningTotalDisclaimer } from './live-data.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const share = read('../../core/data/daily-share.json').share;
const type0 = read('../../core/data/type0-share.json').share;
const archive = read('../../fixtures/manifest.json');
const domain = read('../../fixtures/domain.json');

// Archive harmonized series: 300 fire-cell-days every month, 2013-01 to 2026-10.
const months = (2026 - 2013) * 12 + 10;
const harmonized = { id: 'harmonized', unit: 'fire-cell-days', step: 'month', start: '2013-01', values: Array(months).fill(300), comparable: true, method: { id: 'h', version: 1 } };
const bbox = [-10, 40, 0, 50];
const result = (o = {}) => ({ bbox, manifest: archive, harmonized: { K: { value: 1.2, usable: true }, series: harmonized }, partialMonths: [], domain: null, ...o });

// NOAA-20 from 2026-11-01 to 11-12, 10 detections a day in one cell of x17y13.
const lm = {
  schema: 1, kind: 'live', fetched_at: '2026-11-13T03:30:00Z', base_url: 'data/live/', grid: { res: 0.1, tile_deg: 10 }, granularity: 'day',
  day0: '2026-11-01', last_day: '2026-11-12', coverage: { modis: null, viirs: null, noaa20: ['2026-11-01', '2026-11-12'] },
  partial_days: { modis: [], viirs: [], noaa20: [] }, tiles: ['x17y13'],
};
const tile = { cell: Array(12).fill(0), day: [...Array(12).keys()], modis: Array(12).fill(null), viirs: Array(12).fill(null), noaa20: Array(12).fill(10) };
const now = new Date('2026-11-13T06:00:00Z');

test('no live data gives the unavailable reason', () => {
  assert.deepEqual(liveInput({ result: result(), live: null, share, type0, now }), { reason: LIVE_REASONS.unavailable, fetched_at: null });
});

test('an area outside the live domain has no comparison', () => {
  const out = liveInput({ result: result({ bbox: [100, -10, 101, -9] }), live: { manifest: lm, domain, tiles: {} }, share, type0, now });
  assert.equal(out.reason, LIVE_REASONS.outside);
  assert.equal(out.fetched_at, lm.fetched_at);
});

test('no usable K: live values cannot be put in archive units', () => {
  const out = liveInput({ result: result({ harmonized: { K: null, series: harmonized } }), live: { manifest: lm, domain: null, tiles: { x17y13: tile } }, share, type0, now });
  assert.equal(out.reason, LIVE_REASONS.noK);
});

test('month to date: NOAA-20 x K x type-0 share, counted days, no Preview', () => {
  const out = liveInput({ result: result(), live: { manifest: lm, domain: null, tiles: { x17y13: tile } }, share, type0, now });
  assert.equal(out.reason, undefined);
  assert.equal(out.preview, false);
  assert.equal(out.live.step, 'day');
  assert.equal(out.live.start, '2026-11-01');
  assert.equal(out.live.values.length, 12);
  // 12 days x 10 x K 1.2 x November type-0 share
  assert.ok(Math.abs(out.live.values.at(-1) - 12 * 10 * 1.2 * type0[10]) < 1e-9);
  assert.equal(out.band.median.length, 12);
  assert.ok(out.notes.some((n) => n.startsWith('12 complete days counted through 2026-11-12')));
  assert.equal(out.lowConfidence, false);
});

test('live data starting after the 1st names the days not observed', () => {
  const late = { ...lm, day0: '2026-11-04', coverage: { ...lm.coverage, noaa20: ['2026-11-04', '2026-11-12'] } };
  const t = { ...tile, cell: tile.cell.slice(3), day: [...Array(9).keys()], modis: tile.modis.slice(3), viirs: tile.viirs.slice(3), noaa20: tile.noaa20.slice(3) };
  const out = liveInput({ result: result(), live: { manifest: late, domain: null, tiles: { x17y13: t } }, share, type0, now });
  assert.ok(out.notes[0].startsWith('2026-11-01 to 2026-11-03 not observed'));
  assert.equal(out.lowConfidence, true);
});

test('fewer than 7 counted days after a late start: no comparison, with the reason', () => {
  const late = { ...lm, day0: '2026-11-09', coverage: { ...lm.coverage, noaa20: ['2026-11-09', '2026-11-12'] } };
  const t = { cell: [0, 0, 0, 0], day: [0, 1, 2, 3], modis: Array(4).fill(null), viirs: Array(4).fill(null), noaa20: Array(4).fill(10) };
  const out = liveInput({ result: result(), live: { manifest: late, domain: null, tiles: { x17y13: t } }, share, type0, now });
  assert.match(out.reason, /^No complete live day for this area yet\. \(live data starts on 2026-11-09/);
});

test('loadLiveTables fetches the daily-share and type-0 tables', async () => {
  const ok = await loadLiveTables(async (url) => ({ ok: true, json: async () => ({ share: String(url).endsWith('type0-share.json') ? type0 : share }) }));
  assert.equal(ok.type0, type0);
  assert.equal(ok.share, share);
});

test('a global live build with the static mask: no type scaling, no type-bias note', () => {
  const g = { ...lm, static_mask: { data_version: 'v1', cells: 10 } };
  const out = liveInput({ result: result(), live: { manifest: g, domain: null, tiles: { x17y13: tile } }, share, type0, now });
  assert.ok(Math.abs(out.live.values.at(-1) - 12 * 10 * 1.2) < 1e-9);
  assert.equal(out.lowConfidence, false);
});

test('a global live build: inside the share region, month to date; outside, the running total without a band, then whole past months', () => {
  const g = { ...lm, static_mask: { data_version: 'v1', cells: 10 }, share_domain: { id: 'brazil', file: 'share-domain.json', res: 0.1 } };
  const inside = liveInput({ result: result(), live: { manifest: g, domain: null, shareDomain: domain, tiles: { x17y13: tile } }, share, type0, now });
  assert.equal(inside.live.step, 'day');
  // A share region far away (one cell row near the South Pole): the area is not in it.
  const far = { rows: { 5: [[0, 9]] } };
  const away = liveInput({ result: result(), live: { manifest: g, domain: null, shareDomain: far, tiles: { x17y13: tile } }, share, type0, now });
  assert.equal(away.reason, undefined);
  assert.equal(away.band, null, 'no archive band outside the share region');
  assert.equal(away.live.step, 'day');
  assert.ok(Math.abs(away.live.values.at(-1) - 12 * 10 * 1.2) < 1e-9, 'NOAA-20 x K, S-NPP units');
  assert.equal(away.title, 'This month so far');
  assert.equal(away.examples, LIVE_EXAMPLES, 'outside the share region: the examples callout');
  assert.equal(inside.examples, undefined, 'inside: no callout');
  assert.match(away.sub, /no comparison with past years yet/);
  assert.equal(away.disclaimer, 'NOAA-20 near-real-time, scaled to S-NPP, approximate. Running total since 1 Nov only. Not a monthly total, no comparison to past years. Static heat sources are masked from the archive; newer flares or eruptions can leak in.');
  // Live from 11-08 (prod, 2026-11-16): days 1 to 7 not observed, still a running total, low confidence.
  const late = { ...g, fetched_at: '2026-11-16T03:30:00Z', day0: '2026-11-08', last_day: '2026-11-15', coverage: { ...g.coverage, noaa20: ['2026-11-08', '2026-11-15'] } };
  const t8 = { cell: Array(8).fill(0), day: [...Array(8).keys()], modis: Array(8).fill(null), viirs: Array(8).fill(null), noaa20: Array(8).fill(10) };
  const nov = liveInput({ result: result(), live: { manifest: late, domain: null, shareDomain: far, tiles: { x17y13: t8 } }, share, type0, now: new Date('2026-11-16T06:00:00Z') });
  assert.equal(nov.band, null);
  assert.deepEqual(nov.live.values.slice(0, 7), Array(7).fill(null));
  assert.equal(nov.disclaimer, 'NOAA-20 near-real-time, scaled to S-NPP, approximate. Running total since 8 Nov only (1 to 7 Nov not observed). Not a monthly total, no comparison to past years. Static heat sources are masked from the archive; newer flares or eruptions can leak in.');
  assert.equal(nov.lowConfidence, true);
  assert.ok(nov.lowConfidenceReasons.some((r) => /not observed/.test(r)));
  // Too few days counted for a month: the reason stays.
  const t3 = { cell: Array(3).fill(0), day: [...Array(3).keys()], modis: Array(3).fill(null), viirs: Array(3).fill(null), noaa20: Array(3).fill(10) };
  const early = { ...g, fetched_at: '2026-11-11T03:30:00Z', day0: '2026-11-08', last_day: '2026-11-10', coverage: { ...g.coverage, noaa20: ['2026-11-08', '2026-11-10'] } };
  const msg = liveInput({ result: result(), live: { manifest: early, domain: null, shareDomain: far, tiles: { x17y13: t3 } }, share, type0, now: new Date('2026-11-11T06:00:00Z') });
  assert.equal(msg.reason, LIVE_REASONS.wholeMonths('2026-11-08'));
  assert.equal(msg.examples, LIVE_EXAMPLES, 'the first-comparison message carries the examples too');
  // Live from 2026-10-01 to 11-12: October is whole and compared, November is left out.
  const long = { ...g, day0: '2026-10-01', coverage: { ...g.coverage, noaa20: ['2026-10-01', '2026-11-12'] } };
  const t = { cell: Array(43).fill(0), day: [...Array(43).keys()], modis: Array(43).fill(null), viirs: Array(43).fill(null), noaa20: Array(43).fill(10) };
  const oct = liveInput({ result: result(), live: { manifest: long, domain: null, shareDomain: far, tiles: { x17y13: t } }, share, type0, now });
  assert.equal(oct.live.step, 'month');
  assert.equal(oct.live.start, '2026-10');
  assert.equal(oct.live.values.length, 1);
  assert.ok(Math.abs(oct.live.values[0] - 31 * 10 * 1.2) < 1e-9);
  assert.equal(oct.band.median.length, 1);
  assert.equal(oct.examples, undefined, 'a whole-months comparison needs no examples');
  assert.match(oct.notes.at(-1), /^This month so far: [\d,]+ fire-cell-days through 12 Nov, not compared with past years outside Brazil\.$/);
});

test('the running-total disclaimer names one unseen day without a range', () => {
  const m = { month: '2026-11', live: { values: [null, 5, 9] }, daysNotObserved: ['2026-11-01'] };
  assert.match(runningTotalDisclaimer(m), /Running total since 2 Nov only \(1 Nov not observed\)\./);
});

test('live examples are 1 degree squares inside Brazil, named by their center', () => {
  assert.equal(LIVE_EXAMPLES.length, 3);
  for (const { name, bbox: [w, s, e, n] } of LIVE_EXAMPLES) {
    assert.deepEqual([e - w, n - s], [1, 1]);
    assert.ok(w >= -74 && e <= -34 && s >= -34 && n <= 6, `${name} lies in Brazil's extent`);
    assert.equal(name, `${Math.abs(s + 0.5)}°S ${Math.abs(w + 0.5)}°W`);
  }
});
