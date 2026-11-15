import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const run = async (windows) => {
  const listeners = {};
  const deleted = [];
  let unregistered = false;
  let skipped = false;
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { skipped = true; },
    registration: { unregister: async () => { unregistered = true; } },
    clients: { matchAll: async () => windows },
  };
  const caches = { keys: async () => ['pr-shell-v26', 'pr-data-v26', 'other-app'], delete: async (n) => { deleted.push(n); return true; } };
  vm.runInNewContext(readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), { self, caches, URL });
  listeners.install();
  let pending;
  listeners.activate({ waitUntil: (p) => { pending = p; } });
  await pending;
  return { deleted, unregistered, skipped };
};

test('the legacy /web/ worker takes over, drops pr-* caches, unregisters and sends windows to the same page under /', async () => {
  const navigated = [];
  const win = (url) => ({ url, navigate: async (u) => { navigated.push(u); } });
  const out = await run([win('https://x.test/web/?fixtures=1#aoi=bbox:1,2,3,4'), win('https://x.test/web/'), win('https://x.test/other')]);
  assert.equal(out.skipped, true);
  assert.deepEqual(out.deleted, ['pr-shell-v26', 'pr-data-v26']);
  assert.equal(out.unregistered, true);
  assert.deepEqual(navigated, ['https://x.test/?fixtures=1#aoi=bbox:1,2,3,4', 'https://x.test/', 'https://x.test/other']);
});

test('a window that cannot be navigated does not fail the activation', async () => {
  await run([{ url: 'https://x.test/web/', navigate: async () => { throw new Error('no'); } }]);
});
