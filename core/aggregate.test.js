import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seriesForAoi, cellCount, MAX_FINE_CELLS, fallbackLevels, seriesForLevels } from './aggregate.js';
import { validateSeries } from './schema.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const fine = { x0y15: fx('tiles/0.1/x0y15.json'), x17y13: fx('tiles/0.1/x17y13.json') };
const coarse = { x17y13: fx('tiles/1/x17y13.json') };
const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
const domain = fx('domain.json'); // fixture domain: all of tile x17y13, lon -10..0, lat 40..50
const world = [-180, -90, 180, 90];
const tile = [-10, 40, 0, 50]; // whole-degree AOI = tile x17y13

test('fixture totals match fixtures/README.md', () => {
  const r = seriesForAoi(tile, fine, manifest);
  assert.equal(sum(r.modis.values), 35);
  assert.equal(sum(r.viirs.values), 35);
  assert.deepEqual(r.modis.values, [7, 7, 7, 0, 7, 7]);
  assert.deepEqual(r.viirs.values, [null, null, 15, 0, 10, 10]);
  assert.equal(r.res, 0.1);
});

test('viirs is null before its coverage start, 0 inside it with no rows', () => {
  const r = seriesForAoi([0, 0, 1, 1], fine, manifest);
  assert.deepEqual(r.viirs.values, [null, null, 0, 0, 0, 0]);
  assert.deepEqual(r.modis.values, [0, 0, 0, 0, 0, 0]);
});

test('coarse and fine agree for a whole-degree AOI', () => {
  const f = seriesForAoi(tile, { fine }, manifest);
  const c = seriesForAoi(tile, { fine, coarse }, manifest, { res: 1 });
  assert.equal(c.res, 1);
  assert.deepEqual(c.modis.values, f.modis.values);
  assert.deepEqual(c.viirs.values, f.viirs.values);
});

test('cellCount and the automatic switch at MAX_FINE_CELLS', () => {
  assert.equal(cellCount([-10, 40, 0, 50]), 10000);
  assert.equal(cellCount([-10, 40, -9.9, 40.1]), 1);
  assert.equal(cellCount([179, 60, -179, 70]), 2000);
  assert.equal(MAX_FINE_CELLS, 20000);
  // 10x20 deg = 20000 cells: not above the threshold, stays fine
  assert.equal(seriesForAoi([-10, 40, 10, 50], { fine, coarse }, manifest).res, 0.1);
  // 20 x 10.1 deg = 200 x 101 = 20200 cells: coarse
  const r = seriesForAoi([-10, 40, 10, 50.1], { fine, coarse }, manifest);
  assert.equal(r.res, 1);
  assert.equal(sum(r.modis.values), 35);
  // no coarse tiles supplied: stays fine
  assert.equal(seriesForAoi(world, { fine }, manifest).res, 0.1);
});

test('antimeridian bbox wraps; flat tile map still reads as fine', () => {
  const r = seriesForAoi([179, 60, -179, 70], fine, manifest);
  assert.equal(sum(r.modis.values), 2);
  assert.equal(r.res, 0.1);
});

test('bad bbox throws instead of returning zeros', () => {
  assert.throws(() => seriesForAoi([0, 0, NaN, 1], fine, manifest), RangeError);
});

test('domain: AOI fully inside keeps the data and is not partial', () => {
  const r = seriesForAoi(tile, fine, manifest, { domain });
  assert.deepEqual(r.domain, { cells: 10000, inside: 10000, partial: false });
  assert.deepEqual(r.modis.values, [7, 7, 7, 0, 7, 7]);
  assert.deepEqual(r.viirs.values, [null, null, 15, 0, 10, 10]);
  assert.equal(r.modis.flags, undefined);
});

test('domain: AOI fully outside gives all-null series, never zeros', () => {
  const r = seriesForAoi([0, 0, 1, 1], fine, manifest, { domain });
  assert.deepEqual(r.domain, { cells: 100, inside: 0, partial: false });
  assert.deepEqual(r.modis.values, [null, null, null, null, null, null]);
  assert.deepEqual(r.viirs.values, [null, null, null, null, null, null]);
  assert.deepEqual(r.modis.flags, [{ month: null, flag: 'outside-domain' }]);
  assert.deepEqual(validateSeries(r.modis, { manifest }), []);
});

