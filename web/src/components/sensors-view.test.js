import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harmonize } from '../../../core/index.js';
import { sensorPoints, sensorsSummary as summaryOf } from '../sensors-model.js';

// The harmonized line is core's output, as in the app.
const sensorsSummary = (s) => summaryOf(s, harmonize(s));
import { answerModel, axisScale, sensorsFoot, chartModel, pointLines, sensorsTable, sensorsWidth, stepsModel } from './sensors-view.js';

const series = (id, start, values) => ({ id, unit: 'fire-cell-days', start, values });
const months = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// 2010-01 to 2013-12: VIIRS from 2012-01 at twice MODIS.
const data = () => ({
  modis: series('modis', '2010-01', months(48, (i) => 10 + (i % 12))),
  viirs: series('viirs', '2010-01', months(48, (i) => (i < 24 ? null : 2 * (10 + (i % 12))))),
});
const SATS = { modis: [{ name: 'Terra', from: '2000-11' }, { name: 'Aqua', from: '2002-07' }], viirs: [{ name: 'S-NPP', from: '2012-01' }, { name: 'NOAA-20', from: '2018-04' }] };

test('answer card: R as a display number with its sentence and the not-reviewed note', () => {
  const a = answerModel(sensorsSummary(data()), { viirsFrom: '2012-01', span: { from: '2000-11', to: '2026-10' } });
  assert.equal(a.eyebrow, 'Where both sensors flew · 2012–2013');
  assert.equal(a.big, '2.0×');
  assert.equal(a.unit, 'VIIRS ÷ MODIS');
  assert.equal(a.lead, 'VIIRS counted 2.0 fire-cell-days for every one MODIS counted in this area.');
  assert.equal(a.note, 'R from 24 overlap months with detections. Not yet reviewed by the science team.');
});

test('answer card states: a range before VIIRS offers the whole span; no fire says R cannot be computed', () => {
  const early = { modis: series('modis', '2005-01', [1, 2]), viirs: series('viirs', '2005-01', [null, null]) };
  const a = answerModel(sensorsSummary(early), { viirsFrom: '2012-01', span: { from: '2000-11', to: '2026-10' } });
  assert.equal(a.big, null);
  assert.equal(a.lead, 'No overlap in this range. R comes from 2012 on; widen the period to see it.');
  assert.equal(a.widen, 'Show 2000–2026');
  const none = { modis: series('modis', '2012-01', [0, 0]), viirs: series('viirs', '2012-01', [0, 0]) };
  assert.match(answerModel(sensorsSummary(none), { viirsFrom: '2012-01' }).lead, /^Both sensors flew but neither saw fire here, so R cannot be computed/);
});

test('steps: the busiest MODIS-only month, R as planned, and what the Calendar shows today from core', () => {
  const steps = stepsModel(sensorsSummary(data()), { viirsFrom: '2012-01' });
  assert.equal(steps[0].title, 'Before 2012');
  assert.equal(steps[0].text, 'Only MODIS flew. Dec 2010, MODIS:');
  assert.equal(steps[0].value, '21');
  assert.equal(steps[1].title, '× R = 2.0, planned');
  assert.equal(steps[1].value, '42');
  assert.equal(steps[1].preview, true);
  assert.equal(steps[2].title, 'In the Calendar today');
  assert.equal(steps[2].text, 'R is not applied yet: the calendar shows MODIS as counted until the science team validates R.');
  assert.equal(steps[2].value, '21', "core's stub value for the same month");
  // Once core scales the month, the card shows core's number instead of the stub sentence.
  const s = data();
  const core = harmonize(s);
  const scaled = summaryOf(s, { ...core, values: core.values.map((v, i) => (i === 11 ? 42 : v)) });
  assert.deepEqual([stepsModel(scaled, { viirsFrom: '2012-01' })[2].text, stepsModel(scaled, { viirsFrom: '2012-01' })[2].value], ["Core's harmonized value for Dec 2010:", '42']);
});

