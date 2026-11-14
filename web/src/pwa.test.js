import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerSW } from './pwa.js';

const fakeNav = ({ controller = null, waiting = null } = {}) => {
  const sw = new EventTarget();
  sw.controller = controller;
  const reg = Object.assign(new EventTarget(), { waiting, installing: null });
  sw.register = async (url, opts) => { sw.registered = [url, opts]; return reg; };
  return { serviceWorker: sw, reg };
};

test('registers sw.js as a module worker relative to the page', async () => {
  const nav = fakeNav();
  await registerSW({ nav });
  assert.deepEqual(nav.serviceWorker.registered, ['sw.js', { type: 'module' }]);
});

test('no service worker support or a failed registration returns null without throwing', async () => {
  assert.equal(await registerSW({ nav: {} }), null);
  const nav = fakeNav();
  nav.serviceWorker.register = async () => { throw new Error('nope'); };
  assert.equal(await registerSW({ nav }), null);
});

test('a worker installed while an older one controls the page triggers onUpdate; apply posts SKIP_WAITING', async () => {
  const nav = fakeNav({ controller: {} });
  const posted = [];
  const worker = Object.assign(new EventTarget(), { state: 'installing', postMessage: (m) => posted.push(m) });
  let apply;
  await registerSW({ nav, onUpdate: (a) => { apply = a; } });
  nav.reg.installing = worker;
  nav.reg.dispatchEvent(new Event('updatefound'));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  assert.ok(apply);
  apply();
  assert.deepEqual(posted, [{ type: 'SKIP_WAITING' }]);
});

test('the first install (no controller) stays silent', async () => {
  const nav = fakeNav();
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  let called = false;
  await registerSW({ nav, onUpdate: () => { called = true; } });
  nav.reg.installing = worker;
  nav.reg.dispatchEvent(new Event('updatefound'));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  assert.equal(called, false);
});

test('controllerchange reloads once, and only after the user accepted the update', async () => {
  const nav = fakeNav({ controller: {} });
  const worker = Object.assign(new EventTarget(), { state: 'installed', postMessage: () => {} });
  nav.reg.waiting = worker;
  let apply;
  let n = 0;
  await registerSW({ nav, onUpdate: (a) => { apply = a; }, reload: () => { n += 1; } });
  nav.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(n, 0, 'no consent, no reload');
  apply();
  nav.serviceWorker.dispatchEvent(new Event('controllerchange'));
  nav.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(n, 1);
});

test('the first install claiming the page does not reload it', async () => {
  const nav = fakeNav();
  let n = 0;
  await registerSW({ nav, reload: () => { n += 1; } });
  nav.serviceWorker.controller = {};
  nav.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(n, 0);
});

test('iOS install hint: iPhone and iPad only, not standalone, until closed', async () => {
  const { isIOS, showIosHint, closeIosHint, IOS_HINT_KEY } = await import('./pwa.js');
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
  const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
  const mac = { ...ipad, maxTouchPoints: 0 };
  const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 };
  assert.equal(isIOS(iphone), true);
  assert.equal(isIOS(ipad), true, 'iPadOS reports a Mac platform with touch');
  assert.equal(isIOS(mac), false);
  assert.equal(isIOS(android), false);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(showIosHint(iphone, { storage }), true);
  assert.equal(showIosHint(iphone, { storage, standalone: true }), false, 'display-mode standalone');
  assert.equal(showIosHint({ ...iphone, standalone: true }, { storage }), false, 'navigator.standalone on iOS');
  assert.equal(showIosHint(android, { storage }), false);
  closeIosHint(storage);
  assert.equal(store.get(IOS_HINT_KEY), '1');
  assert.equal(showIosHint(iphone, { storage }), false, 'once closed, never again');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(showIosHint(iphone, { storage: broken }), true);
  assert.doesNotThrow(() => closeIosHint(broken));
});

test('iOS install hint survives a localStorage getter that throws', async () => {
  const { showIosHint, closeIosHint } = await import('./pwa.js');
  const iphone = { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
  try {
    assert.equal(showIosHint(iphone), true);
    assert.equal(showIosHint({ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 }), false);
    assert.doesNotThrow(() => closeIosHint());
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});
