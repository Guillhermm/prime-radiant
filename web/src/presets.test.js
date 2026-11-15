import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_PRESET, presetsFor, findPreset } from './presets.js';

const inside = ([w, s, e, n], [lat, lon]) => lon >= w && lon <= e && lat >= s && lat <= n;
// Centers of the fixture cells 0, 1, 1020, 5049 and 9999 of tile x17y13 (fixtures/README.md).
const CELLS = [[40.05, -9.95], [40.05, -9.85], [41.05, -7.95], [45.05, -5.05], [49.95, -0.05]];

test('the fixture preset covers every fixture cell', () => {
  for (const c of CELLS) assert.equal(inside(FIXTURE_PRESET.bbox, c), true, `cell ${c}`);
});

test('only fixture mode has a built-in example; real examples come from overview.json', () => {
  assert.deepEqual(presetsFor({ fixtures: true }), [FIXTURE_PRESET]);
  assert.deepEqual(presetsFor({ fixtures: false }), []);
  assert.deepEqual(presetsFor(), []);
  assert.notEqual(presetsFor(), presetsFor(), 'a fresh list each time, so the app can add the hotspots to it');
});

test('findPreset looks in the list it is given', () => {
  assert.equal(findPreset(FIXTURE_PRESET.id, []), null);
  assert.equal(findPreset(FIXTURE_PRESET.id, presetsFor({ fixtures: true })), FIXTURE_PRESET);
});
