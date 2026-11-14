import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, FIXTURE_PRESET, presetsFor, findPreset } from './presets.js';

const inside = ([w, s, e, n], [lat, lon]) => lon >= w && lon <= e && lat >= s && lat <= n;
// Fixture cells A, B, C, D (fixtures/README.md).
const CELLS = [[-15.05, -55.05], [-15.15, -55.05], [-12.35, -52.45], [-18.25, -58.35]];

test('the fixture preset covers every fixture cell and Pantanal covers none', () => {
  for (const c of CELLS) {
    assert.equal(inside(FIXTURE_PRESET.bbox, c), true, `cell ${c}`);
    assert.equal(inside(PRESETS[0].bbox, c), false, `Pantanal, cell ${c}`);
  }
});

test('fixture mode puts the fixture area first and keeps the real presets', () => {
  assert.deepEqual(presetsFor({ fixtures: true }).map((p) => p.id), [FIXTURE_PRESET.id, ...PRESETS.map((p) => p.id)]);
  assert.equal(presetsFor({ fixtures: false }), PRESETS);
  assert.equal(presetsFor(), PRESETS);
});

test('findPreset looks in the list it is given', () => {
  assert.equal(findPreset(FIXTURE_PRESET.id), null);
  assert.equal(findPreset(FIXTURE_PRESET.id, presetsFor({ fixtures: true })), FIXTURE_PRESET);
});
