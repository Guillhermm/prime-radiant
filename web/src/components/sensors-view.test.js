import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorPoints, sensorsSummary } from '../sensors-model.js';
import { harmonize } from '../../../core/index.js';
import { satelliteSpans } from '../satellites.js';
import { fitWindow } from '../view-data.js';
import { answerModel, axisScale, sensorsFoot, chartModel, pointLines, ratioNote, sensorsTable, sensorsWidth, stepsModel } from './sensors-view.js';

const series = (id, start, values) => ({ id, unit: 'fire-cell-days', start, values, method: { id: 'raw', version: 1 }, comparable: false });
const months = (n, f) => Array.from({ length: n }, (_, i) => f(i));
// 2010-01 to 2013-12: MODIS throughout; S-NPP 2012-01 to 2013-06 at twice MODIS; NOAA-20 from 2012-07, equal to S-NPP.
const sample = () => {
  const m = months(48, (i) => 10 + (i % 12));
  const sensors = {
    modis: series('modis', '2010-01', m),
    viirs: series('viirs', '2010-01', m.map((v, i) => (i >= 24 && i <= 41 ? 2 * v : null))),
    noaa20: series('noaa20', '2010-01', m.map((v, i) => (i >= 30 ? 2 * v : null))),
  };
  const manifest = {
    month0: '2010-01', last_month: '2013-12',
    coverage: { modis: ['2010-01', '2013-12'], viirs: ['2012-01', '2013-06'], noaa20: ['2012-07', '2013-12'] },
    partial_months: { modis: [], viirs: [], noaa20: [] },
  };
  const h = harmonize([{ level: 'aoi', ...sensors }], manifest);
  return { sensors, manifest, h: { ...h, fit: fitWindow(sensors, h.R, manifest) } };
};

const summary = () => { const { sensors, manifest, h } = sample(); return { sensors, manifest, h, sum: sensorsSummary(sensors, h, manifest) }; };

test('answer card: core R with its window, interval, years, level and a low-confidence chip; K beside it', () => {
  const { sum } = summary();
  const a = answerModel(sum);
  assert.equal(a.eyebrow, 'R fitted on 2012-02 to 2013-06', 'the months R used: not core\'s nominal 2002-08 start, not the partial 2012-01');
  assert.equal(answerModel({ ...sum, fit: null }).eyebrow, 'Where MODIS and S-NPP both flew');
  assert.equal(a.big, '2.00×');
  assert.equal(a.unit, 'VIIRS ÷ MODIS');
  assert.match(a.lead, /^VIIRS counts 2\.0 fire-cell-days for every one MODIS counts here/);
  assert.equal(a.note.text, '95% interval 2.00–2.00 · 2 years · one value for the year · fit on this area');
  assert.equal(a.note.lowConfidence, true, 'two overlap years fail the 5-year usability rule');
  assert.equal(a.k.text, 'K = 1.00: S-NPP ÷ NOAA-20, used after S-NPP ends.');
});

test('ratio note names a fallback level and per-month ratios; no R says why', () => {
  const n = ratioNote({ value: 2.516, ci: [2.463, 2.578], nYears: 10, perMonth: [], level: 'tiles', usable: true });
  assert.equal(n.text, '95% interval 2.46–2.58, all months · 10 years · one value per calendar month · fit on the 10° tiles around this area');
  assert.deepEqual([n.lowConfidence, n.borrowed], [false, true]);
  assert.equal(ratioNote({ value: null }), null);
  const a = answerModel({ R: { value: null }, K: null, state: 'no-r' });
  assert.equal(a.big, null);
  assert.match(a.lead, /R cannot be computed/);
  assert.equal(a.k, null);
});

// Pantanal on the real build: R 1.91 over all months, September's own R 1.81.
const perMonthR = () => ({
  value: 1.91, ci: [1.804, 2.053], nYears: 10, level: 'aoi', usable: true, window: { from: '2002-08', to: '2021-12' },
  perMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, value: i === 8 ? 1.809 : 1.9, ci: i === 8 ? [1.7, 1.93] : [1.8, 2] })),
});

test('per-month R: the headline says all months, the note and the step name the month\'s own R', () => {
  const { sum } = summary();
  const R = perMonthR();
  const per = { ...sum, R, example: { month: '2007-09', count: 2615, core: 4730, factor: { name: 'R', value: 1.809 } } };
  const a = answerModel(per);
  assert.equal(a.big, '1.91×');
  assert.equal(a.unit, 'VIIRS ÷ MODIS, all months');
  assert.equal(a.note.text, '95% interval 1.80–2.05, all months · 10 years · September uses its own R, 1.81 (1.70–1.93) · fit on this area');
  assert.equal(stepsModel(per, { viirsFrom: '2012-01', viirsTo: null })[1].title, '× R for September = 1.81');
  // One yearly R (Mato Grosso): the plain wording.
  const yearly = { ...per, R: { ...R, perMonth: undefined }, example: { ...per.example, factor: { name: 'R', value: 1.91 } } };
  assert.equal(answerModel(yearly).unit, 'VIIRS ÷ MODIS');
  assert.equal(stepsModel(yearly, { viirsFrom: '2012-01', viirsTo: null })[1].title, '× R = 1.91');
  assert.match(answerModel(yearly).note.text, /one value for the year/);
});

