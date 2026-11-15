import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODATA } from '../bins.js';
import { calendarTableModel, cellLabel, cellModel, estimatedRuns, gridModel, initialPosition, keyIntent, medianRowModel, nextPosition, shortCount } from './calendar-grid.js';

const c = (year, month, value, o = {}) => ({ year, month, value, status: value === null ? 'no-data' : 'observed', estimated: false, ...o });

test('cellLabel carries month, full value, density, status', () => {
  assert.equal(cellLabel(c(2020, 9, 12450), 327000), 'September 2020, 12,450 fire-cell-days, density 38 per 1,000 cells, observed');
});

test('cellLabel names estimated values for their source (V1 fix F4), partial months and low confidence; no data is not a number', () => {
  assert.equal(cellLabel(c(2012, 10, 10, { status: 'partial', estimated: true }), 10000), 'October 2012, 10 fire-cell-days, density 1 per 1,000 cells, partial month, sensor outage, estimated');
  assert.equal(cellLabel(c(2005, 9, 25.4, { status: 'harmonized', estimated: true, source: { id: 'modis' }, flags: ['low-confidence'] }), 10000),
    'September 2005, 25 fire-cell-days, density 2.5 per 1,000 cells, estimated, scaled to VIIRS-equivalent (MODIS × R), low confidence');
  assert.match(cellLabel(c(2027, 1, 9, { status: 'harmonized', estimated: true, source: { id: 'noaa20' } }), 10000), /scaled to VIIRS-equivalent \(NOAA-20 × K\)$/);
  assert.equal(cellModel(c(2005, 9, 25.4), 10000).text, '25', 'estimated fractions show as whole counts');
  assert.equal(cellLabel(c(1999, 1, null), 10000), 'January 1999, no data');
  assert.match(cellLabel(c(2012, 1, 0), 10000), /0 fire-cell-days, density 0 per 1,000 cells/);
});

test('cellModel bin, abbreviated text and marks', () => {
  const m = cellModel(c(2020, 9, 12450, { estimated: true, status: 'partial' }), 10000);
  assert.equal(m.bin, 6);
  assert.equal(m.text, '12k');
  assert.ok(m.estimated && m.partial);
  const z = cellModel(c(2020, 9, 0), 10000);
  assert.equal(z.bin, 0);
  assert.equal(z.text, '0');
  const n = cellModel(c(2020, 9, null), 10000);
  assert.equal(n.bin, NODATA);
  assert.equal(n.text, '');
});

// 2012: Nov, Dec only; 2011: all months
const cells = [];
for (let m = 1; m <= 12; m++) cells.push(c(2011, m, m));
cells.push(c(2012, 11, 5), c(2012, 12, 6));
const model = gridModel(cells, { aoiCells: 1000 });

test('gridModel puts the newest year first with null outside the range', () => {
  assert.deepEqual(model.rows.map((r) => r.year), [2012, 2011]);
  assert.equal(model.rows[0].cells[0], null);
  assert.equal(model.rows[0].cells[10].month, 11);
  assert.equal(model.rows[1].cells.every(Boolean), true);
});

test('initialPosition is the earliest month of the newest year', () => {
  assert.deepEqual(initialPosition(model), { row: 0, col: 10 });
  assert.equal(initialPosition({ rows: [] }), null);
});

test('arrows move and clamp, skipping empty slots', () => {
  assert.deepEqual(nextPosition(model, { row: 0, col: 10 }, 'ArrowRight'), { row: 0, col: 11 });
  const stay = { row: 0, col: 10 };
  assert.equal(nextPosition(model, stay, 'ArrowLeft'), stay);
  assert.deepEqual(nextPosition(model, { row: 0, col: 10 }, 'ArrowDown'), { row: 1, col: 10 });
  assert.deepEqual(nextPosition(model, { row: 1, col: 10 }, 'ArrowUp'), { row: 0, col: 10 });
  const top = { row: 0, col: 10 };
  assert.equal(nextPosition(model, top, 'ArrowUp'), top);
});

test('up from a month the newer year lacks skips to the next year that has it', () => {
  const m = gridModel([c(2010, 3, 1), c(2011, 5, 1), c(2012, 3, 1)], { aoiCells: 10 });
  assert.deepEqual(nextPosition(m, { row: 2, col: 2 }, 'ArrowUp'), { row: 0, col: 2 });
});

test('PageUp and PageDown move one year; Home and End go to row ends', () => {
  assert.deepEqual(nextPosition(model, { row: 1, col: 11 }, 'PageUp'), { row: 0, col: 11 });
  assert.deepEqual(nextPosition(model, { row: 0, col: 11 }, 'Home'), { row: 0, col: 10 });
  assert.deepEqual(nextPosition(model, { row: 1, col: 4 }, 'Home'), { row: 1, col: 0 });
  assert.deepEqual(nextPosition(model, { row: 1, col: 4 }, 'End'), { row: 1, col: 11 });
  assert.deepEqual(nextPosition(model, { row: 1, col: 4 }, 'Home', { ctrl: true }), { row: 0, col: 10 });
  assert.deepEqual(nextPosition(model, { row: 0, col: 10 }, 'End', { ctrl: true }), { row: 1, col: 11 });
  const p = { row: 0, col: 10 };
  assert.equal(nextPosition(model, p, 'x'), p);
});

