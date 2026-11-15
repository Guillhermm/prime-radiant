import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE, NO_MEDIAN, PARTIAL_NOTE, barStripModel, cellCaveats, detailModel, estimationText, panelEyebrow, medianLead, noDataNote, provenanceText, satellitesInOrbit, scrollForSheet, valueLabel, valueLabelY } from './cell-detail.js';
import { caveatsFor } from '../../../core/caveats.js';

const obs = { year: 2012, month: 9, value: 1204, status: 'observed', estimated: false };
const sept = (year, value, o = {}) => ({ year, month: 9, value, status: 'harmonized', estimated: true, ...o });
const manifest = {
  coverage: { modis: ['2000-11', '2026-10'], viirs: ['2012-01', '2026-10'], noaa20: ['2018-04', '2026-10'] },
  satellites: { modis: ['Terra', 'Aqua'], viirs: ['S-NPP'], noaa20: ['NOAA-20'], eras: { modis_aqua_from: '2002-07-04' } },
};

test('observed cell: value, density, provenance, no median says so instead of a number', () => {
  const m = detailModel(obs, { aoiCells: 1000 });
  assert.equal(m.title, 'September 2012');
  assert.equal(m.value, '1,204');
  assert.equal(m.density, '1,204 per 1,000 cells');
  assert.equal(m.provenance, 'VIIRS S-NPP, observed');
  assert.equal(m.compare, null);
  assert.equal(m.noMedian, NO_MEDIAN);
  assert.equal(m.estimation, null);
});

test('comparison uses core median and names the years behind it', () => {
  const all = [sept(2010, 1000), sept(2011, 3000), sept(2012, 12122, { median: 2000, medianYears: [2010, 2011] })];
  const m = detailModel(all[2], { aoiCells: 1000, cells: all });
  assert.equal(m.compare.text, '6.1×');
  assert.equal(m.compare.lead, 'vs the median of the 2 earlier Septembers (2010–2011)');
  assert.equal(m.compare.median, '2,000');
  assert.equal(m.compare.dir, 'above');
  assert.equal(m.rank, 'Busiest of 3 Septembers. Next: 2011 with 3,000.');
  assert.equal(m.stripTitle, 'Every September, 2010–2012');
  assert.match(m.stripLabel, /2012: 12,122\. Median of earlier years 2,000\. Busiest of 3 Septembers\./);
});

test('estimated cell names the factor core applied, where it was fit and its confidence (V1 fix F4 wording)', () => {
  const R = { value: 2.5, perMonth: Array.from({ length: 12 }, () => ({ value: 2 })), level: 'aoi', usable: true };
  const est = sept(2005, 10, { source: { id: 'modis', factor: { name: 'R', value: 2.0 } } });
  assert.equal(estimationText(est, { R }), 'Estimated: MODIS × R, R = 2.00 for September.');
  assert.equal(detailModel(est, { aoiCells: 10, ratios: { R } }).estimation, 'Estimated: MODIS × R, R = 2.00 for September.');
  const borrowed = estimationText(est, { R: { value: 2, level: 'ring', usable: false } });
  assert.match(borrowed, /R comes from the tiles around this area and the ring beyond/);
  assert.match(borrowed, /low confidence/);
  const k = sept(2027, 10, { source: { id: 'noaa20', factor: { name: 'K', value: 0.984 } } });
  assert.equal(estimationText(k, { K: { value: 0.984, level: 'aoi', usable: true } }), 'Estimated: NOAA-20 × K, K = 0.98.');
  assert.equal(provenanceText(est), 'Estimated, scaled to VIIRS-equivalent (MODIS × R)');
  assert.equal(provenanceText({ ...obs, status: 'partial' }), 'VIIRS S-NPP, observed, partial month');
  assert.equal(estimationText(obs), null);
});

test('a partial month says the count is low from an outage', () => {
  assert.equal(detailModel({ ...obs, status: 'partial' }, { aoiCells: 1000 }).partial, PARTIAL_NOTE);
  assert.equal(detailModel(obs, { aoiCells: 1000 }).partial, null);
});

test('zero is a value, not no data', () => {
  const m = detailModel({ ...obs, value: 0 }, { aoiCells: 1000 });
  assert.equal(m.value, '0');
  assert.equal(m.noData, false);
});