test('axis steps are round and reach past the maximum', () => {
  assert.deepEqual(axisScale(33506), { max: 40000, step: 10000 });
  assert.deepEqual(axisScale(1300), { max: 1500, step: 500 });
  assert.deepEqual(axisScale(0), { max: 1, step: 1 });
});

test('chart: overlap from the first shared month, satellites up to the end, synthetic stamp, phone abbreviations', () => {
  const s = data();
  const sum = sensorsSummary(s);
  const pts = sensorPoints(s, sum.harmonized, 'year');
  const m = chartModel(pts, { width: 960, overlapFrom: sum.ratio.from, satellites: SATS, synthetic: true });
  assert.ok(m.overlap.x > m.left && m.overlap.label === 'Both sensors fly');
  assert.deepEqual(m.timeline.map((t) => t.name), ['Terra', 'Aqua', 'S-NPP'], 'NOAA-20 starts after the range');
  assert.equal(m.stamp.text, 'SYNTHETIC DATA');
  assert.match(m.aria, /^Synthetic data\. /);
  assert.equal(m.estimated, '', 'the core stub marks no month estimated');
  // Core's stub ends on MODIS, so the two share one label instead of stacking.
  assert.deepEqual(m.labels.map((l) => l.text).sort(), ['MODIS = harmonized', 'VIIRS']);
  const phone = chartModel(pts, { width: 360, overlapFrom: sum.ratio.from, satellites: SATS });
  assert.equal(phone.labels.length, 0);
  assert.equal(phone.overlap.label, 'Overlap');
  assert.equal(phone.timeline[2].name, 'SNPP');
  assert.equal(phone.stamp, null);
});

test('hidden series draw nothing', () => {
  const s = data();
  const sum = sensorsSummary(s);
  const m = chartModel(sensorPoints(s, sum.harmonized, 'year'), { visible: ['modis'] });
  assert.equal(m.lines.viirs, '');
  assert.equal(m.lines.harmonized, '');
  assert.equal(m.estimated, '');
});

test('tooltip and table: the harmonized value is core\'s, the same the Calendar shows; not operating instead of blank', () => {
  const s = data();
  const pts = sensorPoints(s, sensorsSummary(s).harmonized, 'year');
  assert.deepEqual(pointLines(pts[0]), ['2010', 'Harmonized 186', 'VIIRS not operating · MODIS 186']);
  const t = sensorsTable(pts, { step: 'year', r: 2, synthetic: true });
  assert.equal(t.caption, 'Fire-cell-days per year, by sensor. R = 2.0 (Preview). Synthetic data, not real fire detections.');
  assert.deepEqual(t.columns, ['MODIS', 'VIIRS', 'Harmonized', 'Source']);
  assert.deepEqual(t.rows.at(-1).cells, ['186', 'Not operating', '186', 'MODIS']);
  assert.equal(t.rows[0].cells[2], t.rows[0].cells[0], 'the stub takes MODIS where it flew, also in the overlap');
  const mixed = { modis: series('modis', '2011-11', [5, null, 1]), viirs: series('viirs', '2011-11', [null, 4, 2]) };
  const byYear = sensorPoints(mixed, sensorsSummary(mixed).harmonized, 'year');
  assert.deepEqual(byYear.map((p) => p.sources), [['MODIS', 'VIIRS'], ['MODIS']]);
  assert.equal(sensorsTable(byYear, { step: 'year', r: null }).rows.at(-1).cells[3], 'MODIS and VIIRS');
});

test('the viewBox follows the pixel width within bounds', () => {
  assert.equal(sensorsWidth(0), 960);
  assert.equal(sensorsWidth(200), 280);
  assert.equal(sensorsWidth(800.4), 800);
  assert.equal(sensorsWidth(5000), 1400);
});

test('the chart key names the dotted line only when core marks a month estimated', () => {
  const s = data();
  assert.doesNotMatch(sensorsFoot(sensorsSummary(s)), /dotted/, 'the stub marks nothing estimated');
  const core = harmonize(s);
  assert.match(sensorsFoot(summaryOf(s, { ...core, estimated: core.values.map((_, i) => i < 24) })), /; dotted where it is estimated\.$/);
});
