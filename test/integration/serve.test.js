import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
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
  for (const path of ['/web/', '/web/src/main.js', '/core/index.js']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.ok(res.headers.get('content-security-policy'), `${path} has a CSP`);
  }
});

test('does not serve what the deploy leaves out', async () => {
  for (const path of ['/raw/x', '/pipeline/', '/api/live.js', '/docs/deploy.md', '/test/smoke.test.js', '/package.json', '/.git/config', '/core/grid.test.js', '/web/src/state.test.js', '/../package.json', '/web/%2e%2e/package.json']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('serves the local data/ where Vercel rewrites /data/ to R2, and fixtures/', async () => {
  const site = await loadSite(root);
  assert.ok(site.allowed.includes('data'), 'data/ comes from the external rewrite in vercel.json');
  assert.ok(!site.allowed.includes('pipeline') && !site.allowed.includes('tools'));
  assert.equal((await get('/fixtures/manifest.json')).status, 200);
});

test('redirects / to /web/', async () => {
  const res = await get('/');
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/web/');
});
