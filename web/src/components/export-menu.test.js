import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../../core/index.js';
import { csvExport, exportFilename, guardCsv } from './export-menu.js';

const series = { id: 'harmonized', unit: 'fire-cell-days', start: '2012-08', values: [13, null, 0], method: { id: 'stub', version: '0' }, comparable: false };

test('filename carries the UTC date', () => {
  assert.equal(exportFilename(new Date('2026-11-14T23:30:00Z')), 'prime-radiant-2026-11-14.csv');
  assert.equal(exportFilename(new Date('2026-01-02T00:00:00Z'), { prefix: 'x', ext: 'txt' }), 'x-2026-01-02.txt');
});

test('csv export text equals guardCsv(core.toCsv) byte for byte', () => {
  const meta = { region: 'bbox -60,-20,-50,-10' };
  const out = csvExport(series, meta, new Date('2026-11-14T10:00:00Z'));
  assert.equal(out.text, guardCsv(toCsv(series, meta)));
  assert.equal(out.filename, 'prime-radiant-2026-11-14.csv');
  assert.match(out.mime, /^text\/csv/);
  assert.ok(!out.text.startsWith('﻿'));
});

test('guardCsv prefixes header values that start a formula and leaves safe text and numbers alone', () => {
  const input = ['# region: =HYPERLINK("http://x")', '# note: @cmd', '# bbox: -58,-20,-55,-17', '# n: -3', '# ok: Pantanal', 'month,value', '2020-01,-5', '2020-02,'].join('\n');
  assert.equal(guardCsv(input), ['# region: \'=HYPERLINK("http://x")', '# note: \'@cmd', '# bbox: -58,-20,-55,-17', '# n: -3', '# ok: Pantanal', 'month,value', '2020-01,-5', '2020-02,'].join('\n'));
});

test('csv export of a formula-looking region is neutralized', () => {
  const series = { id: 's', unit: 'u', method: { id: 'm', version: '1' }, comparable: true, start: '2020-01', values: [1, null] };
  assert.match(csvExport(series, { region: '=1+1' }, new Date()).text, /# region: '=1\+1/);
});

test('guardCsv also neutralizes a formula hidden after a comma in header text', () => {
  assert.equal(guardCsv('# citation: NASA, =cmd()|x\nmonth,value'), "# citation: NASA,' =cmd()|x\nmonth,value");
});
