import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anomalyCellModel, anomalyGridModel, anomalyLabel, divClass, divRange, ordinal, withAnomaly } from './anomaly-layer.js';

const cell = (year, month, value, extra = {}) => ({ year, month, value, status: 'observed', estimated: false, ...extra });

test('divClass centers rank 0.5 on the middle class and clamps the ends', () => {
  assert.equal(divClass(0.5), 5);
  assert.equal(divClass(0), 0);
  assert.equal(divClass(1), 10);
  assert.equal(divClass(0.09), 0);
  assert.equal(divClass(0.91), 10);
  assert.equal(divClass(0.4545), 4);
  assert.equal(divClass(0.4546), 5);
});

test('divRange covers 0 to 100 without gaps', () => {
  assert.deepEqual(divRange(0), [0, 9]);
  assert.deepEqual(divRange(10), [91, 100]);
  for (let i = 0; i < 10; i++) assert.equal(divRange(i)[1], divRange(i + 1)[0]);
});

test('ordinal handles the teen and 1-2-3 cases', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 93, 100].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '93rd', '100th']);
});

test('label adds percentile rank, side of the median and the flag', () => {
  const l = anomalyLabel(cell(2024, 5, 1234, { rank: 0.93, flagged: true }), 1000);
  assert.match(l, /^May 2024, 1,234 fire-cell-days/);
  assert.match(l, /93rd percentile/);
  assert.match(l, /above median/);
  assert.match(l, /flagged$/);
  assert.match(anomalyLabel(cell(2024, 5, 3, { rank: 0.2, flagged: false }), 1000), /below median$/);
  assert.match(anomalyLabel(cell(2024, 5, 3, { rank: 0.5, flagged: false }), 1000), /near median$/);
});

test('no data and no rank are distinct from every rank class', () => {
  const nodata = anomalyCellModel({ cell: cell(2024, 1, null, { rank: null }), bin: 'nodata' }, 1000);
  assert.equal(nodata.cls, 'nodata');
  assert.equal(nodata.text, '');
  const norank = anomalyCellModel({ cell: cell(2024, 1, 5, { rank: null }), bin: 1 }, 1000);
  assert.equal(norank.cls, 'div-norank');
  assert.match(norank.label, /no percentile rank/);
  assert.equal(norank.flagged, false);
});

test('flag is independent of color class', () => {
  const lowFlag = anomalyCellModel({ cell: cell(2024, 1, 5, { rank: 0.5, flagged: true }) }, 1000);
  assert.equal(lowFlag.cls, 'div-5');
  assert.equal(lowFlag.flagged, true);
  assert.equal(anomalyCellModel({ cell: cell(2024, 1, 5, { rank: 0.99, flagged: false }) }, 1000).flagged, false);
});

test('a zero count with a rank keeps its rank class (zero is a value, not no data)', () => {
  const m = anomalyCellModel({ cell: cell(2024, 1, 0, { rank: 0.1, flagged: false }) }, 1000);
  assert.equal(m.cls, 'div-1');
  assert.equal(m.text, '10th');
  assert.equal(m.short, '10');
});

test('withAnomaly matches series values and flags by month and nulls outside it', () => {
  const series = { id: 'anomaly', start: '2024-02', values: [0.95, null], flags: [true, false] };
  const out = withAnomaly([cell(2024, 1, 1), cell(2024, 2, 1), cell(2024, 3, 1), cell(2024, 4, 1)], series);
  assert.deepEqual(out.map((c) => c.rank), [null, 0.95, null, null]);
  assert.deepEqual(out.map((c) => c.flagged), [false, true, false, false]);
  const plain = [cell(2024, 1, 1, { rank: 0.3 })];
  assert.equal(withAnomaly(plain, null), plain);
});

test('grid model newest year first, 12 slots, cells colored', () => {
  const m = anomalyGridModel([cell(2023, 12, 1, { rank: 0.2 }), cell(2024, 1, 1, { rank: 0.8, flagged: true })], { aoiCells: 100 });
  assert.deepEqual(m.rows.map((r) => r.year), [2024, 2023]);
  assert.equal(m.rows[0].cells.length, 12);
  assert.equal(m.rows[0].cells[0].cls, 'div-8');
  assert.equal(m.rows[1].cells[11].cls, 'div-2');
  assert.equal(m.rows[0].cells[5], null);
});

test('answer: newest ranked month, its side of the median, and the flagged months', async () => {
  const { anomalyAnswer } = await import('./anomaly-layer.js');
  const cells = [
    cell(2024, 9, 5, { rank: 0.95, flagged: true }),
    cell(2024, 10, 3, { rank: 0.48, flagged: false }),
    cell(2024, 11, null, { rank: null, flagged: false }),
  ];
  const a = anomalyAnswer(cells);
  assert.equal(a.headline, 'October 2024 · 48th percentile');
  assert.equal(a.sentence, 'Near the median for an October.');
  assert.equal(a.flaggedText, '1 month flagged in this range');
  assert.deepEqual(a.flagged.map((c) => c.month), [9]);
  assert.equal(anomalyAnswer([cell(2024, 9, 5, { rank: 0.95, flagged: true })]).sentence, 'Flagged as unusual for a September.');
  assert.equal(anomalyAnswer([cell(2024, 9, 5, { rank: null })]), null);
});

test('table: years newest first, percentile in words, no data and no rank kept apart', async () => {
  const { anomalyTableModel } = await import('./anomaly-layer.js');
  const t = anomalyTableModel([cell(2023, 1, 4, { rank: 0.92, flagged: true }), cell(2024, 1, null), cell(2024, 2, 0, { rank: null })], { synthetic: true });
  assert.deepEqual(t.rows.map((r) => r.header), ['2024', '2023']);
  assert.deepEqual(t.rows[0].cells.slice(0, 3), ['No data', 'No rank', '']);
  assert.equal(t.rows[1].cells[0], '92nd, flagged');
  assert.match(t.caption, /Synthetic data/);
  assert.match(t.caption, /earlier years/);
  assert.doesNotMatch(t.caption, /Preview/, 'gate V2 validated the ranks');
});

test('extremes: Low and High only for an exact 0 or 1, a record against earlier years in the table', async () => {
  const { anomalyTableModel } = await import('./anomaly-layer.js');
  assert.equal(anomalyCellModel({ cell: cell(2024, 10, 1, { rank: 0 }) }, 1000).text, 'Low');
  assert.equal(anomalyCellModel({ cell: cell(2024, 10, 9, { rank: 1 }) }, 1000).text, 'High');
  assert.equal(anomalyCellModel({ cell: cell(2024, 10, 9, { rank: 1 }) }, 1000).short, '100', 'the phone keeps digits');
  assert.equal(anomalyCellModel({ cell: cell(2024, 10, 9, { rank: 0.996 }) }, 1000).text, '100th');
  const t = anomalyTableModel([cell(2022, 10, 1, { rank: 0 }), cell(2023, 10, 5, { rank: 0.5 }), cell(2024, 10, 9, { rank: 1, flagged: true }), cell(2021, 10, null)]);
  assert.deepEqual(t.rows.map((r) => r.cells[9]), ['record high, flagged', '50th', 'record low', 'No data']);
});
