import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlaces } from './places.js';

const square = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const fc = (...features) => ({ type: 'FeatureCollection', features });
const state = (name, country, ring) => ({ type: 'Feature', properties: { name, country }, geometry: { type: 'Polygon', coordinates: ring } });

test('a square takes the state that holds most of its fine-cell centers', () => {
  const places = createPlaces(fc(state('West', 'Land', square(0, 0, 0.7, 1)), state('East', 'Land', square(0.7, 0, 1, 1))));
  assert.deepEqual(places(0, 0), { country: 'Land', state: 'West' });
});

test('sea and uncovered countries do not vote; no state at all is null', () => {
  const places = createPlaces(fc(state('Coast', 'Land', square(0.8, 0, 1, 1))));
  assert.deepEqual(places(0, 0), { country: 'Land', state: 'Coast' });
  assert.equal(places(5, 5), null);
  assert.equal(createPlaces(fc())(0, 0), null);
});

test('a tie goes to the name that sorts first, so the result is stable', () => {
  const places = createPlaces(fc(state('Beta', 'Land', square(0.5, 0, 1, 1)), state('Alpha', 'Land', square(0, 0, 0.5, 1))));
  assert.equal(places(0, 0).state, 'Alpha');
});

test('real file: the 2025 top square (7S-6S, 45W-44W) is in Maranhão, Brazil', () => {
  const gj = JSON.parse(fs.readFileSync(new URL('./domain/brazil-admin1.geojson', import.meta.url), 'utf8'));
  assert.equal(gj.features.length, 27);
  assert.deepEqual(createPlaces(gj)(-45, -7), { country: 'Brazil', state: 'Maranhão' });
});
