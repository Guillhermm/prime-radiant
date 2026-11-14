// Registers the service worker and reports a waiting version to the page. Registration failures are
// not fatal: the app works without the worker.
export const registerSW = async ({ onUpdate, nav = globalThis.navigator, reload = () => location.reload() } = {}) => {
  if (!nav?.serviceWorker) return null;
  let reg;
  try {
    reg = await nav.serviceWorker.register('sw.js', { type: 'module' });
  } catch {
    return null;
  }
  // Reload only after the user accepted: clients.claim() on a first install also fires controllerchange.
  let accepted = false;
  const offer = (worker) => onUpdate?.(() => { accepted = true; worker.postMessage({ type: 'SKIP_WAITING' }); });
  // A controller exists only when this page already runs under an older worker: first installs stay silent.
  if (reg.waiting && nav.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && nav.serviceWorker.controller) offer(w);
    });
  });
  nav.serviceWorker.addEventListener('controllerchange', () => {
    if (!accepted) return;
    accepted = false;
    reload();
  });
  return reg;
};
