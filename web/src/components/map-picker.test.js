import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARM_TEXT, areaSetText, bboxFromCorners, isTooSmall, bboxToBounds, boundsToBbox } from './map-picker.js';

test('corners in any order give [west, south, east, north]', () => {
  const a = { lat: -15.3, lng: -55 };
  const b = { lat: -20.1, lng: -58.2 };
  assert.deepEqual(bboxFromCorners(a, b), [-58.2, -20.1, -55, -15.3]);
  assert.deepEqual(bboxFromCorners(b, a), [-58.2, -20.1, -55, -15.3]);
});

test('coordinates are rounded to four decimals', () => {
  assert.deepEqual(bboxFromCorners({ lat: 0.123456, lng: 1.987654 }, { lat: 1.5, lng: 3 }), [1.9877, 0.1235, 3, 1.5]);
});

test('a box outside the world is clamped, and the antimeridian is never crossed', () => {
  assert.deepEqual(bboxFromCorners({ lat: -95, lng: -190 }, { lat: 95, lng: 200 }), [-180, -90, 180, 90]);
});

test('two identical points, or a flat box, give null', () => {
  assert.equal(bboxFromCorners({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), null);
  assert.equal(bboxFromCorners({ lat: 1, lng: 1 }, { lat: 1, lng: 2 }), null);
});

test('isTooSmall flags sides under one grid cell', () => {
  assert.equal(isTooSmall([0, 0, 0.05, 1]), true);
  assert.equal(isTooSmall([0, 0, 0.1, 0.1]), false);
});

test('bounds round-trip', () => {
  const b = [-58.2, -20.1, -55, -15.3];
  assert.deepEqual(bboxToBounds(b), [[-20.1, -58.2], [-15.3, -55]]);
  assert.deepEqual(boundsToBbox(bboxToBounds(b)), b);
});

test('sameBbox compares by value and handles null', async () => {
  const { sameBbox } = await import('./map-picker.js');
  assert.equal(sameBbox([1, 2, 3, 4], [1, 2, 3, 4]), true);
  assert.equal(sameBbox([1, 2, 3, 4], [1, 2, 3, 5]), false);
  assert.equal(sameBbox(null, null), true);
  assert.equal(sameBbox(null, [1, 2, 3, 4]), false);
});

test('the status after a draw reads north to south, then east to west, at one decimal', () => {
  assert.equal(areaSetText([-50, -12.5, -45, -8]), 'Area set: 8.0°S to 12.5°S, 45.0°W to 50.0°W.');
  assert.equal(areaSetText([-1.25, -0.5, 3, 2]), 'Area set: 2.0°N to 0.5°S, 3.0°E to 1.3°W.');
  assert.equal(ARM_TEXT, 'Click two opposite corners.');
});