test('no-data cell never reads as zero', () => {
  const m = detailModel({ year: 2000, month: 3, value: null, status: 'no-data', estimated: false }, { aoiCells: 1000 });
  assert.equal(m.noData, true);
  assert.equal(m.value, 'No data');
  assert.match(m.note, /not zero/);
  assert.equal(m.compare, null);
});

test('a no-data month says why: outside the domain, Terra only, or no R to scale MODIS', () => {
  const nd = (o) => ({ year: 2001, month: 3, value: null, status: 'no-data', estimated: false, flags: [], ...o });
  assert.match(noDataNote(nd({ flags: ['outside-domain'] })), /outside the data domain\. There is no data/);
  assert.match(noDataNote(nd({ flags: ['terra-only'] })), /Only MODIS Terra flew before July 2002/);
  assert.match(noDataNote(nd({ year: 2005 }), { manifest, ratios: { R: { value: null } } }), /R cannot scale it/);
  assert.match(noDataNote(nd({ year: 2005 }), { manifest, ratios: { R: { value: 2 } } }), /sensors were not operating/);
  assert.match(noDataNote(nd({ year: 1999 }), { manifest, ratios: { R: { value: null } } }), /sensors were not operating/);
});

test('caveats come from core: one item per flag on the cell, then the area caveats', () => {
  const area = caveatsFor({ series: { flags: [] }, R: { level: 'aoi' } });
  const ids = (c) => cellCaveats(c, area).map((x) => x.id);
  assert.deepEqual(ids(obs), ['unit-fire-cell-days', 'no-confidence-filter', 'detection-limits', 'archive-lag']);
  assert.deepEqual(ids({ ...obs, estimated: true, flags: ['low-confidence', 'partial-domain'] }).slice(0, 3), ['estimated', 'low-confidence', 'partial-domain']);
  assert.ok(detailModel(obs, { aoiCells: 1, caveats: area }).caveats.every((c) => c.short && c.long && c.preliminary === false));
});

test('anomaly layer adds percentile rank and flag; counts layer does not', () => {
  const ranked = { ...obs, rank: 0.95, flagged: true };
  const row = (m, label) => m.extra.find((r) => r.label === label)?.value;
  const m = detailModel(ranked, { aoiCells: 1000, layer: 'anomaly' });
  assert.equal(row(m, 'Percentile rank'), '95th percentile of its baseline, above median');
  assert.equal(row(m, 'Flagged'), 'Yes, unusual for this month');
  assert.equal(row(detailModel({ ...ranked, rank: null }, { aoiCells: 1000, layer: 'anomaly' }), 'Flagged'), NOT_AVAILABLE);
  assert.deepEqual(detailModel(ranked, { aoiCells: 1000 }).extra, []);
});

test('satellites in orbit come from the manifest and the month', () => {
  assert.deepEqual(satellitesInOrbit(manifest, '2001-05').map((s) => s.text), ['Terra since Nov 2000']);
  assert.deepEqual(satellitesInOrbit(manifest, '2026-11'), [], 'past the coverage nothing is listed');
  assert.deepEqual(satellitesInOrbit(manifest, '2024-09').map((s) => [s.label, s.text]), [['MODIS', 'Terra since Nov 2000, Aqua since Jul 2002'], ['VIIRS', 'S-NPP since Jan 2012, NOAA-20 since Apr 2018']]);
  assert.deepEqual(satellitesInOrbit(manifest, '1999-01'), []);
  assert.deepEqual(satellitesInOrbit(null, '2024-09'), []);
});

test('bar strip: one bar per year, selected marked, median line inside the frame, no bar for null', () => {
  const list = [sept(2001, 10), sept(2002, null), sept(2003, 40), sept(2004, 20)];
  const s = barStripModel(list, list[2], 15);
  assert.equal(s.bars.length, 4);
  assert.equal(s.bars[1].h, 0);
  assert.equal(s.bars[2].selected, true);
  assert.equal(s.bars[2].y, 18, 'the tallest bar reaches the top margin');
  assert.ok(s.median.y > 18 && s.median.y < s.height);
  assert.deepEqual(s.ticks.map((t) => t.year), [2001, 2004]);
  assert.equal(barStripModel(list, list[0], undefined).median, null);
});

test('scrollForSheet moves a covered cell above the sheet and leaves a clear one', () => {
  assert.equal(scrollForSheet({ cellTop: 700, cellBottom: 730, sheetTop: 500 }), 246);
  assert.equal(scrollForSheet({ cellTop: 300, cellBottom: 330, sheetTop: 500 }), 0);
  assert.equal(scrollForSheet({ cellTop: 20, cellBottom: 600, sheetTop: 500 }), 4);
});