test('domain: partial AOI sums the in-domain part and is flagged', () => {
  const r = seriesForAoi([-10, 40, 10, 50], fine, manifest, { domain });
  assert.deepEqual(r.domain, { cells: 20000, inside: 10000, partial: true });
  assert.equal(sum(r.modis.values), 35);
  assert.deepEqual(r.viirs.flags, [{ month: null, flag: 'partial-domain' }]);
  // west edge of the domain: AOI lon -11..-9.95 holds fine cell centers -10.95..-9.95, 10 of them in domain
  const e = seriesForAoi([-11, 40, -9.95, 40.1], fine, manifest, { domain });
  assert.deepEqual(e.domain, { cells: 11, inside: 1, partial: true });
  assert.deepEqual(e.modis.values, [3, 3, 3, 0, 3, 3]);
});

test('domain: antimeridian AOI and coarse level count domain cells', () => {
  const w = seriesForAoi([179, 60, -179, 70], fine, manifest, { domain });
  assert.equal(w.domain.inside, 0);
  assert.equal(w.domain.cells, 2000);
  const c = seriesForAoi(tile, { fine, coarse }, manifest, { res: 1, domain });
  assert.deepEqual(c.domain, { cells: 100, inside: 100, partial: false });
  const half = seriesForAoi([-10, 40, 10, 50], { fine, coarse }, manifest, { res: 1, domain });
  assert.deepEqual(half.domain, { cells: 200, inside: 100, partial: true });
});

test('no domain given: inside equals cells', () => {
  assert.deepEqual(seriesForAoi(tile, fine, manifest).domain, { cells: 10000, inside: 10000, partial: false });
});

test('seriesForAoi returns noaa20: null outside coverage, values inside, null when coverage is null', () => {
  const r = seriesForAoi(tile, fine, manifest);
  assert.deepEqual(r.noaa20.values.slice(0, 4), [null, null, null, null]);
  assert.equal(sum(r.noaa20.values), 14);
  const none = seriesForAoi(tile, {}, { ...manifest, coverage: { ...manifest.coverage, noaa20: null } });
  assert.ok(none.noaa20.values.every((v) => v === null));
  const out = seriesForAoi([-10, 40, 0, 50], fine, manifest, { domain: { rows: {} } });
  assert.ok(out.noaa20.values.every((v) => v === null));
});

test('fallbackLevels: aoi, tiles, ring, global', () => {
  const l = fallbackLevels([-7.5, 42, -3, 47], manifest);
  assert.deepEqual(l.map((x) => x.level), ['aoi', 'tiles', 'ring', 'global']);
  assert.deepEqual(l[0].bbox, [-7.5, 42, -3, 47]);
  assert.deepEqual(l[1].bbox, [-10, 40, 0, 50]);
  assert.deepEqual(l[2].bbox, [-20, 30, 10, 60]);
  assert.deepEqual(l[3].bbox, world);
});

test('fallbackLevels: tile-aligned AOI stays one tile; poles clamp', () => {
  assert.deepEqual(fallbackLevels(tile, manifest)[1].bbox, tile);
  const p = fallbackLevels([0, 85, 5, 90], manifest);
  assert.deepEqual(p[1].bbox, [0, 80, 10, 90]);
  assert.deepEqual(p[2].bbox, [-10, 70, 20, 90]);
  const s = fallbackLevels([0, -90, 5, -85], manifest);
  assert.deepEqual(s[2].bbox, [-10, -90, 20, -70]);
});

test('fallbackLevels: antimeridian and world edges wrap', () => {
  const a = fallbackLevels([175, 0, -175, 5], manifest);
  assert.deepEqual(a[1].bbox, [170, 0, -170, 10]);
  assert.deepEqual(a[2].bbox, [160, -10, -160, 20]);
  const same = fallbackLevels([5, 0, 3, 5], manifest); // crosses, wraps the globe
  assert.deepEqual(same[1].bbox, [-180, 0, 180, 10]);
  const edge = fallbackLevels([-180, 0, -175, 5], manifest);
  assert.deepEqual(edge[2].bbox, [170, -10, -160, 20]);
  const east = fallbackLevels([175, 0, 180, 5], manifest);
  assert.deepEqual(east[1].bbox, [170, 0, 180, 10]);
  assert.deepEqual(east[2].bbox, [160, -10, -170, 20]);
  assert.throws(() => fallbackLevels([0, 10, 5, 0], manifest), RangeError);
});

test('seriesForLevels: one entry per level, widening sums are monotone', () => {
  const r = seriesForLevels([-7.5, 42, -3, 47], fine, manifest, { res: 0.1 });
  assert.deepEqual(r.map((x) => x.level), ['aoi', 'tiles', 'ring', 'global']);
  for (const x of r) assert.deepEqual(Object.keys(x).sort(), ['level', 'modis', 'noaa20', 'viirs']);
  assert.equal(sum(r[1].modis.values), 35);
  assert.equal(sum(r[3].modis.values), 38);
  assert.ok(sum(r[0].modis.values) <= sum(r[1].modis.values));
});
