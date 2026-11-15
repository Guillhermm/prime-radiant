import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toCsv } from '../../../core/index.js';
import { areaSlug, csvExport, exportFilename } from './export-menu.js';
import { buildResult, csvMeta, sliceSeries } from '../view-data.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const tiles = { fine: { x17y13: fx('tiles/0.1/x17y13.json') }, coarse: { x17y13: fx('tiles/1/x17y13.json') } };
const r = buildResult({ bbox: [-10, 40, 0, 50], from: null, to: null, manifest, tiles, domain: fx('domain.json') });
const meta = csvMeta(r, { generated: '2026-11-15' });

test('filename carries the first and last month of the series', () => {
  assert.equal(exportFilename({ start: '2012-08', values: [1, 2, 3] }), 'prime-radiant-2012-08-2012-10.csv');
  assert.equal(exportFilename({ start: '2001-01', values: new Array(310).fill(0) }), 'prime-radiant-2001-01-2026-10.csv');
  assert.equal(exportFilename({ start: '2012-12', values: [1, 2] }, { prefix: 'x', ext: 'txt' }), 'x-2012-12-2013-01.txt');
});

test('calendar export is core.toCsv of the cells on screen, byte for byte', () => {
  const out = csvExport('calendar', { series: r.series, cells: r.cells, meta });
  assert.equal(out.text, toCsv('calendar', r.cells, meta));
  assert.equal(out.filename, 'prime-radiant-2023-01-2023-06.csv');
  assert.match(out.mime, /^text\/csv/);
  assert.match(out.text, /^# unit: fire-cell-days\r\n/);
  assert.match(out.text, /# domain: fixture-box 1\r\n/);
  assert.match(out.text, /\r\n2023,6,\d+(\.\d)?,partial,/, 'the partial last month is labeled');
});

test('sensors export is one long core table with noaa20, under its own filename', () => {
  const s = sliceSeries(r.series, '2023-05', '2023-06');
  const sensors = Object.fromEntries(['modis', 'viirs', 'noaa20'].map((id) => [id, sliceSeries(r.sensors[id], '2023-05', '2023-06')]));
  const out = csvExport('sensors', { series: s, sensors, meta });
  assert.equal(out.filename, 'prime-radiant-sensors-2023-05-2023-06.csv');
  assert.match(out.text, /\r\nyear,month,sensor,value\r\n/);
  assert.match(out.text, /\r\n2023,5,noaa20,6\r\n/);
});

test('a formula-looking header value stays inside a # comment line', () => {
  const out = csvExport('calendar', { series: r.series, cells: r.cells, meta: { ...meta, aoi: '=1+1' } });
  assert.match(out.text, /# aoi: =1\+1/, 'a # comment line cannot start a formula');
  assert.ok(!/\r\n=/.test(out.text));
});

test('synthetic data puts its warning on the first line of the CSV, real data is untouched', async () => {
  const { SYNTHETIC_LINE, withSyntheticNote, savedMessage } = await import('./export-menu.js');
  assert.equal(withSyntheticNote('a,b', false), 'a,b');
  assert.equal(withSyntheticNote('a,b', true).split('\r\n')[0], SYNTHETIC_LINE);
  assert.match(SYNTHETIC_LINE, /^# /);
  assert.equal(savedMessage('prime-radiant-2001-01-2026-10.csv'), 'CSV saved: prime-radiant-2001-01-2026-10.csv');
  assert.equal(savedMessage('prime-radiant-2001-01-2026-10.png'), 'Image saved: prime-radiant-2001-01-2026-10.png');
});

test('areaSlug: lowercase, accents stripped, one dash per run of other characters, trimmed, at most 60', () => {
  assert.equal(areaSlug('Kasaï-Oriental, Democratic Republic of the Congo'), 'kasai-oriental-democratic-republic-of-the-congo');
  assert.equal(areaSlug('  São Paulo — (Brazil)!  '), 'sao-paulo-brazil');
  assert.equal(areaSlug('19°S–12°S · 59°W–52°W'), '19-s-12-s-59-w-52-w');
  assert.equal(areaSlug('Côte d’Ivoire'), 'cote-d-ivoire');
  assert.equal(areaSlug('a'.repeat(59) + ' bcd'), 'a'.repeat(59), 'cut at 60, no trailing dash');
  assert.ok(areaSlug('x'.repeat(100)).length === 60);
  for (const x of ['', '—', null, undefined, '東京']) assert.equal(areaSlug(x), '');
});

test('exportFilename puts the area slug before the months, and leaves it out when empty', () => {
  const series = { start: '2012-08', values: [1, 2, 3] };
  assert.equal(exportFilename(series, { area: 'Kasaï-Oriental, Democratic Republic of the Congo', ext: 'png' }), 'prime-radiant-kasai-oriental-democratic-republic-of-the-congo-2012-08-2012-10.png');
  assert.equal(exportFilename(series, { area: '東京' }), 'prime-radiant-2012-08-2012-10.csv');
  assert.equal(csvExport('sensors', { series, sensors: { modis: series, viirs: series, noaa20: series }, meta: { aoi: 'Pará, Brazil', bbox: [0, 0, 1, 1] } }).filename.startsWith('prime-radiant-sensors-para-brazil-2012-08'), true);
});
