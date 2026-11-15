import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IMMUTABLE, ROOT_CACHE, keepVersions, publish, publishedManifest, rollback, sign, signingKey } from './publish.js';

const ENV = { R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'AKID-TEST', R2_SECRET_ACCESS_KEY: 'secret-test-value', R2_BUCKET: 'prime-radiant-data' };
const fixture = (rel) => fs.readFileSync(new URL(`../fixtures/${rel}`, import.meta.url));

// A one-tile build from the fixtures: manifest, domain, fine and coarse x17y13.
const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const makeBuild = ({ version = '20261115', tile } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-publish-'));
  dirs.push(dir);
  const manifest = { ...JSON.parse(fixture('manifest.json')), dataVersion: version, tiles: ['x17y13'] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'domain.json'), fixture('domain.json'));
  for (const res of ['0.1', '1']) {
    fs.mkdirSync(path.join(dir, 'tiles', res), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tiles', res, 'x17y13.json'), tile ?? fixture(`tiles/${res}/x17y13.json`));
  }
  return dir;
};

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// In-memory R2: path-style S3 for PUT, GET, DELETE and ListObjectsV2 (with delimiter), recording every call.
const fakeR2 = (seed = {}) => {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, { body: v, headers: {} }]));
  const calls = [];
  const fetchFn = async (url, { method, headers, body }) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
    calls.push({ method, key, query: u.search, headers });
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID-TEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    const reply = (status, text = '') => ({ ok: status < 300, status, text: async () => text });
    if (method === 'PUT') { store.set(key, { body: Buffer.from(body).toString(), headers }); return reply(200); }
    if (method === 'DELETE') { store.delete(key); return reply(204); }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix');
      const delim = u.searchParams.get('delimiter');
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (delim) {
        const pre = [...new Set(keys.map((k) => k.slice(prefix.length)).filter((r) => r.includes(delim)).map((r) => prefix + r.slice(0, r.indexOf(delim) + 1)))];
        return reply(200, `<ListBucketResult>${pre.map((p) => `<CommonPrefixes><Prefix>${xml(p)}</Prefix></CommonPrefixes>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      }
      return reply(200, `<ListBucketResult>${keys.map((k) => `<Contents><Key>${xml(k)}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    const hit = store.get(key);
    return hit ? reply(200, hit.body) : reply(404, '<Error><Code>NoSuchKey</Code></Error>');
  };
  return { store, calls, fetchFn };
};

