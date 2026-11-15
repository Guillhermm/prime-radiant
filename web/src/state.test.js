import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, serializeHash, defaultState, createStore, validateBbox, cleanName, NAME_MAX } from './state.js';
import { VIEWS } from './views.js';

// Sensors is enabled only with ?preview=1; these tests use it as a non-default view.
const views = VIEWS.map((v) => ({ ...v, enabled: true }));

const span = { from: '2012-01', to: '2025-12' };
const full = { bbox: [-60.5, -15, -50, -5.25], name: 'São Félix & Co', from: '2020-01', to: '2023-12', view: 'sensors', layer: 'anomaly' };

test('round trip parse(serialize(s)) equals s', () => {
  for (const [s, sp] of [[full, span], [defaultState(), null], [{ ...full, bbox: null, name: null }, span], [{ ...full, name: null }, span], [defaultState({ span }), span]]) {
    const { state, errors } = parseHash(serializeHash(s), { span: sp, views });
    assert.deepEqual(errors, []);
    assert.deepEqual(state, s);
  }
});

test('serialize uses the documented format', () => {
  assert.equal(serializeHash(full), '#aoi=bbox:-60.5,-15,-50,-5.25&name=S%C3%A3o%20F%C3%A9lix%20%26%20Co&from=2020-01&to=2023-12&view=sensors&layer=anomaly');
});

test('empty and missing hash give defaults without errors', () => {
  for (const h of ['', '#', undefined]) {
    const r = parseHash(h);
    assert.deepEqual(r.state, defaultState());
    assert.deepEqual(r.errors, []);
  }
});

test('unknown keys are ignored', () => {
  const r = parseHash('#foo=1&view=sensors', { views });
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
  const r = parseHash('#aoi=bad&view=sensors&layer=anomaly', { views });
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

test('Sensors opens from a link; without ?preview=1 a link to Anomalies falls back to the calendar', () => {
  assert.equal(parseHash('#view=sensors').state.view, 'sensors');
  assert.equal(parseHash('#view=anomalies').state.view, 'calendar');
});

test('cleanName trims, strips control characters and caps at 60 characters', () => {
  assert.equal(cleanName('  Pantanal  '), 'Pantanal');
  assert.equal(cleanName('Pan\u0000ta\nnal\u007f'), 'Pantanal');
  assert.equal(cleanName('x'.repeat(80)), 'x'.repeat(NAME_MAX));
  // Code points, not UTF-16 units: a cap never splits a surrogate pair.
  assert.equal([...cleanName('🔥'.repeat(70))].length, NAME_MAX);
  assert.equal(cleanName('a'.repeat(59) + ' b'), 'a'.repeat(59));
});

test('cleanName gives null for empty, blank or non-string input', () => {
  for (const v of ['', '   ', '\u0001\u0002', null, undefined, 42, ['a']]) assert.equal(cleanName(v), null);
});

test('name travels in the hash and comes back cleaned', () => {
  const r = parseHash('#aoi=bbox:-58,-20,-55,-16&name=%20Pantanal%0A%20', { views });
  assert.deepEqual(r.errors, []);
  assert.equal(r.state.name, 'Pantanal');
  assert.equal(parseHash(`#aoi=bbox:-58,-20,-55,-16&name=${'y'.repeat(90)}`).state.name, 'y'.repeat(NAME_MAX));
  assert.equal(parseHash('#aoi=bbox:-58,-20,-55,-16&name=Mato+Grosso').state.name, 'Mato Grosso');
});

test('an empty name falls back to no name with a reason', () => {
  for (const h of ['#aoi=bbox:-58,-20,-55,-16&name=', '#aoi=bbox:-58,-20,-55,-16&name=%20%01']) assert.equal(bad(h, 'name').name, null);
});

test('a name without an area is dropped quietly, and never serialized', () => {
  assert.deepEqual(parseHash('#name=Pantanal'), { state: defaultState(), errors: [] });
  assert.equal(serializeHash({ ...defaultState(), name: 'Pantanal' }), '#view=calendar&layer=counts');
});
