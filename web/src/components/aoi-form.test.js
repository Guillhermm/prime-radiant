import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBboxInputs, bboxToInputs } from './aoi-form.js';
import { FIXTURE_PRESET } from '../presets.js';

const ok = { south: '-20.1', west: '-58.2', north: '-15.3', east: '-55.0' };

test('valid input becomes [w, s, e, n]', () => {
  assert.deepEqual(parseBboxInputs(ok), { bbox: [-58.2, -20.1, -55, -15.3], errors: {} });
});

test('decimal comma and spaces are accepted', () => {
  assert.deepEqual(parseBboxInputs({ ...ok, south: ' -20,1 ' }).bbox, [-58.2, -20.1, -55, -15.3]);
});

test('empty and non-numeric fields get a message each', () => {
  const r = parseBboxInputs({ south: '', west: 'abc', north: '-15.3', east: '-55' });
  assert.equal(r.bbox, null);
  assert.equal(r.errors.south, 'Required');
  assert.match(r.errors.west, /number/);
  assert.equal(r.errors.north, undefined);
});

test('range errors name the field limit', () => {
  const r = parseBboxInputs({ ...ok, north: '91', east: '181' });
  assert.match(r.errors.north, /90/);
  assert.match(r.errors.east, /180/);
});

test('cross-field and cap errors land on bbox', () => {
  assert.match(parseBboxInputs({ ...ok, west: '-50' }).errors.bbox, /west/);
  assert.match(parseBboxInputs({ ...ok, north: '-21' }).errors.bbox, /south/);
  const capped = parseBboxInputs(ok, { maxAreaDeg2: 1 });
  assert.equal(capped.bbox, null);
  assert.match(capped.errors.bbox, /cap of 1/);
});

test('bboxToInputs round-trips and handles null', () => {
  assert.deepEqual(parseBboxInputs(bboxToInputs([-58.2, -20.1, -55, -15.3])).bbox, [-58.2, -20.1, -55, -15.3]);
  assert.deepEqual(bboxToInputs(null), { west: '', south: '', east: '', north: '' });
});

test('the fixture preset is a valid bbox and flagged as placeholder', () => {
  for (const p of [FIXTURE_PRESET]) {
    assert.ok(p.placeholder);
    assert.equal(parseBboxInputs(bboxToInputs(p.bbox)).errors.bbox, undefined, p.id);
    assert.notEqual(parseBboxInputs(bboxToInputs(p.bbox)).bbox, null, p.id);
  }
});
