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

export const IOS_HINT_KEY = 'pr-ios-hint-closed';

/** iPhone, iPod or iPad (iPadOS reports a Mac platform but has touch points). */
export const isIOS = ({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) =>
  /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);

/**
 * iOS has no beforeinstallprompt, so it gets a written hint instead: once, until closed, and never
 * when the app already runs from the home screen. Storage errors count as "not closed".
 */
// Reading the localStorage property itself throws when site data is blocked, so it happens inside the try.
export const showIosHint = (nav = globalThis.navigator, { standalone = false, storage } = {}) => {
  if (!isIOS(nav) || standalone || nav?.standalone === true) return false;
  try { return (storage ?? globalThis.localStorage)?.getItem(IOS_HINT_KEY) !== '1'; } catch { return true; }
};

export const closeIosHint = (storage) => {
  try { (storage ?? globalThis.localStorage)?.setItem(IOS_HINT_KEY, '1'); } catch { /* shows again next visit */ }
};
