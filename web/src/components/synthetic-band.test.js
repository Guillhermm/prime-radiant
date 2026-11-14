import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticModel, titleFor } from './synthetic-band.js';

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
