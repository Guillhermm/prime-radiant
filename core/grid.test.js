import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, cellCenter, normalizeLon, clampLat, parseTileId, cellId } from './grid.js';

test('a point inside a cell', () => {
  assert.deepEqual(locate(-55.05, -15.05), { tileId: '0.1/x12y7', tx: 12, ty: 7, row: 49, col: 49, cell: 4949 });
});

test('a point on a cell edge goes east and north', () => {
  const l = locate(-55.0, -15.0);
  assert.equal(l.col, 50);
  assert.equal(l.row, 50);
  assert.equal(locate(0.3, 0.3).cell, cellId(3, 3));
});

test('a point on a tile edge goes to the east and north tile', () => {
  const l = locate(-50, -10);
  assert.equal(l.tileId, '0.1/x13y8');
  assert.equal(l.cell, 0);
});

test('lon 180 maps to -180', () => {
  assert.equal(normalizeLon(180), -180);
  assert.equal(normalizeLon(-180), -180);
  assert.equal(normalizeLon(190), -170);
  assert.equal(locate(180, 45).tileId, '0.1/x0y13');
  assert.equal(locate(180, 45).col, 0);
  assert.equal(locate(180, 45).cell, locate(-179.95, 45.05).cell);
});

test('poles clamp into the outermost row', () => {
  assert.equal(clampLat(95), 90);
  assert.equal(clampLat(-95), -90);
  const north = locate(0, 90);
  assert.equal(north.ty, 17);
  assert.equal(north.row, 99);
  const south = locate(0, -90);
  assert.equal(south.ty, 0);
  assert.equal(south.row, 0);
  assert.equal(locate(0, 120).cell, north.cell);
});

test('lon just below 180 stays in the last column', () => {
  const l = locate(179.99, 0);
  assert.equal(l.tx, 35);
  assert.equal(l.col, 99);
});

test('coarse resolution uses 10 x 10 cells per tile', () => {
  assert.deepEqual(locate(-55.05, -15.05, 1), { tileId: '1/x12y7', tx: 12, ty: 7, row: 4, col: 4, cell: 404 });
});

test('cellCenter inverts locate', () => {
  assert.deepEqual(cellCenter('0.1/x12y7', 4949), { lon: -55.05, lat: -15.05 });
  assert.deepEqual(cellCenter('1/x12y7', 404), { lon: -55.5, lat: -15.5 });
  assert.deepEqual(cellCenter('0.1/x0y13', 5000), { lon: -179.95, lat: 45.05 });
});

test('float noise does not move a point across an edge', () => {
  assert.equal(locate(-179.9, 0).col, 1);
  assert.equal(locate(0.3, 0).col, 3);
});

test('bad input throws', () => {
  assert.throws(() => locate(NaN, 0), RangeError);
  assert.throws(() => locate(0, Infinity), RangeError);
  assert.throws(() => parseTileId('x1y2'), RangeError);
  assert.deepEqual(parseTileId('1/x3y4'), { res: 1, tx: 3, ty: 4 });
});
