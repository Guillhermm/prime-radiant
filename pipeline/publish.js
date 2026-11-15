/**
 * Publish a build to Cloudflare R2 (decision H5), through R2's S3 API signed with AWS SigV4.
 *   node pipeline/publish.js --in raw/build [--dry-run]
 *   node pipeline/publish.js --rollback <dataVersion>
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 *
 * Bucket layout: v/{dataVersion}/... holds one build, immutable; manifest.json at the root
 * names the live one. The root manifest is written last, after every versioned key is listed
 * back, so the switch is atomic for readers. Only the current and the previous version are
 * kept. Logs carry keys and counts, never credentials or request URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validateManifest, validateTile, validateDomain, validateOverview, validatePlaces, validateGlobalLevel } from '../core/schema.js';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const ROOT_CACHE = 'public, max-age=300';
const TYPES = { '.json': 'application/json', '.geojson': 'application/geo+json' };
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const CONCURRENCY = 6;

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986 unreserved characters stay, everything else is percent-encoded (SigV4 rule).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const signingKey = (secret, date, region, service) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');

/**
 * SigV4 headers for one request. `headers` must not hold Authorization; host is taken from the
 * URL. With `payloadHeader` (S3 needs it) x-amz-content-sha256 is added and signed.
 * @returns {Record<string, string>} the headers to send, Authorization included
 */
export const sign = ({ method, url, headers = {}, body = '', accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date(), payloadHeader = true }) => {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payload = sha256Hex(body);
  const all = { ...headers, host: u.host, 'x-amz-date': amzDate, ...(payloadHeader ? { 'x-amz-content-sha256': payload } : {}) };
  const names = Object.keys(all).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalUri = u.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/') || '/';
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const canonical = [method, canonicalUri, query.map(([k, v]) => `${k}=${v}`).join('&'),
    names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(secretAccessKey, day, region, service)).update(toSign).digest('hex');
  const out = { ...headers, 'x-amz-date': amzDate, ...(payloadHeader ? { 'x-amz-content-sha256': payload } : {}) };
  out.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return out;
};

const xmlAll = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));

/** Reads and checks the four R2 variables; the error names a missing one, never a value. */
export const r2Config = (env) => {
  const cfg = { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };
  const names = { accountId: 'R2_ACCOUNT_ID', accessKeyId: 'R2_ACCESS_KEY_ID', secretAccessKey: 'R2_SECRET_ACCESS_KEY', bucket: 'R2_BUCKET' };
  for (const [k, n] of Object.entries(names)) if (!cfg[k]) throw new Error(`publish: ${n} is not set`);
  if (!/^[a-f0-9]{32}$/.test(cfg.accountId)) throw new Error('publish: R2_ACCOUNT_ID is not a 32-character hex account id');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(cfg.bucket)) throw new Error('publish: R2_BUCKET is not a valid bucket name');
  return cfg;
};

/** Minimal S3 client for R2: put, get, list (paginated), delete. Errors carry the key and status only. */
export const createR2 = ({ accountId, accessKeyId, secretAccessKey, bucket, fetchFn = fetch }) => {
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  const keyUrl = (key) => `${base}/${key.split('/').map(enc).join('/')}`;
  const call = async (method, url, { headers = {}, body = '' } = {}) => {
    const signed = sign({ method, url, headers, body, accessKeyId, secretAccessKey });
    return fetchFn(url, { method, headers: signed, body: method === 'PUT' ? body : undefined });
  };
  const fail = async (what, res) => {
    const code = xmlAll(await res.text().catch(() => ''), 'Code')[0];
    throw new Error(`publish: ${what} failed with HTTP ${res.status}${code ? ` (${code})` : ''}`);
  };
  return {
    put: async (key, body, { contentType, cacheControl }) => {
      const res = await call('PUT', keyUrl(key), { headers: { 'content-type': contentType, 'cache-control': cacheControl }, body });
      if (!res.ok) await fail(`PUT ${key}`, res);
    },
    get: async (key) => {
      const res = await call('GET', keyUrl(key));
      if (res.status === 404) return null;
      if (!res.ok) await fail(`GET ${key}`, res);
      return res.text();
    },
    list: async (prefix, { delimiter } = {}) => {
      const keys = [];
      const prefixes = [];
      let token = null;
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix, ...(delimiter ? { delimiter } : {}), ...(token ? { 'continuation-token': token } : {}) });
        const res = await call('GET', `${base}?${q}`);
        if (!res.ok) await fail(`LIST ${prefix}`, res);
        const xml = await res.text();
        keys.push(...xmlAll(xml, 'Key'));
        for (const block of xml.match(/<CommonPrefixes>[\s\S]*?<\/CommonPrefixes>/g) ?? []) prefixes.push(...xmlAll(block, 'Prefix'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlAll(xml, 'NextContinuationToken')[0] : null;
      } while (token);
      return { keys, prefixes };
    },
    del: async (key) => {
      const res = await call('DELETE', keyUrl(key));
      if (!res.ok && res.status !== 404) await fail(`DELETE ${key}`, res);
    },
  };
};

