import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_AVAILABLE, detailModel } from './cell-detail.js';

const row = (m, label) => m.rows.find((r) => r.label === label)?.value;
const obs = { year: 2012, month: 9, value: 1204, status: 'observed', estimated: false };

test('observed cell: value, density, status, source', () => {
  const m = detailModel(obs, { aoiCells: 1000 });
  assert.equal(m.title, 'September 2012');
  assert.equal(row(m, 'Value'), '1,204 fire-cell-days');
  assert.equal(row(m, 'Density'), '1,204 per 1,000 grid cells');
  assert.equal(row(m, 'Status'), 'Observed');
  assert.equal(row(m, 'Source'), 'Observed');
  assert.equal(row(m, 'R'), undefined);
});

test('missing median, years and R say "not available yet" instead of inventing', () => {
  const m = detailModel({ ...obs, estimated: true, status: 'harmonized' }, { aoiCells: 1000 });
  assert.equal(row(m, 'R'), NOT_AVAILABLE);
  assert.equal(row(m, 'Median'), NOT_AVAILABLE);
  assert.equal(row(m, 'Years used'), NOT_AVAILABLE);
});

test('median, years and R show when the cell carries them', () => {
  const m = detailModel({ ...obs, estimated: true, median: 3100, medianYears: 22, r: 0.8 }, { aoiCells: 1000 });
  assert.equal(row(m, 'Median'), '3,100');
  assert.equal(row(m, 'Years used'), '22');
  assert.equal(row(m, 'R'), '0.8');
});

test('zero is a value, not no data', () => {
  const m = detailModel({ ...obs, value: 0 }, { aoiCells: 1000 });
  assert.equal(row(m, 'Value'), '0 fire-cell-days');
});

test('no-data cell never reads as zero', () => {
  const m = detailModel({ year: 2000, month: 3, value: null, status: 'no-data', estimated: false }, { aoiCells: 1000 });
  assert.equal(row(m, 'Status'), 'No data');
  assert.equal(row(m, 'Value'), undefined);
  assert.match(row(m, 'Note'), /not zero/);
});

test('caveats follow the cell', () => {
  const ids = (c) => detailModel(c, { aoiCells: 1 }).caveats.map((x) => x.id);
  assert.deepEqual(ids(obs), ['C1', 'C8']);
  assert.deepEqual(ids({ ...obs, estimated: true }), ['C1', 'C2', 'C3', 'C8']);
  assert.ok(ids({ ...obs, year: 2021 }).includes('C4'));
});

test('anomaly layer adds percentile rank and flag; counts layer does not', () => {
  const ranked = { ...obs, rank: 0.95, flagged: true };
  const m = detailModel(ranked, { aoiCells: 1000, layer: 'anomaly' });
  assert.equal(row(m, 'Percentile rank'), '95th percentile of its baseline, above median');
  assert.equal(row(m, 'Flagged'), 'Yes, unusual for this month');
  assert.equal(row(detailModel({ ...ranked, flagged: false }, { aoiCells: 1000, layer: 'anomaly' }), 'Flagged'), 'No');
  assert.equal(row(detailModel(ranked, { aoiCells: 1000 }), 'Percentile rank'), undefined);
});

test('anomaly layer: a zero month keeps its rank, a missing rank is not invented', () => {
  const zero = detailModel({ ...obs, value: 0, rank: 0.05, flagged: false }, { aoiCells: 1000, layer: 'anomaly' });
  assert.equal(row(zero, 'Value'), '0 fire-cell-days');
  assert.match(row(zero, 'Percentile rank'), /^5th percentile.*below median$/);
  const short = detailModel({ ...obs, rank: null, flagged: false }, { aoiCells: 1000, layer: 'anomaly' });
  assert.equal(row(short, 'Percentile rank'), 'No percentile rank (baseline too short)');
  assert.equal(row(short, 'Flagged'), NOT_AVAILABLE);
  const off = detailModel({ ...obs, value: null, status: 'no-data', rank: null }, { aoiCells: 1000, layer: 'anomaly' });
  assert.equal(row(off, 'Percentile rank'), undefined);
});

test('scrollForSheet moves a covered cell above the sheet and leaves a clear one', async () => {
  const { scrollForSheet } = await import('./cell-detail.js');
  assert.equal(scrollForSheet({ cellTop: 700, cellBottom: 730, sheetTop: 500 }), 246);
  assert.equal(scrollForSheet({ cellTop: 300, cellBottom: 330, sheetTop: 500 }), 0);
  assert.equal(scrollForSheet({ cellTop: 20, cellBottom: 600, sheetTop: 500 }), 4);
});
