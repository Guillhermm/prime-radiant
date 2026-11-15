import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGlobalLevel } from './levels.js';
import { seriesForLevels } from '../core/aggregate.js';
import { validateGlobalLevel } from '../core/schema.js';

const fx = (p) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8'));
const manifest = fx('manifest.json');
const domain = fx('domain.json');
const coarse = { x17y13: fx('tiles/1/x17y13.json') };

test('global.json is the global fallback level core computes from every coarse tile', () => {
  const g = buildGlobalLevel(manifest, coarse, domain);
  assert.deepEqual(validateGlobalLevel(g, { manifest }), []);
  const fromTiles = seriesForLevels([-10, 40, 0, 50], { coarse }, manifest, { domain }).find((l) => l.level === 'global');
  for (const s of ['modis', 'viirs', 'noaa20']) assert.deepEqual(g[s], fromTiles[s]);
  const given = seriesForLevels([-10, 40, 0, 50], { coarse: {} }, manifest, { domain, global: g }).find((l) => l.level === 'global');
  assert.deepEqual(given.viirs, g.viirs, 'a given global level is used as is');
});

test('validateGlobalLevel: version, span and value checks', () => {
  const g = buildGlobalLevel(manifest, coarse, domain);
  const codes = (x) => validateGlobalLevel(x, { manifest }).map((e) => e.code);
  assert.deepEqual(codes({ ...g, dataVersion: 'other' }), ['VERSION_MISMATCH']);
  assert.deepEqual(codes({ ...g, viirs: { ...g.viirs, values: g.viirs.values.slice(1) } }), ['BAD_SERIES']);
  assert.deepEqual(codes({ ...g, modis: { ...g.modis, values: g.modis.values.map(() => -1) } }), ['BAD_SERIES']);
  assert.deepEqual(codes(null), ['NOT_OBJECT']);
});
