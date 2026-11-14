import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from './index.js';
import { validateSeries, validateCalendarCell } from './schema.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const tiles = { x0y15: fx('tiles/0.1/x0y15.json'), x17y13: fx('tiles/0.1/x17y13.json') };
const whole = [-180, -90, 180, 90];
const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);

test('exports the M1 API', () => {
  for (const f of ['seriesForAoi', 'harmonize', 'baseline', 'toCalendar', 'kpis', 'toCsv']) assert.equal(typeof core[f], 'function', f);
});

test('seriesForAoi: fixture totals, null vs 0, schema-valid', () => {
  const { modis, viirs } = core.seriesForAoi(whole, tiles, manifest);
  assert.deepEqual(validateSeries(modis, { manifest }), []);
  assert.deepEqual(validateSeries(viirs, { manifest }), []);
  assert.equal(sum(modis.values), 38); // 35 + 3
  assert.equal(sum(viirs.values), 39); // 35 + 4
  assert.deepEqual(modis.values, [9, 7, 8, 0, 7, 7]);
  assert.deepEqual(viirs.values, [null, null, 18, 0, 10, 11]);
});

test('seriesForAoi: bbox selects cells by center; antimeridian bbox wraps', () => {
  const one = core.seriesForAoi([-10, 40, -9.9, 40.1], tiles, manifest); // cell 0 of x17y13
  assert.deepEqual(one.modis.values, [3, 3, 3, 0, 3, 3]);
  const wrap = core.seriesForAoi([179, 60, -179, 70], tiles, manifest); // only x0y15 cell 0 (center -179.95); cells 99 and 9999 sit at -170.05
  assert.equal(sum(wrap.modis.values), 2);
  const none = core.seriesForAoi([0, 0, 1, 1], tiles, manifest);
  assert.deepEqual(none.viirs.values, [null, null, 0, 0, 0, 0]);
});

test('seriesForAoi: coarse level gives the same totals', () => {
  const c = core.seriesForAoi(whole, { x17y13: fx('tiles/1/x17y13.json') }, manifest, { res: 1 });
  const f = core.seriesForAoi(whole, { x17y13: tiles.x17y13 }, manifest);
  assert.deepEqual(c.modis.values, f.modis.values);
  assert.deepEqual(c.viirs.values, f.viirs.values);
});

const pipeline = () => {
  const sensors = core.seriesForAoi(whole, tiles, manifest);
  const h = core.harmonize(sensors);
  const b = core.baseline(h.series);
  const cells = core.toCalendar(h.series, b);
  return { sensors, h, b, cells };
};

test('harmonize stub: tagged, schema-valid, VIIRS where it operates, estimated flags', () => {
  const { sensors, h } = pipeline();
  assert.equal(h.method.id, 'stub');
  assert.equal(h.series.method.id, 'stub');
  assert.deepEqual(validateSeries(h.series, { manifest }), []);
  assert.deepEqual(h.series.values, [9, 7, 18, 0, 10, 11]);
  assert.deepEqual(h.series.flags.map((f) => f.month), ['2023-01', '2023-02']);
  assert.deepEqual([h.R, h.ci, h.level], [1, null, 'aoi']);
  assert.ok(sensors.modis.values.length === h.series.values.length);
});

test('baseline: fixture span has under 5 earlier years, so null with a reason, schema-valid', () => {
  const { b } = pipeline();
  assert.equal(b.series.method.id, 'baseline-median');
  assert.deepEqual(validateSeries(b.series, { manifest }), []);
  assert.ok(b.series.values.every((v) => v === null));
  assert.ok(b.reasons.every((r) => typeof r === 'string' && r.length > 0));
});

test('toCalendar: no-data and zero never collapse; estimated months marked', () => {
  const { cells } = pipeline();
  for (const c of cells) assert.deepEqual(validateCalendarCell(c, { manifest }), []);
  assert.deepEqual(cells.map((c) => c.status), ['harmonized', 'harmonized', 'observed', 'observed', 'observed', 'observed']);
  assert.equal(cells[3].value, 0);
  const nd = core.toCalendar({ id: 'harmonized', unit: 'fire-cell-days', start: '2023-01', values: [null, 0],
    method: { id: 'stub', version: 0 }, comparable: true });
  assert.deepEqual(nd.map((c) => [c.value, c.status]), [[null, 'no-data'], [0, 'observed']]);
});

test('kpis stub: numbers equal the series they come from', () => {
  const { h, b, cells } = pipeline();
  const k = core.kpis(cells, h, b);
  assert.equal(k.total, sum(h.series.values));
  assert.equal(k.current.value, 11);
  assert.deepEqual([k.median, k.R, k.level, k.method.id], [null, 1, 'aoi', 'stub']);
  assert.equal(core.kpis([], h).current, null);
});

test('toCsv stub: header, null empty, 0 as 0, rejects unknown kind', () => {
  const { sensors, h, cells } = pipeline();
  const cal = core.toCsv('calendar', cells, { aoi: 'whole world' });
  assert.ok(cal.startsWith('# unit: fire-cell-days\n# aoi: whole world\n# method: stub 0'));
  assert.ok(cal.includes('2023,4,0,observed\n'));
  const nd = core.toCalendar({ id: 'harmonized', unit: 'fire-cell-days', start: '2023-01', values: [null],
    method: { id: 'stub', version: 0 }, comparable: true });
  assert.ok(core.toCsv('calendar', nd).includes('2023,1,,no-data\n'));
  const s = core.toCsv('sensors', { ...sensors, harmonized: h.series });
  assert.ok(s.includes('2023,1,viirs,\n') && s.includes('2023,4,viirs,0\n'));
  assert.throws(() => core.toCsv('x', []), RangeError);
});
