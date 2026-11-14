import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_SENTENCE, legendModel } from './legend.js';

test('legend lists seven bins, no data, marks and the unit', () => {
  const m = legendModel();
  assert.equal(m.bins.length, 7);
  assert.equal(m.bins[0].text, 'No detections (0)');
  assert.match(m.nodata, /No data/);
  assert.deepEqual(m.marks.map((k) => k.id), ['estimated', 'partial']);
  assert.equal(m.unit, UNIT_SENTENCE);
  assert.match(m.unit, /per 1,000 grid cells/);
});