test('median lead names how many earlier years and which', () => {
  assert.equal(medianLead('October', { count: 23, from: 2001, to: 2024 }), 'vs the median of the 23 earlier Octobers (2001–2024)');
  assert.equal(medianLead('October', { count: 1, from: 2010, to: 2010 }), 'vs the only earlier October (2010)');
  assert.equal(medianLead('October', null), 'vs the median of earlier Octobers');
});

test('regression: the selected bar value never touches the dashed median line', () => {
  const clear = (y, line) => (y <= line ? line - (y + 2) : y - 8 - line);
  for (const [barY, lineY] of [[60, 58], [58, 60], [40, 90], [90, 40], [30, 20], [20, 12], [12, 20]]) {
    const y = valueLabelY(barY, lineY);
    assert.ok(clear(y, lineY) >= 6, `bar ${barY}, line ${lineY}: label at ${y}`);
    assert.ok(y - 8 >= 0, 'label stays inside the frame');
  }
  assert.equal(valueLabelY(90, 40), 32, '0.375rem above a line that sits above the bar');
  assert.equal(valueLabelY(30, 90), 26, '0.25rem above a bar that rises above the line');
  assert.equal(valueLabelY(30, null), 26);
});

test('the panel eyebrow names synthetic data, since the sheet covers the top bar on phone', () => {
  assert.equal(panelEyebrow({ dataVersion: 'synthetic-20261114' }), 'Selected month · Synthetic data');
  assert.equal(panelEyebrow({ dataVersion: 'fixture-1' }), 'Selected month');
  assert.equal(panelEyebrow(null), 'Selected month');
  const cell = { year: 2005, month: 9, value: 12, status: 'observed', estimated: false };
  assert.equal(detailModel(cell, { aoiCells: 10, manifest: { dataVersion: 'synthetic-1' } }).eyebrow, 'Selected month · Synthetic data');
  assert.equal(detailModel({ ...cell, value: null }, { aoiCells: 10, manifest: { dataVersion: 'synthetic-1' } }).eyebrow, 'Selected month · Synthetic data');
});

test('regression: with the median near the top and the bar just under it, the value moves beside the bar', () => {
  const bar = { x: 100, w: 10, y: 18 };
  const at = valueLabel(bar, 14, 360);
  assert.equal(at.anchor, 'start', 'left half: to the right of the bar');
  assert.ok(at.x >= bar.x + bar.w, 'clear of the bar');
  assert.ok(at.y - 8 >= 14 + 6, '0.375rem under the line');
  const far = valueLabel({ ...bar, x: 300 }, 14, 360);
  assert.equal(far.anchor, 'end');
  assert.ok(far.x <= 300);
  assert.deepEqual(valueLabel({ x: 100, w: 10, y: 90 }, 40, 360), { x: 105, y: 32, anchor: 'middle' }, 'room above: centered');
  const gap = valueLabel({ x: 100, w: 10, y: 80 }, 12, 360);
  assert.equal(gap.anchor, 'middle', 'fits between the line and a lower bar');
  assert.ok(gap.y + 2 + 4 <= 80);
});

test('regression: the median label sits on the side away from the selected value', () => {
  const list = [2001, 2002, 2003, 2004, 2005, 2006].map((year, i) => ({ year, value: [900, 100, 120, 110, 130, 95][i] }));
  const early = barStripModel(list, { year: 2001 }, 115);
  assert.equal(early.median.anchor, 'end', 'value on the left, median label on the right');
  assert.equal(early.median.labelX, 358);
  const late = barStripModel(list, { year: 2006 }, 115);
  assert.equal(late.median.anchor, 'start');
  assert.equal(late.median.labelX, 2);
});

test('bar strip carries each year\'s rank so the anomaly panel can color it', () => {
  const list = [{ year: 2023, month: 1, value: 3, rank: 0.2 }, { year: 2024, month: 1, value: 5 }];
  const s = barStripModel(list, list[1], null);
  assert.deepEqual(s.bars.map((b) => b.rank), [0.2, null]);
  assert.equal(detailModel(list[1], { aoiCells: 100, layer: 'anomaly', cells: list }).layer, 'anomaly');
});
