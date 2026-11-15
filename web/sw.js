// Legacy worker URL. The app used to live at /web/ and registered this file with scope /web/. The app now
// lives at /, so installed copies must not keep serving the old cached shell: this worker replaces the old
// one on the next visit, drops the pr-* caches, unregisters itself and sends open windows to the same
// page under /. It must stay a plain script served as is (vercel.json does not redirect /web/sw.js,
// because a worker script cannot be fetched through a redirect). The real worker is web/worker.js.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((n) => n.startsWith('pr-')).map((n) => caches.delete(n)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map((w) => {
      const u = new URL(w.url);
      u.pathname = u.pathname.replace(/^\/web(\/|$)/, '/');
      return w.navigate(u.href).catch(() => {});
    }));
  })());
});