const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  .flatMap((e) => (e.isDirectory() ? walk(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));

/**
 * Reads a build directory and validates it with core's schema: the manifest, both tile levels of
 * every manifest tile, the domain when the manifest names one, and overview.json and places.json when present. Throws on the first file that
 * fails, with every error of that file.
 * @returns {{manifest: object, files: string[]}} files relative to `dir`, POSIX separators
 */
export const loadBuild = (dir) => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const check = (rel, errors) => {
    if (errors.length) throw new Error(`publish: ${rel} fails validation: ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
  };
  const manifest = read('manifest.json');
  check('manifest.json', validateManifest(manifest));
  if (!VERSION.test(manifest.dataVersion)) throw new Error('publish: dataVersion must be letters, digits, dot, dash or underscore');
  const files = walk(dir);
  for (const id of manifest.tiles) {
    for (const res of [0.1, 1]) {
      const rel = `tiles/${res}/${id}.json`;
      if (!files.includes(rel)) throw new Error(`publish: ${rel} is listed in the manifest but missing`);
      check(rel, validateTile(read(rel), { manifest, res }));
    }
  }
  if (manifest.domain) {
    if (!files.includes(manifest.domain.file)) throw new Error(`publish: ${manifest.domain.file} is named in the manifest but missing`);
    check(manifest.domain.file, validateDomain(read(manifest.domain.file)));
  }
  if (files.includes('overview.json')) check('overview.json', validateOverview(read('overview.json')));
  if (files.includes('places.json')) check('places.json', validatePlaces(read('places.json')));
  if (files.includes('global.json')) check('global.json', validateGlobalLevel(read('global.json'), { manifest }));
  return { manifest, files };
};

/** The manifest as published: base_url points at its version, relative to the site root as data-source resolves it. */
export const publishedManifest = (manifest) => ({ ...manifest, base_url: `data/v/${manifest.dataVersion}/` });

const pool = async (items, n, fn) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
};

/** Versions to keep: the new one and the previous live one (or, re-publishing it, the newest other). */
export const keepVersions = (current, previous, present) => {
  const prev = previous && previous !== current ? previous : present.filter((v) => v !== current).sort().at(-1);
  return new Set([current, prev].filter(Boolean));
};

/**
 * Upload, verify, switch, prune. Returns a summary; with `dryRun` nothing is sent.
 * @param {{dir: string, env: object, fetchFn?: typeof fetch, dryRun?: boolean, log?: (s: string) => void}} o
 */
export const publish = async ({ dir, env, fetchFn = fetch, dryRun = false, log = console.log }) => {
  const { manifest, files } = loadBuild(dir);
  const version = manifest.dataVersion;
  const prefix = `v/${version}/`;
  const root = JSON.stringify(publishedManifest(manifest));
  const uploads = files.filter((f) => f !== 'manifest.json');
  log(`publish: ${version} valid, ${uploads.length + 1} files to ${prefix}`);
  if (dryRun) return { version, keys: [...uploads.map((f) => prefix + f), `${prefix}manifest.json`, 'manifest.json'], sent: false };

  const r2 = createR2({ ...r2Config(env), fetchFn });
  // Versioned keys are served as immutable, so a complete version (its manifest is written after
  // every tile) is never rewritten; leftovers of a failed upload, which no reader saw, are.
  if ((await r2.get(`${prefix}manifest.json`)) !== null) throw new Error(`publish: ${prefix} is already published; build with a new --data-version`);
  const live = await r2.get('manifest.json');
  const previous = live ? (() => { try { return JSON.parse(live).dataVersion ?? null; } catch { return null; } })() : null;

  await pool(uploads, CONCURRENCY, (f) => r2.put(prefix + f, fs.readFileSync(path.join(dir, f)), { contentType: TYPES[path.extname(f)] ?? 'application/octet-stream', cacheControl: IMMUTABLE }));
  // The versioned copy is what a rollback points the root at.
  await r2.put(`${prefix}manifest.json`, root, { contentType: TYPES['.json'], cacheControl: IMMUTABLE });

  const expected = [...uploads.map((f) => prefix + f), `${prefix}manifest.json`];
  const listed = new Set((await r2.list(prefix)).keys);
  const missing = expected.filter((k) => !listed.has(k));
  if (missing.length) throw new Error(`publish: ${missing.length} keys missing after upload (first: ${missing[0]}); the live manifest was not changed`);
  log(`publish: ${expected.length} keys verified`);

  await r2.put('manifest.json', root, { contentType: TYPES['.json'], cacheControl: ROOT_CACHE });
  log(`publish: manifest.json now points at ${prefix}`);

  const present = (await r2.list('v/', { delimiter: '/' })).prefixes.map((p) => p.slice(2, -1));
  const keep = keepVersions(version, previous, present);
  const drop = present.filter((v) => !keep.has(v));
  for (const v of drop) {
    const { keys } = await r2.list(`v/${v}/`);
    await pool(keys, CONCURRENCY, (k) => r2.del(k));
    log(`publish: removed v/${v}/ (${keys.length} keys)`);
  }
  return { version, previous, kept: [...keep], removed: drop, sent: true };
};

/** Point the root manifest back at an earlier version still in the bucket. */
export const rollback = async ({ version, env, fetchFn = fetch, log = console.log }) => {
  if (!VERSION.test(version ?? '')) throw new Error('publish: --rollback needs a dataVersion');
  const r2 = createR2({ ...r2Config(env), fetchFn });
  const text = await r2.get(`v/${version}/manifest.json`);
  if (text === null) throw new Error(`publish: v/${version}/manifest.json is not in the bucket`);
  const errors = validateManifest(JSON.parse(text));
  if (errors.length) throw new Error(`publish: v/${version}/manifest.json fails validation`);
  await r2.put('manifest.json', text, { contentType: TYPES['.json'], cacheControl: ROOT_CACHE });
  log(`publish: manifest.json now points at v/${version}/`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { in: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, rollback: { type: 'string' } } });
  if (!values.rollback && !values.in) {
    console.error('usage: node pipeline/publish.js --in <build dir> [--dry-run] | --rollback <dataVersion>');
    process.exit(2);
  }
  const run = values.rollback
    ? rollback({ version: values.rollback, env: process.env })
    : publish({ dir: values.in, env: process.env, dryRun: values['dry-run'] });
  run.catch((e) => { console.error(e.message); process.exit(1); });
}
