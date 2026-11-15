import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildResult, sliceCells, sliceSeries, csvMeta, isSyntheticManifest, partialMonthsOf, factorFor } from './view-data.js';
import { validateCalendarCell, validateSeries } from '../../core/schema.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const domain = fx('domain.json');
const tiles = { fine: { x17y13: fx('tiles/0.1/x17y13.json'), x0y15: fx('tiles/0.1/x0y15.json') }, coarse: { x17y13: fx('tiles/1/x17y13.json') } };
const BOX = [-10, 40, 0, 50];
const result = (o = {}) => buildResult({ bbox: BOX, from: null, to: null, manifest, tiles, domain, ...o });

test('slices cells to the inclusive range', () => {
  const cells = [{ year: 2012, month: 7 }, { year: 2012, month: 8 }, { year: 2012, month: 9 }, { year: 2012, month: 10 }];
  assert.deepEqual(sliceCells(cells, '2012-08', '2012-09').map((c) => c.month), [8, 9]);
  assert.equal(sliceCells(cells, null, null).length, 4);
});

test('slices a series and moves its start', () => {
  const s = { id: 'x', start: '2000-01', values: Array.from({ length: 24 }, (_, i) => i) };
  const r = sliceSeries(s, '2000-03', '2000-05');
  assert.equal(r.start, '2000-03');
  assert.deepEqual(r.values, [2, 3, 4]);
  assert.deepEqual(sliceSeries(s, '1999-01', '2005-01').values.length, 24);
  assert.equal(sliceSeries(s, '2001-01', '2001-12').values.length, 12);
});

test('fixture box: core sensor totals match fixtures/README.md and the harmonized series is S-NPP where it flew', () => {
  const r = result();
  const sum = (s) => s.values.reduce((a, v) => a + (v ?? 0), 0);
  assert.deepEqual([sum(r.sensors.modis), sum(r.sensors.viirs), sum(r.sensors.noaa20)], [35, 35, 14]);
  assert.deepEqual(r.sensors.viirs.values, [null, null, 15, 0, 10, 10]);
  assert.deepEqual(r.cells.map((c) => c.value), [null, null, 15, 0, 10, 10]);
  assert.equal(r.kpis.total, 35);
  assert.equal(r.aoiCells, 10000);
  for (const c of r.allCells) assert.deepEqual(validateCalendarCell(c, { manifest }), []);
  assert.deepEqual(validateSeries(r.series, { manifest }), []);
});

test('zero is a value, null is not: the empty month reads 0, months before S-NPP stay null without R', () => {
  const r = result({ from: '2023-01', to: '2023-04' });
  assert.deepEqual(r.cells.map((c) => [c.value, c.status]), [[null, 'no-data'], [null, 'no-data'], [15, 'observed'], [0, 'observed']]);
  assert.equal(r.harmonized.R.value, null, 'the fixture has no month in the R window (2002-08..2021-12)');
  assert.ok(r.harmonized.reasons.some((x) => /R undefined/.test(x)));
});

test('partial months from the manifest reach the cells; cells carry their source and the years behind the median', () => {
  const r = result();
  const june = r.cells.at(-1);
  assert.equal(june.status, 'partial');
  assert.deepEqual(june.source, { id: 'viirs', factor: null });
  assert.deepEqual(june.medianYears, []);
  assert.deepEqual(partialMonthsOf(manifest), ['2023-06']);
  assert.equal(r.typical.length, 12);
  assert.ok(r.typical.every((t) => t.median === null), 'six months of history give no typical year');
});

test('domain: inside, partly inside and wholly outside', () => {
  assert.deepEqual(result().domain, { cells: 10000, inside: 10000, partial: false, outside: false, info: manifest.domain });
  const half = result({ bbox: [-15, 40, 0, 50] });
  assert.equal(half.domain.partial, true);
  assert.equal(half.aoiCells, 10000, 'density counts in-domain cells only');
  assert.ok(half.harmonized.series.flags.some((f) => f.flag === 'partial-domain'));
  const out = result({ bbox: [-180, 60, -175, 65] });
  assert.equal(out.domain.outside, true);
  assert.ok(out.cells.every((c) => c.value === null && c.flags.includes('outside-domain')), 'outside the domain is null, never 0');
  assert.equal(out.aoiCells, 0);
  const noDomain = buildResult({ bbox: BOX, from: null, to: null, manifest: { ...manifest, domain: undefined }, tiles });
  assert.deepEqual([noDomain.domain.inside, noDomain.domain.info], [10000, null]);
});

