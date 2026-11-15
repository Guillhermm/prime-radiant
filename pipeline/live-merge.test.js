import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepFrom, mergeLive, readLive, writeLive } from './live-merge.js';
import { buildLiveManifest, buildLiveTiles } from './live.js';
import { dayNumber } from './bin.js';
import { validateLiveManifest, validateLiveTile } from '../core/schema.js';

const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const DAY = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

// A NOAA-20-only build over [first, last], one cell with `n(day)` fire-cell-days, records per day `rec(day)`.
const build = ({ first, last, fetchedAt, n = () => 1, rec = () => 1000 }) => {
  const days = { noaa20: { first, last } };
  const dayCounts = { noaa20: {} };
  const cells = new Map();
  for (let d = dayNumber(first); d <= dayNumber(last); d++) {
    dayCounts.noaa20[DAY(d)] = { D: rec(DAY(d)), N: rec(DAY(d)) };
    if (n(DAY(d))) cells.set(d, n(DAY(d)));
  }
  const manifest = buildLiveManifest({ fetchedAt, days, dayCounts, tiles: ['x17y13'], sources: [{ file: 'J1.csv', records: 1, has_type: false }] });
  const cov = { modis: null, viirs: null, noaa20: manifest.coverage.noaa20.map(dayNumber) };
  const tiles = buildLiveTiles({ noaa20: { x17y13: { 5: cells } } }, cov, dayNumber(manifest.day0), manifest.partial_days);
  return { manifest, tiles: Object.fromEntries(tiles) };
};
const valueOn = (merged, day) => {
  const t = merged.tiles.get('x17y13');
  const i = t.day.findIndex((d) => DAY(dayNumber(merged.manifest.day0) + d) === day);
  return i < 0 ? undefined : t.noaa20[i];
};

test('keepFrom: the 1st of the month before', () => {
  assert.equal(keepFrom('2026-11-15'), '2026-10-01');
  assert.equal(keepFrom('2027-01-03'), '2026-12-01');
});

test('merge keeps the earlier days, takes the newest build, and keeps the earlier copy of the new window\'s first day', () => {
  const prev = build({ first: '2026-11-01', last: '2026-11-08', fetchedAt: '2026-11-08T06:00:00Z', n: () => 2 });
  const next = build({ first: '2026-11-03', last: '2026-11-09', fetchedAt: '2026-11-09T06:00:00Z', n: (d) => (d === '2026-11-03' ? 1 : 3) });
  const m = mergeLive(prev, next);
  assert.deepEqual(validateLiveManifest(m.manifest), []);
  for (const t of m.tiles.values()) assert.deepEqual(validateLiveTile(t, { manifest: m.manifest }), []);
  assert.equal(m.manifest.day0, '2026-11-01');
  assert.deepEqual(m.manifest.coverage.noaa20, ['2026-11-01', '2026-11-09']);
  assert.equal(valueOn(m, '2026-11-01'), 2, 'only the earlier build has it');
  assert.equal(valueOn(m, '2026-11-03'), 2, 'the new window starts mid-day: the earlier copy wins');
  assert.equal(valueOn(m, '2026-11-05'), 3, 'the newest build wins');
  assert.ok(m.manifest.partial_days.noaa20.includes('2026-11-09') && typeof valueOn(m, '2026-11-09') !== 'number', 'the fetch day is partial: no count');
  assert.ok(m.manifest.partial_days.noaa20.includes('2026-11-08') === false, 'yesterday\'s fetch day is complete in the new build');
});

test('a day kept from the earlier build where it was null stays null; old months are dropped', () => {
  const prev = build({ first: '2026-09-20', last: '2026-11-04', fetchedAt: '2026-11-04T06:00:00Z', n: () => 1, rec: (d) => (d === '2026-10-20' ? 10 : 1000) });
  assert.ok(prev.manifest.partial_days.noaa20.includes('2026-10-20'));
  const next = build({ first: '2026-11-05', last: '2026-11-06', fetchedAt: '2026-11-06T06:00:00Z' });
  const m = mergeLive(prev, next);
  assert.equal(m.manifest.day0, '2026-10-01');
  assert.ok(m.manifest.partial_days.noaa20.includes('2026-10-20'));
  assert.notEqual(typeof valueOn(m, '2026-10-20'), 'number');
  assert.equal(valueOn(m, '2026-10-21'), 1);
});

test('no earlier build: the new one as is; write and read back from a folder', async () => {
  const next = build({ first: '2026-11-05', last: '2026-11-07', fetchedAt: '2026-11-07T06:00:00Z' });
  const m = mergeLive(null, next);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-live-'));
  dirs.push(dir);
  writeLive(m, dir);
  const back = await readLive(dir);
  assert.deepEqual(back.manifest.coverage, next.manifest.coverage);
  assert.deepEqual(back.tiles.x17y13, next.tiles.x17y13);
  assert.equal(await readLive(path.join(dir, 'missing')), null);
});

test('readLive over https: the root manifest names the version; a 404 means no earlier build', async () => {
  const next = build({ first: '2026-11-05', last: '2026-11-07', fetchedAt: '2026-11-07T06:00:00Z' });
  const manifest = { ...next.manifest, base_url: 'data/live/v/202611070600/' };
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    if (url.endsWith('live/manifest.json')) return { ok: true, status: 200, json: async () => manifest };
    if (url.endsWith('/live/v/202611070600/tiles/0.1/x17y13.json')) return { ok: true, status: 200, json: async () => next.tiles.x17y13 };
    return { ok: false, status: 404 };
  };
  const got = await readLive('https://data.example.org', { fetchFn });
  assert.deepEqual(got.tiles.x17y13, next.tiles.x17y13);
  assert.equal(await readLive('https://data.example.org', { fetchFn: async () => ({ ok: false, status: 404 }) }), null);
  await assert.rejects(readLive('https://data.example.org', { fetchFn: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
});

test('an earlier build over another domain is not merged', () => {
  const prev = build({ first: '2026-11-01', last: '2026-11-04', fetchedAt: '2026-11-04T06:00:00Z' });
  const next = build({ first: '2026-11-05', last: '2026-11-06', fetchedAt: '2026-11-06T06:00:00Z' });
  const m = mergeLive({ ...prev, manifest: { ...prev.manifest, domain: { id: 'other', version: '1', file: 'domain.json', res: 0.1 } } }, next);
  assert.equal(m.manifest.day0, '2026-11-05');
});
