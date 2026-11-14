import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../../core/index.js';
import { csvExport, exportFilename, guardCsv } from './export-menu.js';

const series = { id: 'harmonized', unit: 'fire-cell-days', start: '2012-08', values: [13, null, 0], method: { id: 'stub', version: '0' }, comparable: false };

test('filename carries the first and last month of the series', () => {
  assert.equal(exportFilename(series), 'prime-radiant-2012-08-2012-10.csv');
  assert.equal(exportFilename({ start: '2001-01', values: new Array(310).fill(0) }), 'prime-radiant-2001-01-2026-10.csv');
  assert.equal(exportFilename({ start: '2012-12', values: [1, 2] }, { prefix: 'x', ext: 'txt' }), 'x-2012-12-2013-01.txt');
  assert.equal(exportFilename({ start: '2012-12', values: [1] }), 'prime-radiant-2012-12-2012-12.csv');
});

test('csv export text equals guardCsv(core.toCsv) byte for byte', () => {
  const meta = { region: 'bbox -60,-20,-50,-10' };
  const out = csvExport(series, meta);
  assert.equal(out.text, guardCsv(toCsv(series, meta)));
  assert.equal(out.filename, 'prime-radiant-2012-08-2012-10.csv');
  assert.match(out.mime, /^text\/csv/);
  assert.ok(!out.text.startsWith('﻿'));
});

test('guardCsv prefixes header values that start a formula and leaves safe text and numbers alone', () => {
  const input = ['# region: =HYPERLINK("http://x")', '# note: @cmd', '# bbox: -58,-20,-55,-17', '# n: -3', '# ok: Pantanal', 'month,value', '2020-01,-5', '2020-02,'].join('\n');
  assert.equal(guardCsv(input), ['# region: \'=HYPERLINK("http://x")', '# note: \'@cmd', '# bbox: -58,-20,-55,-17', '# n: -3', '# ok: Pantanal', 'month,value', '2020-01,-5', '2020-02,'].join('\n'));
});

test('csv export of a formula-looking region is neutralized', () => {
  const series = { id: 's', unit: 'u', method: { id: 'm', version: '1' }, comparable: true, start: '2020-01', values: [1, null] };
  assert.match(csvExport(series, { region: '=1+1' }).text, /# region: '=1\+1/);
});

test('guardCsv also neutralizes a formula hidden after a comma in header text', () => {
  assert.equal(guardCsv('# citation: NASA, =cmd()|x\nmonth,value'), "# citation: NASA,' =cmd()|x\nmonth,value");
});

test('synthetic data puts its warning on the first line of the CSV, real data is untouched', async () => {
  const { SYNTHETIC_LINE, withSyntheticNote, savedMessage } = await import('./export-menu.js');
  assert.equal(withSyntheticNote('a,b', false), 'a,b');
  assert.equal(withSyntheticNote('a,b', true).split('\n')[0], SYNTHETIC_LINE);
  assert.match(SYNTHETIC_LINE, /^# /);
  assert.equal(savedMessage('prime-radiant-2001-01-2026-10.csv'), 'CSV saved: prime-radiant-2001-01-2026-10.csv');
});