test('factorFor reads per-month ratios when core used them', () => {
  assert.equal(factorFor({ value: 2, perMonth: Array.from({ length: 12 }, (_, i) => ({ value: i })) }, '2010-03'), 2);
  assert.equal(factorFor({ value: 2.5 }, '2010-03'), 2.5);
  assert.equal(factorFor(null, '2010-03'), null);
});

test('csv meta is core.toCsv\'s header: bbox, method, R and K, data version, domain, citation, caveat ids, flags', () => {
  const m = csvMeta(result(), { generated: '2026-11-15' });
  assert.deepEqual(m.bbox, BOX);
  assert.deepEqual(m.method, { id: 'ratio-of-sums', version: 1 });
  assert.equal(m.dataVersion, 'fixture-1');
  assert.equal(m.domain, 'fixture-box 1');
  assert.equal(m.generated, '2026-11-15');
  assert.equal(m.aoi, '');
  assert.equal(csvMeta(result(), { aoi: 'Pantanal' }).aoi, 'Pantanal', 'the area name goes in the header');
  assert.ok(m.caveats.includes('brazil-only') && !m.caveats.includes('not-validated'));
  assert.ok(Array.isArray(m.flags));
});

test('a synthetic-* dataVersion marks the manifest synthetic', () => {
  assert.equal(isSyntheticManifest({ dataVersion: 'synthetic-20261114' }), true);
  assert.equal(isSyntheticManifest(manifest), false);
  assert.equal(isSyntheticManifest(null), false);
});

test('synthetic Brazil record: MODIS × R before S-NPP, medians from 5 earlier years, R usable at the area', async () => {
  const { generate } = await import('../../tools/mock-data.mjs');
  const d = generate({ last: '2016-12', now: new Date('2026-11-14T00:00:00Z') });
  const r = buildResult({ bbox: [-58, -20, -55, -15], from: null, to: null, manifest: d.manifest, tiles: { fine: d.tiles, coarse: d.coarse }, domain: d.domain });
  const at = (ym) => r.allCells.find((c) => `${c.year}-${String(c.month).padStart(2, '0')}` === ym);
  assert.deepEqual([at('2001-09').value, at('2001-09').flags], [null, ['partial-domain', 'terra-only']]);
  assert.equal(at('2005-09').estimated, true);
  assert.equal(at('2005-09').source.id, 'modis');
  assert.equal(at('2015-09').source.id, 'viirs');
  assert.equal(at('2012-01').status, 'partial', 'S-NPP starts 2012-01-20');
  assert.equal(typeof at('2015-09').median, 'number');
  assert.ok(at('2015-09').medianYears.length >= 5);
  assert.ok(r.harmonized.R.value > 2 && r.harmonized.R.value < 4.5);
  assert.equal(r.domain.partial, true, 'the box reaches into Bolivia');
  assert.ok(r.typical.some((t) => t.median !== null));
});

test('buildResult carries core\'s anomaly Series in the contract shape', () => {
  const r = result();
  assert.equal(r.anomaly.id, 'anomaly');
  assert.deepEqual(r.anomaly.method, { id: 'percentile-rank', version: 1 });
  assert.equal(r.anomaly.flags.length, r.anomaly.values.length);
  assert.ok(r.anomaly.values.every((v) => v === null)); // fixture has under 9 baseline years
  assert.ok(r.anomaly.flags.every((f) => f === false));
  assert.deepEqual(validateSeries(r.anomaly, { manifest }), []);
  assert.equal(r.kpis.anomaly.flagged, 0);
});
