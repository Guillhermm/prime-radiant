import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT, RADIANT, monthAngles, radiantLabel, radiantModel, ringRadii, sectorPath, selectionShape } from './radiant.js';

const cells = [];
for (let y = 2001; y <= 2003; y++) for (let m = 1; m <= 12; m++) cells.push({ year: y, month: m, value: m === 2 && y === 2002 ? null : m * 10 });

test('January starts at 12 o clock and the twelve slices tile the circle clockwise', () => {
  const [a0] = monthAngles(1, 0);
  assert.equal(a0, -Math.PI / 2);
  const [, a1] = monthAngles(12, 0);
  assert.ok(Math.abs(a1 - (Math.PI * 3) / 2) < 1e-9);
  const [g0, g1] = monthAngles(4);
  assert.ok(Math.abs(g1 - g0 - (Math.PI / 6 - RADIANT.gap)) < 1e-9, 'each side gives up half the gap');
  const [, end3] = monthAngles(3);
  assert.ok(Math.abs(g0 - end3 - RADIANT.gap) < 1e-9, 'one gap per month boundary, not two');
});

test('rings split the band from inner to outer radius evenly, oldest inside', () => {
  const [ri0, ro0] = ringRadii(0, 3);
  const [ri2, ro2] = ringRadii(2, 3);
  assert.equal(ri0, RADIANT.inner + RADIANT.hairline);
  assert.equal(ro2, RADIANT.outer - RADIANT.hairline);
  assert.ok(Math.abs((ro0 - ri0) - (ro2 - ri2)) < 1e-9);
});

test('a sector path is a closed shape with two arcs', () => {
  const d = sectorPath(10, 20, 0, Math.PI / 2);
  assert.match(d, /^M20 0A20 20 0 0 1 0 20L0 10A10 10 0 0 0 10 0Z$/);
});

test('model: one slice per month with data, null months draw nothing, classes from the density bins', () => {
  const m = radiantModel(cells, { aoiCells: 1000 });
  assert.deepEqual(m.years, [2001, 2002, 2003]);
  assert.equal(m.slices.length, 35);
  assert.ok(!m.slices.some((s) => s.year === 2002 && s.month === 2));
  const jan01 = m.slices.find((s) => s.year === 2001 && s.month === 1);
  assert.equal(jan01.ring, 0);
  assert.equal(jan01.bin, 2, '10 fire-cell-days in 1,000 cells is a density of 10: class 4-15');
  assert.equal(m.labels.length, 12);
  assert.equal(m.labels[0].text, 'J');
  assert.ok(m.labels[0].x > 0 && m.labels[0].y < 0, 'January label sits just right of 12 o clock');
  assert.equal(radiantModel(cells, { aoiCells: 1000, labels: false }).labels.length, 0);
});

test('selection outlines the cell and its month spoke; a year outside the rings gives null', () => {
  const s = selectionShape([2001, 2002, 2003], { year: 2002, month: 9 });
  assert.match(s.cell, /^M.*Z$/);
  assert.match(s.spoke, /^M.*Z$/);
  assert.equal(selectionShape([2001], { year: 1999, month: 1 }), null);
});

test('accessible label names the first and last ring', () => {
  assert.match(radiantLabel([2001, 2026]), /from 2001 inside to 2026 on the rim/);
  assert.match(radiantLabel([]), /no data/);
});

test('compact Radiant drops ring hairlines and narrows the spoke gap', () => {
  const pathOf = (o) => radiantModel(cells, { aoiCells: 1000, ...o }).slices.find((x) => x.year === 2001 && x.month === 1).d;
  const [ri, ro] = ringRadii(0, 3, { ...RADIANT, hairline: COMPACT.hairline });
  const [a0, a1] = monthAngles(1, COMPACT.gap);
  assert.equal(pathOf({ compact: true }), sectorPath(ri, ro, a0, a1));
  assert.notEqual(pathOf({ compact: true }), pathOf({}));
  assert.equal(ri, RADIANT.inner, 'no hairline at the inner edge');
});

test('zero is drawn as the empty class, null is not drawn at all', () => {
  const m = radiantModel([{ year: 2001, month: 1, value: 0 }, { year: 2001, month: 2, value: null }], { aoiCells: 1000 });
  assert.equal(m.slices.length, 1);
  assert.equal(m.slices[0].month, 1);
  assert.equal(m.slices[0].bin, 0);
});

test('classOf recolors slices (the anomaly ramp on the Anomalies tab); the default is the density class', () => {
  const two = [{ year: 2024, month: 1, value: 5, rank: 0.95 }, { year: 2024, month: 2, value: 0, rank: 0.1 }];
  assert.ok(radiantModel(two, { aoiCells: 100 }).slices.every((s) => s.cls.startsWith('rb rb-')));
  const m = radiantModel(two, { aoiCells: 100, classOf: (c) => `rd-${Math.floor(c.rank * 10)}` });
  assert.deepEqual(m.slices.map((s) => s.cls), ['rd-9', 'rd-1']);
});
