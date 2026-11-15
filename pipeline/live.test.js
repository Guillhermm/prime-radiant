import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { partialDays, buildLiveManifest, buildLiveTiles, downloadNrt, nrtUrls, buildLive, serializeLiveTile } from './live.js';
import { binRecords } from './bin.js';
import { locate } from '../core/grid.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr-live-'));
const rec = (o) => ({ sensor: 'modis', satellite: 'Terra', lat: 40.05, lon: -9.95, utcDay: '2026-11-10', hasType: false, ...o });

test('nrtUrls: three global files for a window, and a bad window throws', () => {
  const u = nrtUrls('24h');
  assert.equal(u.length, 3);
  assert.ok(u.every((x) => x.startsWith('https://firms.modaps.eosdis.nasa.gov/data/active_fire/') && x.endsWith('_24h.csv')));
  assert.throws(() => nrtUrls('30d'), /window/);
});

test('downloadNrt writes the files through the injected fetch; a non-2xx throws without the URL query', async () => {
  const dir = tmp();
  const fetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(`body of ${path.basename(url)}`) });
  const files = await downloadNrt({ fetch, urls: nrtUrls('7d'), dir });
  assert.equal(files.length, 3);
  assert.equal(fs.readFileSync(files[0], 'utf8'), 'body of MODIS_C6_1_Global_7d.csv');
  await assert.rejects(downloadNrt({ fetch: async () => ({ ok: false, status: 503 }), urls: nrtUrls('7d'), dir }), /503.*MODIS_C6_1_Global_7d/);
});

test('binRecords bins days since day0 and needs exactly one of month0 and day0', async () => {
  const r = await binRecords([rec({}), rec({ utcDay: '2026-11-12' })], { day0: '2026-11-10', allowNoType: true });
  const l = locate(-9.95, 40.05);
  assert.deepEqual(Object.fromEntries(r.counts.modis[l.tile][l.cell]), { 0: 1, 2: 1 });
  await assert.rejects(binRecords([], {}), /exactly one/);
  await assert.rejects(binRecords([], { month0: '2026-01', day0: '2026-01-01' }), /exactly one/);
});

test('without allowNoType a record with no type is skipped and counted', async () => {
  const r = await binRecords([rec({})], { day0: '2026-11-10' });
  assert.equal(r.stats.skipped.no_type, 1);
  assert.equal(r.stats.counted, 0);
});

test('buildLiveTiles: null outside a sensor day coverage, 0 inside, rows sorted', () => {
  const l = locate(-9.95, 40.05);
  const counts = { modis: { [l.tile]: { [l.cell]: new Map([[101, 2], [100, 1]]) } }, viirs: { [l.tile]: { [l.cell]: new Map([[101, 1]]) } } };
  const t = buildLiveTiles(counts, { modis: [100, 101], viirs: [101, 101], noaa20: null }, 100).get(l.tile);
  assert.deepEqual(t, { cell: [l.cell, l.cell], day: [0, 1], modis: [1, 2], viirs: [null, 1], noaa20: [null, null] });
  assert.match(serializeLiveTile(t), /^\{\n {2}"cell": \[\d+,\d+\],\n {2}"day": \[0,1\],/);
});

test('partialDays: under 50% of the median, the fetch day, a feed that ended early; never the first day', () => {
  const counts = { '2026-11-08': 10, '2026-11-09': 100, '2026-11-10': 49, '2026-11-11': 100, '2026-11-12': 100, '2026-11-13': 100 };
  // median of 7 days (11-14 has no records: 0) is 100; 11-08 is the first day and 10 < 50 still counts as partial by the rule
  assert.deepEqual(partialDays(counts, { first: '2026-11-09', last: '2026-11-13' }, '2026-11-20'), ['2026-11-10']);
  assert.deepEqual(partialDays({ ...counts, '2026-11-10': 50 }, { first: '2026-11-09', last: '2026-11-13' }, '2026-11-20'), []);
  assert.deepEqual(partialDays(counts, { first: '2026-11-09', last: '2026-11-13' }, '2026-11-13'), ['2026-11-10', '2026-11-13']);
  assert.deepEqual(partialDays(counts, { first: '2026-11-09', last: '2026-11-13' }, '2026-11-20', '2026-11-14'), ['2026-11-10', '2026-11-13']);
  assert.deepEqual(partialDays({ '2026-11-09': 100, '2026-11-11': 100 }, { first: '2026-11-09', last: '2026-11-11' }, 'x'), ['2026-11-10'], 'a day with no records inside the window');
});

test('buildLiveManifest: partial days from record counts, fetch day, no coverage throws', () => {
  const days = { modis: { first: '2026-11-08', last: '2026-11-14' }, viirs: { first: '2026-11-09', last: '2026-11-15' } };
  const full = (a, b, n) => Object.fromEntries(Array.from({ length: b - a + 1 }, (_, i) => [`2026-11-${String(a + i).padStart(2, '0')}`, n]));
  const dayCounts = { modis: { ...full(8, 14, 100), '2026-11-11': 10 }, viirs: full(9, 15, 100) };
  const m = buildLiveManifest({ fetchedAt: '2026-11-15T09:00:00Z', days, dayCounts, tiles: [], sources: [{ file: 'a.csv' }] });
  assert.equal(m.day0, '2026-11-08');
  assert.equal(m.last_day, '2026-11-15');
  assert.deepEqual(m.coverage.noaa20, null);
  assert.deepEqual(m.partial_days, { modis: ['2026-11-11', '2026-11-14'], viirs: ['2026-11-15'], noaa20: [] }); // modis ended a day early
  assert.equal(m.partial_share, 0.5);
  assert.deepEqual(m.daily_records, dayCounts);
  assert.throws(() => buildLiveManifest({ fetchedAt: '2026-11-15T09:00:00Z', days: {}, tiles: [], sources: [] }), /coverage/);
});

test('buildLiveTiles writes a sensor\'s partial days as null, not 0 and not the count', () => {
  const l = locate(-9.95, 40.05);
  const counts = { modis: { [l.tile]: { [l.cell]: new Map([[100, 1], [101, 2]]) } }, viirs: { [l.tile]: { [l.cell]: new Map([[100, 3]]) } } };
  const cov = { modis: [100, 101], viirs: [100, 101], noaa20: null };
  const t = buildLiveTiles(counts, cov, 100, { modis: ['1970-04-12'] }).get(l.tile); // day 101 = 1970-04-12
  assert.deepEqual(t.modis, [1, null]);
  assert.deepEqual(t.viirs, [3, 0]);
});

test('buildLive rejects a missing or non-UTC fetchedAt and empty inputs', async () => {
  await assert.rejects(buildLive({ inputs: ['x'], outDir: tmp() }), /fetchedAt/);
  await assert.rejects(buildLive({ inputs: [tmp()], outDir: tmp(), fetchedAt: '2026-11-15T09:00:00Z' }), /no \.csv/);
});

test('a file with a type column is read and flagged has_type; type != 0 is still excluded', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'typed.csv'), 'latitude,longitude,acq_date,acq_time,satellite,type\n40.05,-9.95,2026-11-10,0100,Terra,0\n40.15,-9.85,2026-11-10,0100,Terra,2\n');
  const { manifest, stats } = await buildLive({ inputs: [dir], outDir: path.join(dir, 'out'), fetchedAt: '2026-11-11T00:00:00Z' });
  assert.deepEqual(manifest.sources, [{ file: 'typed.csv', records: 1, has_type: true }]);
  assert.equal(stats.records_without_type, 0);
  assert.equal(stats.rejected.type_excluded, 1);
});