test('calendarTableModel: years as rows, months as columns, null and partial marked', () => {
  const t = calendarTableModel([c(2011, 12, null), c(2012, 1, 1234, { estimated: true }), c(2012, 2, 5, { status: 'partial' })]);
  assert.equal(t.columns.length, 12);
  assert.deepEqual(t.rows.map((r) => r.header), ['2012', '2011']);
  assert.equal(t.rows[0].cells[0], '1,234*');
  assert.equal(t.rows[0].cells[1], '5†');
  assert.equal(t.rows[0].cells[2], '');
  assert.equal(t.rows[1].cells[11], 'No data');
  assert.equal(t.notes.length, 2);
});

test('mostlyEstimated flags a range once 60% of the cells with data are estimated', async () => {
  const { mostlyEstimated } = await import('./calendar-grid.js');
  const c = (estimated, value = 1) => ({ value, estimated });
  assert.equal(mostlyEstimated([]), false);
  assert.equal(mostlyEstimated([c(true), c(true), c(true), c(false), c(false)]), true);
  assert.equal(mostlyEstimated([c(true), c(true), c(false), c(false), c(false)]), false);
  assert.equal(mostlyEstimated([c(true), c(false, null), c(false, null)]), true);
});

test('phone cells show at most three characters', () => {
  assert.deepEqual([0, 999, 1000, 3117, 12122, 999499, 999500, 1234567].map(shortCount), ['0', '999', '1k', '3k', '12k', '999k', '1M', '1M']);
  assert.ok([0, 999, 3117, 12122, 999499, 1234567].every((n) => shortCount(n).length <= 4 && shortCount(n).replace('k', '').replace('M', '').length <= 3));
  assert.equal(cellModel(c(2020, 9, 12450), 10000).short, '12k');
});

test('keys: Enter and Space open, Escape closes, arrows move and carry the selection when one is open', () => {
  assert.equal(keyIntent('Enter'), 'open');
  assert.equal(keyIntent(' '), 'open');
  assert.equal(keyIntent('Escape', { selected: true }), 'close');
  assert.equal(keyIntent('ArrowRight'), 'move');
  assert.equal(keyIntent('ArrowDown', { selected: true }), 'move-select');
  assert.equal(keyIntent('PageUp', { selected: true }), 'move-select');
  assert.equal(keyIntent('a', { selected: true }), null);
});

test('median row: one cell per month from the typical year, null median is not zero', () => {
  const typical = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, median: i === 1 ? null : (i + 1) * 100, from: 2001, to: 2025 }));
  const row = medianRowModel(typical, 1000);
  assert.equal(row.length, 12);
  assert.equal(row[0].bin, 4, 'median 100 in 1,000 cells is a density of 100: class 64-255');
  assert.equal(row[1].bin, NODATA);
  assert.match(row[1].label, /not enough history/);
  assert.match(row[8].label, /September median 900 fire-cell-days over 2001–2025, preview/);
  assert.deepEqual(medianRowModel(null, 1000), []);
});

test('a Terra-only month (core flag) gets its own state, label and table text; a real gap stays No data', () => {
  const terra = c(2001, 5, null, { flags: ['terra-only'] });
  assert.equal(cellLabel(terra, 100), 'May 2001, not harmonized: Terra only, before Aqua (Jul 2002)');
  assert.equal(cellModel(terra, 100).terraOnly, true);
  assert.equal(cellModel(c(2001, 6, null), 100).terraOnly, false, 'no flag: a sensor gap, not Terra only');
  assert.equal(cellLabel(c(2001, 6, null), 100), 'June 2001, no data');
  const t = calendarTableModel([terra, c(2001, 6, null), c(2002, 7, 5)]);
  assert.deepEqual(t.rows.at(-1).cells.slice(4, 6), ['Terra only', 'No data']);
  assert.ok(t.notes.some((n) => /^Terra only: not harmonized/.test(n)));
});

test('the estimated bracket covers each run of adjacent rows with an estimated month, newest row first', () => {
  const est = (year) => c(year, 9, 5, { estimated: true, status: 'harmonized' });
  const cells = [...[2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010].map(est), c(2011, 9, 5), est(2013)];
  const runs = estimatedRuns(gridModel(cells, { aoiCells: 100 }));
  assert.deepEqual(runs, [{ from: 0, to: 0, label: 'Est.' }, { from: 2, to: 9, label: 'Estimated (MODIS × R)' }]);
  assert.deepEqual(estimatedRuns(gridModel([c(2020, 1, 3)], { aoiCells: 100 })), []);
});
