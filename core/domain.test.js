import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polygonsOf, bboxOfPolygons, pointInPolygons, rasterize, createClipper, createDomain } from './domain.js';
import { validateDomain } from './schema.js';

// Square lon 10..11, lat 20..21 with a hole lon 10.3..10.6, lat 20.3..20.6, off the 0.1 grid lines by 0.05.
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const holed = { type: 'Polygon', coordinates: [sq(10.05, 20.05, 10.95, 20.95), sq(10.35, 20.35, 10.65, 20.65)] };
const polys = polygonsOf(holed);

test('polygonsOf reads Polygon, MultiPolygon, Feature and FeatureCollection; bbox', () => {
  const multi = { type: 'MultiPolygon', coordinates: [[sq(0, 0, 1, 1)], [sq(5, 5, 6, 7)]] };
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: multi }] };
  assert.equal(polygonsOf(fc).length, 2);
  assert.deepEqual(bboxOfPolygons(polygonsOf(multi)), [0, 0, 6, 7]);
  assert.throws(() => polygonsOf({ type: 'Point', coordinates: [0, 0] }), TypeError);
});

test('point in polygon: inside, outside, hole, second polygon of a multipolygon', () => {
  assert.equal(pointInPolygons(polys, 10.2, 20.2), true);
  assert.equal(pointInPolygons(polys, 10.5, 20.5), false); // in the hole
  assert.equal(pointInPolygons(polys, 11.5, 20.5), false);
  assert.equal(pointInPolygons(polys, 10.5, 19.9), false);
  const two = polygonsOf({ type: 'MultiPolygon', coordinates: [[sq(0, 0, 1, 1)], [sq(5, 5, 6, 7)]] });
  assert.equal(pointInPolygons(two, 5.5, 6.5), true);
  assert.equal(pointInPolygons(two, 3, 3), false);
});

test('rasterize: a cell is in when it intersects the polygon; hole cells are out', () => {
  const { rows } = rasterize(polys);
  // lat 20.05..20.95 touches rows 1100..1109 (lat 20.0..21.0); lon 10.05..10.95 touches cols 1900..1909
  assert.deepEqual(Object.keys(rows).map(Number), [1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109]);
  assert.deepEqual(rows[1100], [[1900, 1909]]);
  assert.deepEqual(rows[1103], [[1900, 1909]]); // hole's south edge (lat 20.35) runs through these cells
  assert.deepEqual(rows[1104], [[1900, 1903], [1906, 1909]]); // cols 1904..1905 are wholly in the hole
});

test('rasterize: wholly-hole cells are out, hole-edge cells are in', () => {
  const { rows } = rasterize(polys);
  const d = createDomain({ rows });
  assert.equal(d.has(10.45, 20.45), false); // cell 1904, row 1104: wholly inside the hole
  assert.equal(d.has(10.35, 20.45), true); // hole edge at 10.35 crosses cell 1903
  assert.equal(d.has(10.2, 20.2), true);
  assert.equal(d.has(12, 20.5), false);
});

test('mask round trip: validates, survives JSON, counts match the runs', () => {
  const m = rasterize(polys);
  assert.deepEqual(validateDomain(m), []);
  const back = JSON.parse(JSON.stringify(m));
  assert.deepEqual(back, m);
  const total = Object.values(m.rows).flat().reduce((a, [x, y]) => a + y - x + 1, 0);
  assert.equal(createDomain(back).count(0, 3599, 0, 1799), total);
  assert.equal(createDomain(back).count(1900, 1909, 1100, 1109), total);
  assert.equal(createDomain(back).count(1905, 1905, 1100, 1100), 1);
});

test('coarse level: a 1 deg cell is in when any fine cell is', () => {
  const d = createDomain(rasterize(polygonsOf({ type: 'Polygon', coordinates: [sq(10.85, 20.85, 11.15, 21.15)] })));
  assert.equal(d.has(10.95, 20.95, 1), true); // coarse cell lon 10..11, lat 20..21
  assert.equal(d.has(11.5, 21.5, 1), true); // coarse cell lon 11..12, lat 21..22
  assert.equal(d.has(12.5, 21.5, 1), false);
  assert.equal(d.count(190, 191, 110, 111, 1), 4);
});

test('clipper: border cell same-side rule', () => {
  // Diagonal edge through cell lon 10.0..10.1, lat 20.0..20.1: triangle (10,20)-(10.1,20)-(10,20.1) halves it.
  const tri = polygonsOf({ type: 'Polygon', coordinates: [[[10.0, 20.0], [10.1, 20.0], [10.0, 20.1], [10.0, 20.0]]] });
  const c = createClipper(tri);
  const d = createDomain(c.domain);
  assert.equal(d.has(10.02, 20.02), true);
  assert.equal(d.has(10.08, 20.08), true); // outside the polygon but in an in-domain cell: cell stays in
  assert.equal(c.contains(10.02, 20.02), true); // same cell, inside side kept
  assert.equal(c.contains(10.08, 20.08), false); // same cell, outside side clipped
  assert.equal(c.contains(10.5, 20.5), false); // cell not in the domain
  const sqc = createClipper(polys);
  assert.equal(sqc.contains(10.2, 20.2), true); // interior cell, no point test needed
  assert.equal(sqc.contains(10.5, 20.5), false); // inside the hole
});

test('validateDomain names its errors', () => {
  const codes = (d) => validateDomain(d).map((x) => x.code);
  assert.deepEqual(codes({ rows: { 5: [[3, 4], [6, 7]] } }), []);
  assert.deepEqual(codes({ rows: { 5: [[3, 4], [5, 7]] } }), ['RUNS_NOT_CANONICAL']);
  assert.deepEqual(codes({ rows: { 5: [[4, 3]] } }), ['BAD_RUNS']);
  assert.deepEqual(codes({ rows: { 1800: [[0, 1]] } }), ['BAD_ROW']);
  assert.deepEqual(codes({ rows: { 5: [] } }), ['BAD_RUNS']);
  assert.deepEqual(codes([]), ['NOT_OBJECT']);
});

test('rasterize: an unclosed ring gives the same cells as the closed one', () => {
  const closed = [[[[0, 0], [0.35, 0], [0.35, 0.25], [0, 0.25], [0, 0]]]];
  const open = [[[[0, 0], [0.35, 0], [0.35, 0.25], [0, 0.25]]]];
  assert.deepEqual(rasterize(open), rasterize(closed));
});
