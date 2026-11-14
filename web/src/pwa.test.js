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