test('SigV4 matches the AWS documentation examples (IAM ListUsers, S3 GET with Range)', () => {
  const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
  assert.equal(signingKey(secret, '20150830', 'us-east-1', 'iam').toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  const iam = sign({
    method: 'GET', url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: secret,
    region: 'us-east-1', service: 'iam', now: new Date('2015-08-30T12:36:00Z'), payloadHeader: false,
  });
  assert.equal(iam.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  const s3 = sign({
    method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' },
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3', now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(s3.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('publish uploads every file under v/{version}/, verifies, then writes the root manifest last', async () => {
  const r2 = fakeR2();
  const logs = [];
  const out = await publish({ dir: makeBuild(), env: ENV, fetchFn: r2.fetchFn, log: (s) => logs.push(s) });
  const puts = r2.calls.filter((c) => c.method === 'PUT');
  assert.deepEqual(puts.map((c) => c.key).sort(), ['manifest.json', 'v/20261115/domain.json', 'v/20261115/manifest.json', 'v/20261115/tiles/0.1/x17y13.json', 'v/20261115/tiles/1/x17y13.json']);
  assert.equal(puts.at(-1).key, 'manifest.json', 'root manifest last');
  const lastPut = r2.calls.findIndex((c) => c.method === 'PUT' && c.key === 'manifest.json');
  assert.ok(r2.calls.slice(0, lastPut).some((c) => c.query.includes('prefix=v%2F20261115%2F')), 'the version is listed back before the switch');
  for (const c of puts) {
    assert.equal(c.headers['cache-control'], c.key === 'manifest.json' ? ROOT_CACHE : IMMUTABLE);
    assert.equal(c.headers['content-type'], 'application/json');
  }
  const root = JSON.parse(r2.store.get('manifest.json').body);
  assert.equal(root.base_url, 'data/v/20261115/', 'resolved from the site root, as data-source does');
  assert.equal(r2.store.get('v/20261115/manifest.json').body, r2.store.get('manifest.json').body, 'the versioned copy is what a rollback restores');
  assert.equal(out.sent, true);
  assert.ok(logs.every((l) => !l.includes(ENV.R2_SECRET_ACCESS_KEY) && !l.includes(ENV.R2_ACCOUNT_ID) && !/https?:/.test(l)), 'logs carry no secret, account or URL');
});

test('pruning keeps the new version and the previous live one; re-publishing overwrites the same keys', async () => {
  const seed = { 'manifest.json': JSON.stringify({ dataVersion: '20261101' }) };
  for (const v of ['20261001', '20261015', '20261101']) seed[`v/${v}/manifest.json`] = '{}';
  const r2 = fakeR2(seed);
  const out = await publish({ dir: makeBuild(), env: ENV, fetchFn: r2.fetchFn, log: () => {} });
  assert.deepEqual(out.kept.sort(), ['20261101', '20261115']);
  assert.deepEqual(out.removed, ['20261001', '20261015']);
  assert.deepEqual([...r2.store.keys()].filter((k) => k.startsWith('v/')).map((k) => k.split('/')[1]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['20261101', '20261115']);

  const before = r2.store.size;
  const again = await publish({ dir: makeBuild(), env: ENV, fetchFn: r2.fetchFn, log: () => {} });
  assert.equal(r2.store.size, before, 'same keys, no duplicates');
  assert.deepEqual(again.kept.sort(), ['20261101', '20261115'], 'the previous version survives a re-publish');
  assert.deepEqual(keepVersions('c', null, ['a', 'b', 'c']), new Set(['c', 'b']));
});

test('a build that fails validation aborts before any request', async () => {
  const r2 = fakeR2();
  const bad = makeBuild({ tile: JSON.stringify({ cell: [1], month: [], modis: [], viirs: [], noaa20: [] }) });
  await assert.rejects(publish({ dir: bad, env: ENV, fetchFn: r2.fetchFn, log: () => {} }), /tiles\/0\.1\/x17y13\.json fails validation/);
  const unsafe = makeBuild({ version: '../x' });
  await assert.rejects(publish({ dir: unsafe, env: ENV, fetchFn: r2.fetchFn, log: () => {} }), /dataVersion/);
  assert.equal(r2.calls.length, 0);
});

test('dry run validates and lists the keys but sends nothing, and needs no credentials', async () => {
  const r2 = fakeR2();
  const out = await publish({ dir: makeBuild(), env: {}, fetchFn: r2.fetchFn, dryRun: true, log: () => {} });
  assert.equal(out.sent, false);
  assert.equal(out.keys.at(-1), 'manifest.json');
  assert.equal(r2.calls.length, 0);
});

test('missing credentials fail by name, never by value', async () => {
  await assert.rejects(publish({ dir: makeBuild(), env: { ...ENV, R2_SECRET_ACCESS_KEY: '' }, fetchFn: fakeR2().fetchFn, log: () => {} }), /^Error: publish: R2_SECRET_ACCESS_KEY is not set$/);
});

test('a key missing after upload leaves the live manifest untouched', async () => {
  const r2 = fakeR2({ 'manifest.json': '{"dataVersion":"old"}' });
  const lossy = async (url, init) => (init.method === 'PUT' && url.includes('domain.json') ? { ok: true, status: 200, text: async () => '' } : r2.fetchFn(url, init));
  await assert.rejects(publish({ dir: makeBuild(), env: ENV, fetchFn: lossy, log: () => {} }), /1 keys missing after upload \(first: v\/20261115\/domain\.json\)/);
  assert.equal(r2.store.get('manifest.json').body, '{"dataVersion":"old"}');
});

test('rollback copies a kept version\'s manifest to the root', async () => {
  const old = JSON.stringify(publishedManifest({ ...JSON.parse(fixture('manifest.json')), dataVersion: '20261101' }));
  const r2 = fakeR2({ 'v/20261101/manifest.json': old, 'manifest.json': '{}' });
  await rollback({ version: '20261101', env: ENV, fetchFn: r2.fetchFn, log: () => {} });
  assert.equal(r2.store.get('manifest.json').body, old);
  assert.equal(r2.store.get('manifest.json').headers['cache-control'], ROOT_CACHE);
  await assert.rejects(rollback({ version: '20250101', env: ENV, fetchFn: r2.fetchFn, log: () => {} }), /not in the bucket/);
});
