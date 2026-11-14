import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, serializeHash, defaultState, createStore, validateBbox } from './state.js';

const span = { from: '2012-01', to: '2025-12' };
const full = { bbox: [-60.5, -15, -50, -5.25], from: '2020-01', to: '2023-12', view: 'sensors', layer: 'anomaly' };

test('round trip parse(serialize(s)) equals s', () => {
  for (const [s, sp] of [[full, span], [defaultState(), null], [{ ...full, bbox: null }, span], [defaultState({ span }), span]]) {
    const { state, errors } = parseHash(serializeHash(s), { span: sp });
    assert.deepEqual(errors, []);
    assert.deepEqual(state, s);
  }
});

test('serialize uses the documented format', () => {
  assert.equal(serializeHash(full), '#aoi=bbox:-60.5,-15,-50,-5.25&from=2020-01&to=2023-12&view=sensors&layer=anomaly');
});

test('empty and missing hash give defaults without errors', () => {
  for (const h of ['', '#', undefined]) {
    const r = parseHash(h);
    assert.deepEqual(r.state, defaultState());
    assert.deepEqual(r.errors, []);
  }
});

test('unknown keys are ignored', () => {
  const r = parseHash('#foo=1&view=sensors');
  assert.equal(r.state.view, 'sensors');
  assert.deepEqual(r.errors, []);
});

const bad = (hash, field, opts) => {
  const r = parseHash(hash, opts);
  assert.ok(r.errors.some((e) => e.field === field && e.reason), `${hash} should fail on ${field}`);
  return r.state;
};

test('invalid bbox cases fall back with a reason', () => {
  for (const h of [
    '#aoi=bbox:1,2,3', '#aoi=bbox:a,b,c,d', '#aoi=foo', '#aoi=bbox:,,,',
    '#aoi=bbox:0,-91,10,10', '#aoi=bbox:0,0,10,91',
    '#aoi=bbox:-181,0,10,10', '#aoi=bbox:0,0,181,10',
    '#aoi=bbox:10,0,10,5', '#aoi=bbox:20,0,10,5',
    '#aoi=bbox:0,5,10,5', '#aoi=bbox:0,6,10,5',
  ]) assert.equal(bad(h, 'bbox').bbox, null);
});

test('area cap is a parameter, off by default', () => {
  assert.equal(parseHash('#aoi=bbox:-100,-50,100,50').errors.length, 0);
  assert.equal(bad('#aoi=bbox:0,0,10,10', 'bbox', { maxAreaDeg2: 99 }).bbox, null);
  assert.deepEqual(parseHash('#aoi=bbox:0,0,10,10', { maxAreaDeg2: 100 }).state.bbox, [0, 0, 10, 10]);
});

test('invalid dates fall back', () => {
  for (const h of ['#from=2020', '#from=2020-13', '#from=2020-00', '#to=abc', '#from=']) {
    const key = h.startsWith('#from') ? 'from' : 'to';
    assert.equal(bad(h, key)[key], null);
  }
});

test('dates outside the span fall back to the span defaults', () => {
  assert.equal(bad('#from=2000-01', 'from', { span }).from, span.from);
  assert.equal(bad('#to=2030-01', 'to', { span }).to, span.to);
  assert.equal(parseHash('#from=2012-01&to=2025-12', { span }).errors.length, 0);
});

test('from after to is rejected', () => {
  const r = parseHash('#from=2023-01&to=2020-01');
  assert.equal(r.state.from, null);
  assert.equal(r.state.to, null);
  assert.equal(r.errors.length, 2);
});

test('disabled, unknown view and unknown layer fall back', () => {
  assert.equal(bad('#view=live', 'view').view, 'calendar');
  assert.equal(bad('#view=zzz', 'view').view, 'calendar');
  assert.equal(bad('#layer=zzz', 'layer').layer, 'counts');
});

test('one bad field does not discard the others', () => {
  const r = parseHash('#aoi=bad&view=sensors&layer=anomaly');
  assert.equal(r.state.view, 'sensors');
  assert.equal(r.state.layer, 'anomaly');
});

test('validateBbox accepts a good box', () => {
  assert.equal(validateBbox([-10, -10, 10, 10]), null);
});

test('store notifies subscribers, skips no-ops, supports unsubscribe', () => {
  const store = createStore(defaultState());
  const seen = [];
  const off = store.subscribe((s) => seen.push(s.view));
  store.set({ view: 'sensors' });
  store.set({ view: 'sensors' });
  assert.deepEqual(seen, ['sensors']);
  assert.equal(store.get().view, 'sensors');
  off();
  store.set({ view: 'calendar' });
  assert.deepEqual(seen, ['sensors']);
});

test('store treats equal bbox arrays as no change', () => {
  const store = createStore({ ...defaultState(), bbox: [0, 0, 1, 1] });
  let n = 0;
  store.subscribe(() => n++);
  store.set({ bbox: [0, 0, 1, 1] });
  store.set({ bbox: [0, 0, 2, 2] });
  assert.equal(n, 1);
});