test('steps: the busiest month scaled from MODIS with the value core gives it, then NOAA-20 × K after S-NPP', () => {
  const { sum, manifest } = summary();
  const steps = stepsModel(sum, { viirsFrom: '2012-01', viirsTo: manifest.coverage.viirs[1] });
  assert.deepEqual(steps.map((x) => x.title), ['Before 2012', '× R = 2.00', 'After Jun 2013']);
  assert.deepEqual(steps.map((x) => x.value), ['21', '42', '42']);
  assert.equal(steps[0].text, 'Only MODIS flew. Dec 2010, MODIS:');
  assert.equal(steps[2].text, 'NOAA-20 × K = 1.00 continues S-NPP. Dec 2013:');
  assert.ok(steps.every((x) => !('preview' in x)), 'gate V1 validated R and K: no Preview tag');
  const none = stepsModel({ ...sum, example: null, kExample: null }, { viirsFrom: '2012-01', viirsTo: null });
  assert.equal(none[2].value, null);
  assert.match(none[2].text, /No month in this range needs it yet/);
});

test('axis steps are round and reach past the maximum', () => {
  assert.deepEqual(axisScale(33506), { max: 40000, step: 10000 });
  assert.deepEqual(axisScale(1300), { max: 1500, step: 500 });
  assert.deepEqual(axisScale(0), { max: 1, step: 1 });
});

test('chart: overlap, four series with NOAA-20, satellites from the manifest to their last month, synthetic stamp, phone abbreviations', () => {
  const { sensors, manifest, sum } = summary();
  const pts = sensorPoints(sensors, sum.months, 'year');
  const sats = satelliteSpans({ ...manifest, satellites: { modis: ['Terra', 'Aqua'], viirs: ['S-NPP'], noaa20: ['NOAA-20'], eras: { modis_aqua_from: '2002-07-04' } } });
  const m = chartModel(pts, { width: 960, fit: sum.fit, satellites: sats, synthetic: true });
  assert.ok(m.overlap.x > m.left && m.overlap.label === 'Months used for R');
  assert.deepEqual(m.timeline.map((t) => t.name), ['Terra', 'Aqua', 'S-NPP', 'NOAA-20']);
  const byMonth = chartModel(sensorPoints(sensors, sum.months, 'month'), { width: 960, satellites: sats });
  assert.ok(byMonth.timeline[2].x2 < byMonth.timeline[3].x2, 'S-NPP stops before NOAA-20');
  assert.ok(m.lines.noaa20.startsWith('M'));
  assert.ok(m.estimated.length > 0, 'core marks the MODIS × R and NOAA-20 × K years estimated');
  assert.equal(m.stamp.text, 'SYNTHETIC DATA');
  assert.match(m.aria, /^Synthetic data\. /);
  assert.doesNotMatch(m.aria, /Preview/);
  const phone = chartModel(pts, { width: 360, fit: sum.fit, satellites: sats });
  assert.equal(phone.labels.length, 0);
  assert.equal(phone.overlap.label, 'Months used for R');
  assert.deepEqual(phone.timeline.map((t) => t.name).slice(2), ['SNPP', 'N20']);
  assert.equal(phone.stamp, null);
});

test('hidden series draw nothing', () => {
  const { sensors, sum } = summary();
  const m = chartModel(sensorPoints(sensors, sum.months, 'year'), { visible: ['modis'] });
  assert.equal(m.lines.viirs, '');
  assert.equal(m.lines.noaa20, '');
  assert.equal(m.lines.harmonized, '');
  assert.equal(m.estimated, '');
});

test('tooltip and table: the harmonized value core gives and its source; not operating instead of blank', () => {
  const { sensors, sum } = summary();
  const pts = sensorPoints(sensors, sum.months, 'year');
  assert.deepEqual(pointLines(pts[0]), ['2010', 'Harmonized 372, estimated', 'S-NPP not operating · NOAA-20 not operating · MODIS 186']);
  const t = sensorsTable(pts, { step: 'year', r: 2.516, synthetic: true });
  assert.equal(t.caption, 'Fire-cell-days per year, by sensor. R = 2.52. Synthetic data, not real fire detections.');
  assert.deepEqual(t.columns, ['MODIS', 'S-NPP', 'NOAA-20', 'Harmonized', 'Source']);
  assert.deepEqual(t.rows.at(-1).cells, ['186', 'Not operating', 'Not operating', '372', 'MODIS × R, estimated']);
  assert.equal(t.rows[0].cells[4], 'S-NPP and NOAA-20 × K, estimated');
  assert.equal(sensorsTable(pts, { step: 'year', r: null }).caption, 'Fire-cell-days per year, by sensor.');
});

