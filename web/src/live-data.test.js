import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveInput, loadLiveTables, LIVE_REASONS } from './live-data.js';

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
