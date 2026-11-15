import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboKey, countText } from './name-field.js';

const closed = { open: false, active: -1, count: 3 };
const at = (active) => ({ open: true, active, count: 3 });

test('Down opens the list on the first option, then moves and wraps', () => {
  assert.deepEqual(comboKey('ArrowDown', closed), { open: true, active: 0 });
  assert.deepEqual(comboKey('ArrowDown', at(0)), { open: true, active: 1 });
  assert.deepEqual(comboKey('ArrowDown', at(2)), { open: true, active: 0 });
  assert.deepEqual(comboKey('ArrowDown', at(-1)), { open: true, active: 0 });
});

test('Alt+Down opens the list without choosing an option', () => {
  assert.deepEqual(comboKey('ArrowDown', closed, { alt: true }), { open: true, active: -1 });
  assert.deepEqual(comboKey('ArrowDown', at(1), { alt: true }), { open: true, active: 1 });
});

test('Up opens the list on the last option, then moves and wraps', () => {
  assert.deepEqual(comboKey('ArrowUp', closed), { open: true, active: 2 });
  assert.deepEqual(comboKey('ArrowUp', at(2)), { open: true, active: 1 });
  assert.deepEqual(comboKey('ArrowUp', at(0)), { open: true, active: 2 });
  assert.deepEqual(comboKey('ArrowUp', at(-1)), { open: true, active: 2 });
});

test('arrows do nothing without suggestions', () => {
  assert.equal(comboKey('ArrowDown', { open: false, active: -1, count: 0 }), null);
  assert.equal(comboKey('ArrowUp', { open: false, active: -1, count: 0 }), null);
});

test('Enter picks the active option and closes; without one it is left to the form', () => {
  assert.deepEqual(comboKey('Enter', at(1)), { open: false, active: -1, pick: 1 });
  assert.equal(comboKey('Enter', at(-1)), null);
  assert.equal(comboKey('Enter', closed), null);
});

test('Escape closes an open list; on a closed one it is left to the sheet', () => {
  assert.deepEqual(comboKey('Escape', at(1)), { open: false, active: -1 });
  assert.equal(comboKey('Escape', closed), null);
});

test('other keys belong to the text field', () => {
  for (const k of ['a', 'Home', 'End', 'ArrowLeft', 'Tab', 'Backspace']) assert.equal(comboKey(k, at(0)), null);
});

test('countText words the number of matches', () => {
  assert.equal(countText(0), '');
  assert.match(countText(1), /^1 place matches/);
  assert.match(countText(8), /^8 places match/);
});