test('the chart key names the dotted center only when core marks a month estimated', () => {
  const { sum } = summary();
  assert.match(sensorsFoot(sum), /Dotted: NOAA-20\. Band: harmonized, dotted where estimated\.$/);
  assert.doesNotMatch(sensorsFoot({ ...sum, months: sum.months.map((m) => ({ ...m, estimated: false })) }), /dotted where/);
  assert.match(sensorsFoot(sum), /^Shaded: months used for R\. /);
  assert.match(sensorsFoot({ ...sum, fit: null, overlap: { from: null, to: null } }), /^No month in this range where MODIS and S-NPP both flew\. Dashed/);
});

// 2000-11 to 2003-12: MODIS only, Terra alone until 2002-06 (core leaves those months null, flagged terra-only).
const terraSample = () => {
  const n = 38;
  const sensors = {
    modis: series('modis', '2000-11', months(n, () => 10)),
    viirs: series('viirs', '2000-11', months(n, () => null)),
    noaa20: series('noaa20', '2000-11', months(n, () => null)),
  };
  // Harmonized as core gives it: null before 2002-07, MODIS × 2 after.
  const h = { series: { start: '2000-11', values: months(n, (i) => (i >= 20 ? 20 : null)), flags: months(n - 20, (i) => ({ month: `${2002 + Math.floor((6 + i) / 12)}-${String(((6 + i) % 12) + 1).padStart(2, '0')}`, flag: 'estimated' })) }, R: { value: 2, window: { from: '2002-08', to: '2021-12' } }, K: null, fit: null };
  const manifest = { coverage: { modis: ['2000-11', '2003-12'], viirs: ['2012-01', '2025-12'] }, partial_months: {} };
  return { sensors, h, manifest };
};

test('by year, a year the range cuts is partial for every series, a Terra-only gap for the harmonized one', () => {
  const { sensors, h, manifest } = terraSample();
  const pts = sensorPoints(sensors, sensorsSummary(sensors, h, manifest).months, 'year');
  assert.deepEqual(pts.map((p) => [p.key, p.partial.length]), [['2000', 4], ['2001', 0], ['2002', 1], ['2003', 0]]);
  assert.deepEqual(pts[2].partial, ['harmonized']);
  assert.deepEqual(sensorPoints(sensors, sensorsSummary(sensors, h, manifest).months, 'month')[0].partial, []);
});

test('chart: partial years are hollow and off the lines, the foot says so; labels clear the axis and each other', () => {
  const { sensors, h, manifest } = terraSample();
  const sum = sensorsSummary(sensors, h, manifest);
  const pts = sensorPoints(sensors, sum.months, 'year');
  const m = chartModel(pts, { width: 960 });
  assert.deepEqual(m.hollow.map((p) => p.id), ['modis', 'harmonized'], '2000 MODIS (two months) and the 2002 harmonized sum');
  assert.equal(m.lines.modis.split('M').length - 1, 1, 'one MODIS run, from 2001');
  assert.ok(!m.lines.modis.startsWith(`M${m.xs[0].toFixed(1)} `), 'the 2000 point is not on the line');
  assert.ok(m.lines.harmonized.startsWith(`M${m.xs[3].toFixed(1)} `), 'the harmonized line starts at the first whole year, 2003');
  assert.deepEqual(m.spans.map((t) => t.text), ['2000, Nov–Dec', '2002, Jul–Dec'], 'each partial year names the months its sum covers');
  assert.match(sensorsFoot(sum, pts), /Dashed: S-NPP\. Dotted: NOAA-20\. Band: harmonized, dotted where estimated\. Hollow: partial years, off the lines\.$/);
  assert.doesNotMatch(sensorsFoot(sum, pts.filter((p) => !p.partial.length)), /Hollow/);
  // Equal-ish values at 0: labels 16 units apart, the lowest above the axis text.
  const flat = [{ key: '2010', modis: 0, viirs: 1, noaa20: 2, harmonized: 3, estimated: false, sources: [], partial: [] }, { key: '2011', modis: 0, viirs: 1, noaa20: 2, harmonized: 3, estimated: false, sources: [], partial: [] }];
  const f = chartModel(flat, { width: 960 });
  const ys = f.labels.map((l) => l.y).sort((a, b) => a - b);
  ys.slice(1).forEach((v, i) => assert.ok(v - ys[i] >= 14, `labels ${v - ys[i]} apart`));
  assert.ok(ys.at(-1) <= f.bottom, 'lowest label sits above the x axis text');
  assert.equal(f.xticks.at(-1).anchor, 'end', 'the last year ends at the plot edge, clear of the labels');
});

test('the viewBox follows the pixel width within bounds', () => {
  assert.equal(sensorsWidth(0), 960);
  assert.equal(sensorsWidth(200), 280);
  assert.equal(sensorsWidth(800.4), 800);
  assert.equal(sensorsWidth(5000), 1400);
});

