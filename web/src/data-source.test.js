import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataSource, tileIdsForBbox, tileUrl, dataSourceConfig, DataSourceError } from './data-source.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('fixtures/manifest.json'));

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
const MT = [-60, -20, -50, -10];

test('tileIdsForBbox keeps only manifest tiles and treats the east/north edge as exclusive', () => {
  assert.deepEqual(tileIdsForBbox(MT, manifest), ['0.1/x12y7']);
  assert.deepEqual(tileIdsForBbox([-180, 40, -170, 50], manifest), ['0.1/x0y13']);
  assert.deepEqual(tileIdsForBbox([-60, -20, -50, -9.99], manifest).sort(), ['0.1/x12y7']);
  assert.deepEqual(tileIdsForBbox([10, 10, 11, 11], manifest), []);
});

test('tileIdsForBbox spans several tiles', () => {
  const m = { ...manifest, tiles: ['0.1/x12y6', '0.1/x12y7', '0.1/x13y7', '0.1/x13y6'] };
  assert.deepEqual(tileIdsForBbox([-58, -15, -45, -5], m).sort(), ['0.1/x12y7', '0.1/x13y7']);
  assert.equal(tileIdsForBbox([-60, -25, -40, 0], m).length, 4);
});

test('tileIdsForBbox rejects a bad bbox with a typed error', () => {
  assert.throws(() => tileIdsForBbox([1, 0, 0, 1], manifest), (e) => e instanceof DataSourceError && e.kind === 'bbox');
});

test('tileUrl joins base_url under the root, or keeps an absolute one', () => {
  assert.equal(tileUrl(manifest, '0.1/x12y7', '../'), '../fixtures/tiles/0.1/x12y7.json');
  assert.equal(tileUrl({ ...manifest, base_url: 'https://cdn.example/data' }, '0.1/x1y1', '../'), 'https://cdn.example/data/tiles/0.1/x1y1.json');
});

test('fixture mode points at /fixtures/', () => {
  assert.equal(dataSourceConfig({ fixtures: true }).manifestUrl, '../fixtures/manifest.json');
  assert.equal(dataSourceConfig().manifestUrl, '../data/manifest.json');
});

test('load returns validated tiles and caches them', async () => {
  const f = fakeFetch();
  const ds = src(f);
  const r = await ds.load(MT);
  assert.deepEqual(Object.keys(r.tiles), ['0.1/x12y7']);
  assert.equal(r.manifest.dataVersion, 'fixture-1');
  await ds.load(MT);
  assert.equal(f.calls.filter((u) => u.includes('x12y7')).length, 1);
  assert.equal(f.calls.filter((u) => u.endsWith('manifest.json')).length, 1);
});

test('concurrency is limited', async () => {
  const m = { ...manifest, tiles: Array.from({ length: 6 }, (_, i) => `0.1/x${i}y7`) };
  let active = 0;
  let peak = 0;
  const f = async (url) => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => m };
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { ok: true, json: async () => ({ cell: [], month: [], modis: [], viirs: [] }) };
  };
  const r = await src(f, { concurrency: 2 }).load([-180, -20, -120, -10]);
  assert.equal(r.ids.length, 6);
  assert.equal(peak, 2);
});

test('a new load aborts the previous one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const f = fakeFetch(async (url, signal) => {
    if (url.includes('x12y7')) await Promise.race([gate, new Promise((r) => signal.addEventListener('abort', r))]);
  });
  const ds = src(f);
  const first = ds.load(MT);
  await new Promise((r) => setTimeout(r, 5));
  const second = ds.load([-180, 40, -170, 50]);
  await assert.rejects(first, (e) => e.kind === 'aborted');
  assert.deepEqual((await second).ids, ['0.1/x0y13']);
  release();
});

test('typed errors: http, network, parse, invalid tile, invalid manifest', async () => {
  const miss = { ...manifest, tiles: ['0.1/x5y5'] };
  const http = (m) => async (url) => (url.endsWith('manifest.json') ? { ok: true, json: async () => m } : { ok: false, status: 404 });
  await assert.rejects(src(http(miss)).load([-130, -40, -120, -30]), (e) => e.kind === 'http' && /404/.test(e.message));

  await assert.rejects(src(async () => { throw new TypeError('offline'); }).load(MT), (e) => e.kind === 'network');

  await assert.rejects(src(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } })).load(MT), (e) => e.kind === 'parse');

  const bad = async (url) => ({ ok: true, json: async () => (url.endsWith('manifest.json') ? manifest : { cell: [1], month: [], modis: [], viirs: [] }) });
  await assert.rejects(src(bad).load(MT), (e) => e.kind === 'invalid' && /x12y7/.test(e.message) && e.errors.length > 0);

  await assert.rejects(src(async () => ({ ok: true, json: async () => ({ schema: 2 }) })).load(MT), (e) => e.kind === 'invalid' && /manifest/.test(e.message));
});

test('a failed tile is not cached', async () => {
  let fail = true;
  const f = async (url) => {
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (fail) return { ok: false, status: 500 };
    return { ok: true, json: async () => JSON.parse(read('fixtures/tiles/0.1/x12y7.json')) };
  };
  const ds = src(f);
  await assert.rejects(ds.load(MT), (e) => e.kind === 'http');
  fail = false;
  assert.deepEqual((await ds.load(MT)).ids, ['0.1/x12y7']);
});
