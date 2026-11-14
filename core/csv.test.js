import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { toCsv } from './csv.js';
import { harmonize, seriesForAoi, fallbackLevels, seriesForLevels, toCalendar } from './index.js';
import { caveatsFor } from './caveats.js';
import { CITATION } from '../pipeline/manifest.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const tiles = { x0y15: fx('tiles/0.1/x0y15.json'), x17y13: fx('tiles/0.1/x17y13.json') };
const whole = [-180, -90, 180, 90];
const golden = (kind) => new URL(`../fixtures/golden/export-${kind}.csv`, import.meta.url);

function fixtureExport() {
  const { modis, viirs } = seriesForAoi(whole, tiles, manifest);
  const h = harmonize([{ level: 'aoi', modis, viirs }], manifest);
  const meta = {
    aoi: 'fixture, whole world', bbox: whole, method: h.series.method, R: h.R, K: h.K,
    dataVersion: manifest.dataVersion, domain: 'whole world (fixture)', generated: '2026-11-14',
    citation: CITATION, caveats: caveatsFor(h).map((c) => c.id), flags: h.series.flags ?? [],
  };
  const cells = toCalendar(h, null, manifest);
  return { h, meta, cells, sensors: { modis, viirs, harmonized: h.series } };
}

for (const kind of ['calendar', 'sensors']) {
  test(`golden: fixture AOI ${kind} export`, () => {
    const { meta, cells, sensors } = fixtureExport();
    const out = toCsv(kind, kind === 'calendar' ? cells : sensors, meta);
    const path = golden(kind);
    if (process.env.UPDATE_GOLDEN) writeFileSync(path, out);
    assert.equal(out, readFileSync(path, 'utf8'));
  });
}

test('deterministic and CRLF only', () => {
  const { meta, cells } = fixtureExport();
  const a = toCsv('calendar', cells, meta);
  assert.equal(a, toCsv('calendar', cells, meta));
  assert.ok(!/[^\r]\n/.test(a) && a.endsWith('\r\n'));
});

test('null exports empty, 0 exports 0', () => {
  const out = toCsv('calendar', [
    { year: 2023, month: 1, value: null, status: 'no-data', estimated: false },
    { year: 2023, month: 2, value: 0, status: 'observed', estimated: false },
  ]);
  assert.ok(out.includes('2023,1,,no-data,false,\r\n'));
  assert.ok(out.includes('2023,2,0,observed,false,\r\n'));
  const s = toCsv('sensors', { modis: { start: '2023-01', values: [null, 0] }, viirs: { start: '2023-01', values: [] },
    harmonized: { start: '2023-01', values: [] } });
  assert.ok(s.includes('2023,1,modis,\r\n') && s.includes('2023,2,modis,0\r\n'));
});

test('formula injection: text prefixed, numbers (including negative) untouched', () => {
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
    const out = toCsv('calendar', [{ year: 2023, month: 1, value: 1, status: bad, estimated: false }]);
    const line = out.split('\r\n').find((l) => l.startsWith('2023,1,1,'));
    const want = bad === '\rx' ? `2023,1,1,"'${bad}",false,` : `2023,1,1,'${bad},false,`;
    assert.equal(line, want);
  }
  const neg = toCsv('calendar', [{ year: 2023, month: 1, value: -3, status: 'observed', estimated: false }]);
  assert.ok(neg.includes('2023,1,-3,observed'));
});

test('user text in metadata is escaped: no new records, quotes doubled', () => {
  const out = toCsv('calendar', [], { aoi: 'a"b,c\r\n=cmd|x', citation: '=HYPERLINK("x")' });
  const lines = out.split('\r\n');
  assert.ok(lines.includes('# aoi: a"b,c =cmd|x'));
  assert.ok(lines.includes('# citation: =HYPERLINK("x")'));
  assert.ok(lines.every((l) => l === '' || l.startsWith('# ') || l.startsWith('year,')));
});

test('metadata carries R, K, method, version, domain, date, caveats', () => {
  const { h, meta, cells } = fixtureExport();
  const out = toCsv('calendar', cells, meta);
  for (const needle of ['# unit: fire-cell-days', '# aoi bbox (w s e n): -180 -90 180 90', '# method: ',
    '# R: value=', 'level=aoi', '# K: ', '# data version: ', '# domain: whole world (fixture)',
    '# generated: 2026-11-14', '# caveats: unit-fire-cell-days']) {
    assert.ok(out.includes(needle), needle);
  }
  assert.ok(h.R.value > 0);
});

test('calendar flags column joins cell flags and series flags for the month', () => {
  const out = toCsv('calendar', [{ year: 2023, month: 3, value: 5, status: 'harmonized', estimated: true, flags: ['estimated'] }],
    { flags: [{ month: '2023-03', flag: 'viirs-not-archived' }, { month: null, flag: 'low-confidence' }] });
  assert.ok(out.includes('2023,3,5,harmonized,true,estimated viirs-not-archived\r\n'));
});

test('unknown kind throws', () => {
  assert.throws(() => toCsv('x', []), RangeError);
});
