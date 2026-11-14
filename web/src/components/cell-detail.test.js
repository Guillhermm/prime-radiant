import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE, NO_MEDIAN, barStripModel, detailModel, medianLead, provenanceText, satellitesInOrbit, scrollForSheet, valueLabelY } from './cell-detail.js';

const obs = { year: 2012, month: 9, value: 1204, status: 'observed', estimated: false };
const sept = (year, value, o = {}) => ({ year, month: 9, value, status: 'harmonized', estimated: true, ...o });
const manifest = {
  coverage: { modis: ['2000-11', '2026-10'], viirs: ['2012-01', '2026-10'] },
  satellites: { modis: [{ name: 'Terra', from: '2000-11' }, { name: 'Aqua', from: '2002-07' }], viirs: [{ name: 'S-NPP', from: '2012-01' }, { name: 'NOAA-20', from: '2018-04' }] },
};

test('observed cell: value, density, provenance, no median says so instead of a number', () => {
  const m = detailModel(obs, { aoiCells: 1000 });
  assert.equal(m.title, 'September 2012');
  assert.equal(m.value, '1,204');
  assert.equal(m.density, '1,204 per 1,000 cells');
  assert.equal(m.provenance, 'VIIRS, observed');
  assert.equal(m.compare, null);
  assert.equal(m.noMedian, NO_MEDIAN);
  assert.equal(m.estimation, null);
});

test('comparison uses core median and names the years behind it', () => {
  const all = [sept(2010, 1000), sept(2011, 3000), sept(2012, 12122, { median: 2000 })];
  const m = detailModel(all[2], { aoiCells: 1000, cells: all, allCells: all });
  assert.equal(m.compare.text, '6.1×');
  assert.equal(m.compare.lead, 'vs the median of the 2 earlier Septembers (2010–2011)');
  assert.equal(m.compare.median, '2,000');
  assert.equal(m.compare.dir, 'above');
  assert.equal(m.rank, 'Busiest of 3 Septembers. Next: 2011 with 3,000.');
  assert.equal(m.stripTitle, 'Every September, 2010–2012');
  assert.match(m.stripLabel, /2012: 12,122\. Median of earlier years 2,000\. Busiest of 3 Septembers\./);
});

test('estimated cell without R says the factor is not available; with R it shows it', () => {
  assert.match(detailModel(sept(2005, 10), { aoiCells: 10 }).estimation, /not available yet/);
  assert.match(detailModel(sept(2005, 10, { r: 0.8 }), { aoiCells: 10 }).estimation, /R = 0\.8/);
  assert.equal(provenanceText(sept(2005, 10)), 'Harmonized, estimated');
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

test('caveats follow the cell', () => {
  const ids = (c) => detailModel(c, { aoiCells: 1 }).caveats.map((x) => x.id);
  assert.deepEqual(ids(obs), ['C1', 'C8']);
  assert.deepEqual(ids({ ...obs, estimated: true }), ['C1', 'C2', 'C3', 'C8']);
  assert.ok(ids({ ...obs, year: 2021 }).includes('C4'));
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
