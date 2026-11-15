import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTable, parseNino34 } from './nino34.js';

const text = fs.readFileSync(new URL('../fixtures/nino34-sample.txt', import.meta.url), 'utf8');

test('parseNino34 reads YR MON ... ANOM rows, skips the header and junk', () => {
  assert.deepEqual(parseNino34(text), { '1949-12': -1.15, '1950-01': -1.33, '1950-02': -1.46, '2026-08': 2.17, '2026-09': 2.55, '2026-10': 2.68 });
});

test('buildTable records source, url, retrieval date and header; empty input throws', () => {
  const t = buildTable(text, { url: 'https://example.test/n34', retrieved: '2026-11-15' });
  assert.equal(t.url, 'https://example.test/n34');
  assert.equal(t.retrieved, '2026-11-15');
  assert.match(t.header, /ANOM/);
  assert.throws(() => buildTable('nothing here', { url: 'u', retrieved: 'd' }));
});

test('the committed table has the months the outlook needs', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../core/data/nino34.json', import.meta.url), 'utf8'));
  assert.ok(t.values['2018-01'] !== undefined && t.values['2025-12'] !== undefined && t.url.startsWith('https://www.cpc.ncep.noaa.gov/'));
});
