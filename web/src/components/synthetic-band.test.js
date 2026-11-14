import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticModel, titleFor, bannerClosed, rememberClosed, DISMISS_KEY } from './synthetic-band.js';

test('band only for a synthetic data version, with the not-real sentence in both lengths', () => {
  assert.equal(syntheticModel({ dataVersion: 'fixture-1' }), null);
  assert.equal(syntheticModel(null), null);
  const m = syntheticModel({ dataVersion: 'synthetic-20261114' });
  assert.equal(m.label, 'Synthetic demo data');
  assert.match(m.sentence, /not real fire detections/);
  assert.equal(m.short, 'Not real fire detections.');
});

test('page title gets the synthetic prefix', () => {
  assert.equal(titleFor('Calendar - Prime Radiant', true), 'Synthetic data: Calendar - Prime Radiant');
  assert.equal(titleFor('Prime Radiant', false), 'Prime Radiant');
});

test('closing the banner is remembered for the session, and storage errors keep it showing', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(bannerClosed(storage), false);
  rememberClosed(storage);
  assert.equal(store.get(DISMISS_KEY), '1');
  assert.equal(bannerClosed(storage), true);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(bannerClosed(broken), false);
  assert.doesNotThrow(() => rememberClosed(broken));
  assert.equal(bannerClosed(undefined), false);
});

test('the model names the tag and gives the close button an accessible name', () => {
  const m = syntheticModel({ dataVersion: 'synthetic-1' });
  assert.equal(m.tag, 'Synthetic data');
  assert.match(m.close, /synthetic data notice/i);
});

test('a sessionStorage getter that throws (blocked site data) does not break the band', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
  try {
    assert.equal(bannerClosed(), false);
    assert.doesNotThrow(() => rememberClosed());
  } finally {
    if (had) Object.defineProperty(globalThis, 'sessionStorage', had); else delete globalThis.sessionStorage;
  }
});
