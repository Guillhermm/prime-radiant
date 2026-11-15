import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, cellId, tileOf, cellCenter, parseTileId, tileId, cellsPerSide } from './grid.js';

test('interior point: tile and cell', () => {
  const p = locate(-9.95, 40.05);
  assert.deepEqual([p.tile, p.row, p.col, p.cell], ['x17y13', 0, 0, 0]);
  assert.equal(cellId(-0.05, 49.95), 9999);
});

test('cell edge belongs to the cell east/north', () => {
  assert.equal(cellId(0.1, 0.1), locate(0.15, 0.15).cell);
  const a = locate(-9.9, 40.0); // lon edge between col 0 and 1; lat on tile south edge
  assert.deepEqual([a.col, a.row, a.tile], [1, 0, 'x17y13']);
  const b = locate(0, 0); // tile corner: east/north tile
  assert.deepEqual([b.tile, b.cell], ['x18y9', 0]);
});

test('float noise does not move a point across an edge', () => {
  assert.equal(locate(0.1 + 0.2, 0).col, locate(0.3, 0).col); // 0.30000000000000004 vs 0.3
  assert.equal(locate(-179.9 , 0).col, 1);
  assert.equal(locate(0.06, 0.06).col, 0); // inside cell 0, not rounded up
});

test('antimeridian: lon 180 maps to -180', () => {
  assert.deepEqual(locate(180, 65), locate(-180, 65));
  assert.equal(tileOf(180, 65), 'x0y15');
  assert.equal(tileOf(179.99, 65), 'x35y15');
});

test('poles: lat 90 clamps into the top row, lat -90 is row 0', () => {
  const n = locate(10, 90);
  assert.deepEqual([n.ty, n.row], [17, 99]);
  const s = locate(10, -90);
  assert.deepEqual([s.ty, s.row], [0, 0]);
  assert.equal(locate(10, 90, 1).row, 9);
});

test('coarse resolution', () => {
  const p = locate(-5.5, 45.5, 1);
  assert.deepEqual([p.tile, p.row, p.col, p.cell], ['x17y13', 5, 4, 54]);
  assert.equal(cellsPerSide(1), 10);
  assert.equal(cellsPerSide(), 100);
});

test('cell centers round-trip', () => {
  assert.deepEqual(cellCenter('x17y13', 0), { lon: -9.95, lat: 40.05 });
  assert.deepEqual(cellCenter('x17y13', 5049), { lon: -5.05, lat: 45.05 });
  assert.deepEqual(cellCenter('x17y13', 54, 1), { lon: -5.5, lat: 45.5 });
  assert.deepEqual(cellCenter('x0y0', 0), { lon: -179.95, lat: -89.95 });
  const c = cellCenter('x35y17', 9999);
  assert.deepEqual(c, { lon: 179.95, lat: 89.95 });
  const p = locate(c.lon, c.lat);
  assert.deepEqual([p.tile, p.cell], ['x35y17', 9999]);
});

test('tile ids', () => {
  assert.equal(tileId(3, 4), 'x3y4');
  assert.deepEqual(parseTileId('x35y17'), { tx: 35, ty: 17 });
  assert.throws(() => parseTileId('x36y0'), RangeError);
  assert.throws(() => parseTileId('tile'), RangeError);
  assert.throws(() => parseTileId('x01y2'), RangeError); // one canonical spelling per tile
});

test('invalid input throws RangeError', () => {
  assert.throws(() => locate(180.1, 0), RangeError);
  assert.throws(() => locate(0, -90.1), RangeError);
  assert.throws(() => locate(NaN, 0), RangeError);
  assert.throws(() => locate(0, 0, 0.5), RangeError);
  assert.throws(() => cellCenter('x0y0', 10000), RangeError);
});
