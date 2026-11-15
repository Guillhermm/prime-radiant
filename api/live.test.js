import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, parseCsv, snapBbox, SOURCES } from './live.js';
import { validateSeries } from '../core/schema.js';

const KEY = 'SECRETKEY1234567890abcdef';
const NOW = Date.parse('2026-11-14T10:00:00Z');
const HEAD = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite';
const csv = (...rows) => [HEAD, ...rows].join('\n');
const row = (lat, lon, date) => `${lat},${lon},330,0.4,0.4,${date},0130,N`;
const call = (qs, { fetch, env = { MAP_KEY: KEY } } = {}) =>
  handle(new Request(`https://x.test/api/live?${qs}`), { fetch, env, now: () => NOW });
const ok = (text) => async () => new Response(text, { status: 200 });
const BBOX = 'bbox=-55.5,-10.5,-54,-9.5&days=2';

test('parseCsv reads FIRMS rows and rejects a non-CSV body', () => {
  assert.deepEqual(parseCsv(csv(row(-9.95, -54.81, '2026-11-14'))), [{ lon: -54.81, lat: -9.95, date: '2026-11-14' }]);
  assert.throws(() => parseCsv('Invalid MAP_KEY'));
  assert.throws(() => parseCsv(''));
  assert.deepEqual(parseCsv(csv(',,330,0.4,0.4,2026-11-14,0130,N', 'x,1,330,0.4,0.4,2026-11-14,0130,N', '1,2', row(1, 2, ''))), []);
});

test('bins distinct cell-days across sources into a live Series', async () => {
  const bodies = {
    VIIRS_NOAA20_NRT: csv(row(-9.95, -54.81, '2026-11-13'), row(-9.951, -54.812, '2026-11-13'), row(-9.5, -54.0, '2026-11-14')),
    VIIRS_NOAA21_NRT: csv(row(-9.95, -54.81, '2026-11-13')),
    MODIS_NRT: csv(row(-9.7, -54.5, '2026-11-14'), row(-9.7, -54.5, '2026-11-20'), row(0, 0, '2026-11-14')),
  };
  const urls = [];
  const fetch = async (url, init) => {
    assert.ok(init?.signal instanceof AbortSignal, 'upstream call needs a timeout');
    urls.push(url);
    return new Response(bodies[SOURCES.find((s) => url.includes(`/${s}/`))]);
  };
  const res = await call(BBOX, { fetch });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.bbox, [-55.5, -10.5, -54, -9.5]);
  assert.deepEqual(body.series, {
    id: 'live', comparable: false, step: 'day', unit: 'fire-cell-days', start: '2026-11-13',
    values: [1, 2], method: { id: 'firms-nrt-proxy', version: '1' },
  });
  assert.deepEqual(validateSeries(body.series).filter((e) => e.path !== 'start'), []);
  assert.equal(res.headers.get('Cache-Control'), 's-maxage=900, stale-while-revalidate=3600');
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => u.endsWith('/-55.5,-10.5,-54,-9.5/2/2026-11-13')));
  assert.ok(!JSON.stringify(body).includes(KEY));
});

test('400 on bad bbox and bad days, without calling upstream', async () => {
  const fetch = async () => assert.fail('upstream must not be called');
  for (const qs of ['days=1', 'bbox=1,2,3', 'bbox=a,b,c,d', 'bbox=10,0,5,5', 'bbox=-200,0,5,5', 'bbox=0,0,100,100', `${BBOX.split('&')[0]}&days=3`, `${BBOX.split('&')[0]}&days=0`]) {
    assert.equal((await call(qs, { fetch })).status, 400, qs);
  }
});

test('snapBbox snaps outward to the 0.5 degree grid and clamps to the globe', () => {
  assert.deepEqual(snapBbox([-55.1, -10.2, -54.3, -9.6]), [-55.5, -10.5, -54, -9.5]);
  assert.deepEqual(snapBbox([-180, -90, 180, 90]), [-180, -90, 180, 90]);
  assert.deepEqual(snapBbox([1, 2, 3, 4]), [1, 2, 3, 4]);
});

test('400 naming the snapped bbox when the bbox is off the grid', async () => {
  const fetch = async () => assert.fail('upstream must not be called');
  const res = await call('bbox=-55.1,-10.2,-54.3,-9.6&days=2', { fetch });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await res.json()).bbox, [-55.5, -10.5, -54, -9.5]);
});

test('400 on unknown or repeated query params', async () => {
  const fetch = async () => assert.fail('upstream must not be called');
  for (const qs of [`${BBOX}&x=1`, `${BBOX}&_=123`, `${BBOX}&days=2`, `${BBOX}&bbox=0,0,1,1`]) {
    assert.equal((await call(qs, { fetch })).status, 400, qs);
  }
});

test('405 on non-GET, 503 without a key', async () => {
  const post = await handle(new Request('https://x.test/api/live', { method: 'POST' }), { env: { MAP_KEY: KEY } });
  assert.equal(post.status, 405);
  assert.equal((await call(BBOX, { fetch: ok(csv()), env: {} })).status, 503);
});

test('502 when upstream fails; error body, URL and key never leak', async () => {
  const leaks = [
    async (url) => new Response(`bad key ${KEY} at ${url}`, { status: 401 }),
    async (url) => { throw new Error(`connect failed ${url}`); },
    async () => new Response(`Invalid MAP_KEY ${KEY}`, { status: 200 }),
  ];
  for (const fetch of leaks) {
    const res = await call(BBOX, { fetch });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!text.includes(KEY) && !text.includes('firms.modaps') && !text.includes('http'), text);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
});

test('the key never appears in any response, headers included', async () => {
  const responses = [
    await call(BBOX, { fetch: ok(csv(row(-9.95, -54.81, '2026-11-14'))) }),
    await call('bbox=x', { fetch: ok(csv()) }),
    await call(BBOX, { fetch: async () => new Response(KEY, { status: 500 }) }),
  ];
  for (const r of responses) {
    const dump = JSON.stringify([...r.headers]) + (await r.text());
    assert.ok(!dump.includes(KEY));
  }
});

test('never logs the key', async () => {
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => logged.push(a.join(' '));
  try {
    await call(BBOX, { fetch: async (url) => new Response(`oops ${url}`, { status: 500 }) });
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(!logged.join('\n').includes(KEY));
});

test('every response, success or error, carries the security headers', async () => {
  const { SECURITY_HEADERS } = await import('./live.js');
  for (const res of [await call(BBOX, { fetch: async () => new Response('', { status: 500 }) }), await call('x')]) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, k);
  }
});
