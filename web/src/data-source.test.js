import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataSource, tilesNeeded, tileUrl, domainUrl, dataSourceConfig, DataSourceError } from './data-source.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('fixtures/manifest.json'));
const domain = JSON.parse(read('fixtures/domain.json'));

// Serves the fixture files by URL; `hook(url, signal)` can delay, fail or record.
const fakeFetch = (hook = async () => {}) => {
  const calls = [];
  const fn = async (url, { signal } = {}) => {
    calls.push(url);
    await hook(url, signal);
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const path = url.replace(/^\.\.\//, '');
    try {
      return { ok: true, status: 200, json: async () => JSON.parse(read(path)) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };
  fn.calls = calls;
  return fn;
};
const src = (fetchFn, extra = {}) => createDataSource({ manifestUrl: '../fixtures/manifest.json', root: '../', fetchFn, ...extra });
const BOX = [-10, 40, 0, 50];
const ANTI = [-180, 60, -175, 65];

test('tilesNeeded: the area\'s fine tiles, and every coarse tile that holds part of the domain', () => {
  assert.deepEqual(tilesNeeded(BOX, manifest, domain), { fine: ['x17y13'], coarse: ['x17y13'] });
  assert.deepEqual(tilesNeeded(ANTI, manifest, domain), { fine: ['x0y15'], coarse: ['x17y13'] }, 'x0y15 lies outside the fixture domain');
  assert.deepEqual(tilesNeeded(ANTI, manifest, null).coarse, ['x0y15', 'x17y13'], 'without a domain every tile');
  assert.deepEqual(tilesNeeded([10, 10, 11, 11], manifest, domain).fine, []);
});

test('tilesNeeded: an area core reads at the coarse level needs no fine tile; a bad bbox is a typed error', () => {
  assert.deepEqual(tilesNeeded([-20, 30, 0, 50], manifest, domain).fine, [], '40,000 fine cells, above MAX_FINE_CELLS');
  assert.throws(() => tilesNeeded([1, 5, 2, 0], manifest), (e) => e instanceof DataSourceError && e.kind === 'bbox');
});

test('tileUrl and domainUrl join base_url under the root, or keep an absolute one', () => {
  assert.equal(tileUrl(manifest, 'x17y13', 0.1, '../'), '../fixtures/tiles/0.1/x17y13.json');
  assert.equal(tileUrl(manifest, 'x17y13', 1, '../'), '../fixtures/tiles/1/x17y13.json');
  assert.equal(tileUrl({ ...manifest, base_url: 'https://cdn.example/data' }, 'x1y1', 0.1, '../'), 'https://cdn.example/data/tiles/0.1/x1y1.json');
  assert.equal(domainUrl(manifest, '../'), '../fixtures/domain.json');
  assert.equal(domainUrl({ ...manifest, domain: undefined }), null);
  assert.throws(() => domainUrl({ ...manifest, domain: { ...manifest.domain, file: '../secret.json' } }), (e) => e.kind === 'invalid');
});

test('fixture mode points at /fixtures/', () => {
  assert.equal(dataSourceConfig({ fixtures: true }).manifestUrl, '../fixtures/manifest.json');
  assert.equal(dataSourceConfig().manifestUrl, '../data/manifest.json');
});

test('load returns the validated domain, fine and coarse tiles, and caches them', async () => {
  const f = fakeFetch();
  const ds = src(f);
  const r = await ds.load(BOX);
  assert.deepEqual(Object.keys(r.tiles.fine), ['x17y13']);
  assert.deepEqual(Object.keys(r.tiles.coarse), ['x17y13']);
  assert.deepEqual(r.domain, domain);
  assert.equal(r.manifest.dataVersion, 'fixture-1');
  await ds.load(BOX);
  assert.equal(f.calls.filter((u) => u.includes('x17y13')).length, 2, 'one fine and one coarse fetch');
  assert.equal(f.calls.filter((u) => u.endsWith('manifest.json')).length, 1);
  assert.equal(f.calls.filter((u) => u.endsWith('domain.json')).length, 1);
});

test('a manifest without a domain loads no domain file', async () => {
  const m = { ...manifest, tiles: ['x17y13'], domain: undefined };
  const f = fakeFetch();
  const g = async (url, init) => (url.endsWith('manifest.json') ? { ok: true, json: async () => m } : f(url, init));
  const r = await src(g).load(BOX);
  assert.equal(r.domain, null);
  assert.equal(f.calls.some((u) => u.endsWith('domain.json')), false);
});

test('concurrency is limited', async () => {
  const m = { ...manifest, tiles: Array.from({ length: 6 }, (_, i) => `x${i}y7`), domain: undefined };
  let active = 0;
  let peak = 0;
  const f = async (url) => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => m };
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { ok: true, json: async () => ({ cell: [], month: [], modis: [], viirs: [], noaa20: [] }) };
  };
  const r = await src(f, { concurrency: 2 }).load([-179, -19, -125, -11]);
  assert.deepEqual([r.ids.fine.length, r.ids.coarse.length], [0, 6], 'a 54 degree wide area is read at the coarse level only');
  assert.equal(peak, 2);
});

test('a new load aborts the previous one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = fakeFetch(async (url, signal) => {
    if (url.includes('0.1/x17y13')) await Promise.race([gate, new Promise((r) => signal.addEventListener('abort', r))]);
  });
  const ds = src(f);
  const first = ds.load(BOX);
  await new Promise((r) => setTimeout(r, 5));
  const second = ds.load(ANTI);
  await assert.rejects(first, (e) => e.kind === 'aborted');
  assert.deepEqual((await second).ids.fine, ['x0y15']);
  release();
});

test('typed errors: http, network, parse, invalid tile, invalid domain, invalid manifest', async () => {
  const miss = { ...manifest, tiles: ['x5y5'], domain: undefined };
  const http = (m) => async (url) => (url.endsWith('manifest.json') ? { ok: true, json: async () => m } : { ok: false, status: 404 });
  await assert.rejects(src(http(miss)).load([-130, -40, -120, -30]), (e) => e.kind === 'http' && /404/.test(e.message));

  await assert.rejects(src(async () => { throw new TypeError('offline'); }).load(BOX), (e) => e.kind === 'network');

  await assert.rejects(src(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })).load(BOX), (e) => e.kind === 'parse');

  const serve = (over) => async (url) => ({ ok: true, json: async () => over(url) ?? JSON.parse(read(url.replace(/^\.\.\//, ''))) });
  await assert.rejects(src(serve((u) => (u.includes('tiles/0.1') ? { cell: [1], month: [], modis: [], viirs: [], noaa20: [] } : null))).load(BOX),
    (e) => e.kind === 'invalid' && /0\.1\/x17y13/.test(e.message) && e.errors.length > 0);
  await assert.rejects(src(serve((u) => (u.endsWith('domain.json') ? { rows: { 5000: [] } } : null))).load(BOX), (e) => e.kind === 'invalid' && /domain/.test(e.message));

  await assert.rejects(src(async () => ({ ok: true, json: async () => ({ schema: 2 }) })).load(BOX), (e) => e.kind === 'invalid' && /manifest/.test(e.message));
});

test('a failed tile is not cached', async () => {
  let fail = true;
  const f = fakeFetch(async (url) => { if (fail && url.includes('tiles/')) throw new TypeError('offline'); });
  const ds = src(f);
  await assert.rejects(ds.load(BOX), (e) => e.kind === 'network');
  fail = false;
  assert.deepEqual((await ds.load(BOX)).ids.fine, ['x17y13']);
});
