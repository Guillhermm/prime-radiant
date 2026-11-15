import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripModel, STRIP_TEXT } from './caveat-strip.js';
import { NO_GATES } from '../../../core/caveats.js';

test('gate V1 passed: no Preliminary badge by default; before the gate the badge shows', () => {
  assert.equal(stripModel().badge, null);
  assert.equal(stripModel().preliminary, false);
  assert.equal(stripModel({ gates: NO_GATES }).badge, 'Preliminary');
});

test('strip is not dismissible, links to the method and counts core caveats', () => {
  const m = stripModel();
  assert.equal(m.text, STRIP_TEXT);
  assert.match(m.text, /VIIRS-equivalent \(MODIS × R\)/);
  assert.equal(m.readMore, 'How this is made');
  assert.equal('dismiss' in m, false);
  assert.equal(m.count, 9);
});
