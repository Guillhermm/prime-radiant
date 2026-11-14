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

test('anomaly legend has 11 ramp bins centered on the median and a flag entry', async () => {
  const { anomalyLegendModel } = await import('./legend.js');
  const m = anomalyLegendModel();
  assert.equal(m.bins.length, 11);
  assert.match(m.bins[5].text, /near median/);
  assert.match(m.bins[0].text, /0th to 9th percentile, below median/);
  assert.match(m.bins[10].text, /91st to 100th percentile, above median/);
  assert.equal(m.marks[0].id, 'flagged');
  assert.match(m.unit, /percentile rank/);
});
