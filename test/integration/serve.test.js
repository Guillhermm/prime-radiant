import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { shellUrls } from '../../web/src/sw-lib.js';
import { createStaticServer, loadSite } from '../../tools/serve.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
let server;
let base;
before(async () => {
  server = createStaticServer(await loadSite(root, { extra: ['fixtures'] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (path) => fetch(base + path, { redirect: 'manual' });

test('serves web/ and core/ with the security headers', async () => {
  for (const path of ['/', '/src/main.js', '/sw.js', '/manifest.webmanifest', '/web/sw.js', '/core/index.js']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.ok(res.headers.get('content-security-policy'), `${path} has a CSP`);
  }
});

test('does not serve what the deploy leaves out', async () => {
  for (const path of ['/raw/x', '/pipeline/', '/api/live.js', '/docs/deploy.md', '/test/smoke.test.js', '/package.json', '/.git/config', '/core/grid.test.js', '/src/state.test.js', '/../package.json', '/web/%2e%2e/package.json']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('serves the local data/ where Vercel rewrites /data/ to R2, and fixtures/', async () => {
  const site = await loadSite(root);
  assert.ok(site.allowed.includes('data'), 'data/ comes from the external rewrite in vercel.json');
  assert.ok(!site.allowed.includes('pipeline') && !site.allowed.includes('tools'));
  assert.equal((await get('/fixtures/manifest.json')).status, 200);
});

test('serves the app at / and sends the old /web/ URLs there, keeping the query', async () => {
  assert.equal((await get('/')).status, 200);
  assert.match(await (await get('/')).text(), /<title>/);
  for (const [from, to] of [['/web', '/'], ['/web/', '/'], ['/web/?fixtures=1', '/?fixtures=1'], ['/web/index.html', '/'], ['/web/src/main.js', '/src/main.js'],
    ['/web/styles/app.css', '/styles/app.css'], ['/web/manifest.webmanifest', '/manifest.webmanifest'], ['/web/icons/icon-192.png', '/icons/icon-192.png']]) {
    const res = await get(from);
    assert.equal(res.status, 307, from);
    assert.equal(res.headers.get('location'), to, from);
  }
});

test('/sw.js is the app worker and /web/sw.js, the legacy URL old installs poll, is never redirected', async () => {
  const app = await (await get('/sw.js')).text();
  assert.match(app, /routeFor/);
  const legacy = await get('/web/sw.js');
  assert.equal(legacy.status, 200);
  const text = await legacy.text();
  assert.match(text, /unregister\(\)/);
  assert.doesNotMatch(text, /import /);
});

test('every URL the service worker precaches resolves to a file at the site root (an addAll miss would block installation)', async () => {
  for (const url of shellUrls(`${base}/`)) assert.equal((await fetch(url, { redirect: 'manual' })).status, 200, url);
});
