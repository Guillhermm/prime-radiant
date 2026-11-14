import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripModel } from './caveat-strip.js';
import { CAVEATS, STRIP_TEXT } from '../caveat-catalog.js';

test('strip shows the preliminary badge while the flag is set', () => {
  assert.equal(stripModel({ preliminary: true }).badge, 'Preliminary');
  assert.equal(stripModel({ preliminary: false }).badge, null);
});

test('strip is not dismissible and offers Read more', () => {
  const m = stripModel();
  assert.equal(m.readMore, 'Read more');
  assert.equal('dismiss' in m, false);
  assert.equal(m.text, STRIP_TEXT);
});

test('catalog has C1 to C8 with unique ids', () => {
  assert.deepEqual(CAVEATS.map((c) => c.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
});

test('synthetic manifests show a Synthetic demo data badge that cannot be dismissed', () => {
  const m = stripModel({ synthetic: true });
  assert.equal(m.syntheticBadge, 'Synthetic demo data');
  assert.equal('dismiss' in m, false);
  assert.equal(stripModel().syntheticBadge, null);
});
