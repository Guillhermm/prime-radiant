import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flaggedPeriods, flagRuleText } from './periods.js';
import { seriesForAoi } from './aggregate.js';
import { harmonize } from './harmonize.js';
import { anomaly } from './anomaly.js';

test('groups consecutive flagged months, maxRank and confirmedBy per period', () => {
  const s = {
    start: '2020-11',
    values: [0.95, 0.99, null, 0.97, 0.5, 1, 0.92],
    flags: [true, true, false, true, false, true, true],
    confirmedBy: ['modis', 'viirs', null, 'viirs', null, 'viirs', 'viirs'],
  };
  assert.deepEqual(flaggedPeriods(s), [
    { from: '2020-11', to: '2020-12', months: 2, maxRank: 0.99, confirmedBy: ['modis', 'viirs'] },
    { from: '2021-02', to: '2021-02', months: 1, maxRank: 0.97, confirmedBy: ['viirs'] },
    { from: '2021-04', to: '2021-05', months: 2, maxRank: 1, confirmedBy: ['viirs'] },
  ]);
});

test('no flags, or flags missing: no periods; unflagged high ranks never count', () => {
  assert.deepEqual(flaggedPeriods({ start: '2020-01', values: [1, 1], flags: [false, false] }), []);
  assert.deepEqual(flaggedPeriods({ start: '2020-01', values: [1, 1] }), []);
});

test('a period crosses the year boundary', () => {
  const p = flaggedPeriods({ start: '2020-12', values: [0.9, 0.9], flags: [true, true], confirmedBy: ['modis', 'modis'] });
  assert.deepEqual(p, [{ from: '2020-12', to: '2021-01', months: 2, maxRank: 0.9, confirmedBy: ['modis'] }]);
});

test('flagRuleText states p, n, single-sensor confirmation and the viirs-era-record meaning', () => {
  const t = flagRuleText();
  for (const part of ['p <= 0.1', 'at least 9 earlier years', 'MODIS alone or VIIRS alone', 'Record since 2012', '2002-2011']) assert.ok(t.includes(part), part);
  assert.ok(flagRuleText({ maxP: 0.2, minYears: 12 }).includes('p <= 0.2'));
});

test('fixture: six months of 2023 have no earlier years, so no flag and no period', () => {
  const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
  const manifest = fx('manifest.json');
  const tiles = { x0y15: fx('tiles/0.1/x0y15.json'), x17y13: fx('tiles/0.1/x17y13.json') };
  const raw = seriesForAoi([-180, -90, 180, 90], tiles, manifest);
  const h = harmonize([{ level: 'aoi', ...raw }], manifest, { rWindow: { to: '2030-12' } });
  const a = anomaly(h, manifest, { sensors: raw });
  assert.ok(a.flags.length > 0 && a.flags.every((f) => f === false));
  assert.deepEqual(flaggedPeriods(a), []);
});
