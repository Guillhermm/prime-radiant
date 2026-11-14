import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_VERSION, SHELL_CACHE, DATA_CACHE, SHELL_FILES, shellUrls, routeFor, staleCaches } from './sw-lib.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SCOPE = 'http://localhost:8433/web/';
const req = (url, method = 'GET') => ({ url, method });

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

test('cache names carry the version', () => {
  assert.match(CACHE_VERSION, /^v\d+$/);
  assert.equal(SHELL_CACHE, `pr-shell-${CACHE_VERSION}`);
  assert.equal(DATA_CACHE, `pr-data-${CACHE_VERSION}`);
});

test('every precached file exists, with no duplicates', () => {
  assert.equal(new Set(SHELL_FILES).size, SHELL_FILES.length);
  for (const p of SHELL_FILES) {
    if (p === './') continue;
    assert.ok(existsSync(join(repo, 'web', p)), `${p} exists`);
  }
});

test('every runtime file under web/ and core/ is precached (drift guard)', () => {
  const skip = (f) => f.endsWith('.test.js') || f.endsWith('/web/sw.js') || f.endsWith('/web/src/sw-lib.js') || /OFL-|LICENSE$/.test(f);
  const files = [...walk(join(repo, 'web')), ...walk(join(repo, 'core'))].filter((f) => !skip(f))
    .map((f) => relative(join(repo, 'web'), f));
  const missing = files.filter((f) => !SHELL_FILES.includes(f));
  assert.deepEqual(missing, [], 'add these to SHELL_FILES in sw-lib.js and bump CACHE_VERSION');
});

test('shellUrls resolves against the scope, so localhost and production share one list', () => {
  const urls = shellUrls(SCOPE);
  assert.ok(urls.includes('http://localhost:8433/web/'));
  assert.ok(urls.includes('http://localhost:8433/core/index.js'));
  assert.ok(shellUrls('https://primeradiant.zenus.systems/web/').includes('https://primeradiant.zenus.systems/web/src/main.js'));
});

test('routing: shell, data, api, tiles and non-GET', () => {
  assert.equal(routeFor(req('http://localhost:8433/web/src/main.js'), SCOPE), 'shell');
  assert.equal(routeFor(req('http://localhost:8433/web/?fixtures=1'), SCOPE), 'shell');
  assert.equal(routeFor(req('http://localhost:8433/core/grid.js'), SCOPE), 'shell');
  assert.equal(routeFor(req('http://localhost:8433/data/manifest.json'), SCOPE), 'network-first');
  assert.equal(routeFor(req('http://localhost:8433/fixtures/manifest.json'), SCOPE), 'network-first');
  assert.equal(routeFor(req('http://localhost:8433/api/live?bbox=1,2,3,4'), SCOPE), 'network-only');
  assert.equal(routeFor(req('https://tile.openstreetmap.org/3/1/2.png'), SCOPE), 'bypass');
  assert.equal(routeFor(req('http://localhost:8433/web/src/main.js', 'POST'), SCOPE), 'bypass');
  assert.equal(routeFor(req('http://localhost:8433/web/unknown.js'), SCOPE), 'bypass');
});

test('staleCaches drops only older pr- caches', () => {
  assert.deepEqual(staleCaches([SHELL_CACHE, DATA_CACHE, 'pr-shell-v0', 'pr-data-v0', 'other-app']), ['pr-shell-v0', 'pr-data-v0']);
});

test('manifest has a stable scoped id, relative start_url/scope and standalone display', () => {
  const m = JSON.parse(readFileSync(join(repo, 'web/manifest.webmanifest'), 'utf8'));
  assert.equal(m.id, '/prime-radiant');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name && m.description);
  assert.ok(m.icons.length > 0 && m.icons.every((i) => existsSync(join(repo, 'web', i.src))));
  const tokens = readFileSync(join(repo, 'web/styles/tokens.css'), 'utf8');
  assert.ok(tokens.includes(`--color-bg: ${m.background_color}`));
});
