import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripModel } from './caveat-strip.js';
import { CAVEATS, STRIP_TEXT } from '../caveat-catalog.js';

test('strip shows the preliminary badge while the flag is set', () => {
  assert.equal(stripModel({ preliminary: true }).badge, 'Preliminary');
  assert.equal(stripModel({ preliminary: false }).badge, null);
});

test('strip is not dismissible and links to the method', () => {
  const m = stripModel();
  assert.equal(m.text, STRIP_TEXT);
  assert.equal(m.readMore, 'How this is made');
  assert.equal('dismiss' in m, false);
});

test('catalog has C1 to C8 with unique ids', () => {
  assert.deepEqual(CAVEATS.map((c) => c.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
});
