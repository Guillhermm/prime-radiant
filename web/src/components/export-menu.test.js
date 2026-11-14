import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../../core/index.js';
import { csvExport, exportFilename } from './export-menu.js';

const series = { id: 'harmonized', unit: 'fire-cell-days', start: '2012-08', values: [13, null, 0], method: { id: 'stub', version: '0' }, comparable: false };

test('filename carries the UTC date', () => {
  assert.equal(exportFilename(new Date('2026-11-14T23:30:00Z')), 'prime-radiant-2026-11-14.csv');
  assert.equal(exportFilename(new Date('2026-01-02T00:00:00Z'), { prefix: 'x', ext: 'txt' }), 'x-2026-01-02.txt');
});

test('csv export text equals core.toCsv byte for byte', () => {
  const meta = { region: 'bbox -60,-20,-50,-10' };
  const out = csvExport(series, meta, new Date('2026-11-14T10:00:00Z'));
  assert.equal(out.text, toCsv(series, meta));
  assert.equal(out.filename, 'prime-radiant-2026-11-14.csv');
  assert.match(out.mime, /^text\/csv/);
  assert.ok(!out.text.startsWith('﻿'));
});
