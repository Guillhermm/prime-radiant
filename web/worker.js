import { SHELL_CACHE, DATA_CACHE, shellUrls, routeFor, staleCaches } from './src/sw-lib.js';

const scope = self.registration.scope;

// No skipWaiting on install: the page decides when to switch (see src/pwa.js). cache: 'reload' keeps
// the HTTP cache from handing a new version stale files.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(shellUrls(scope).map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((n) => staleCaches([n]).length).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const networkFirst = async (request) => {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
};

const shellResponse = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then((res) => { if (res.ok) cache.put(request.url.split('?')[0], res.clone()); return res; });
  if (hit) { refresh.catch(() => {}); return hit; }
  return refresh;
};

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, scope);
  if (route === 'network-first') event.respondWith(networkFirst(event.request));
  else if (route === 'shell') event.respondWith(shellResponse(event.request));
  // 'network-only' and 'bypass': no respondWith, the browser fetches as usual and nothing is stored.
});
