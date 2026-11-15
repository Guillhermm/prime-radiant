import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLive } from '../../pipeline/live.js';
import { validateLiveManifest, validateLiveTile, validateDomain } from '../../core/schema.js';

const root = new URL('../../fixtures/', import.meta.url).pathname;
const opts = {
  inputs: ['nrt-modis.csv', 'nrt-viirs.csv'].map((f) => path.join(root, f)),
  domainFile: path.join(root, 'domain', 'box.geojson'),
  fetchedAt: '2026-11-12T12:00:00Z',
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr-live-it-'));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const rels = ['manifest.json', 'domain.json', 'tiles/0.1/x17y13.json'];

test('fixture NRT CSVs build to the golden live files, byte for byte', async () => {
  const out = tmp();
  await buildLive({ ...opts, outDir: out });
  for (const r of rels) assert.equal(read(out, r), read(root, 'golden', 'live', r), r);
});

test('golden live tile holds the hand-counted fire-cell-days', () => {
  // day index 0 = 2026-11-10; cells 0 (lat 40.05, lon -9.95), 101, 5049; null = sensor outside its day coverage
  assert.deepEqual(JSON.parse(read(root, 'golden', 'live', 'tiles/0.1/x17y13.json')), {
    cell: [0, 0, 0, 101, 101, 5049],
    day: [0, 1, 2, 1, 2, 2],
    modis: [1, 1, 0, 1, 0, 1],
    viirs: [null, 1, 1, 0, 0, 0],
    noaa20: [null, null, 0, null, 1, 0],
  });
});

test('manifest and tile pass the schema; the domain is written', async () => {
  const out = tmp();
  const { manifest } = await buildLive({ ...opts, outDir: out });
  assert.deepEqual(validateLiveManifest(manifest), []);
  assert.deepEqual(validateLiveTile(JSON.parse(read(out, 'tiles/0.1/x17y13.json')), { manifest }), []);
  assert.deepEqual(validateDomain(JSON.parse(read(out, 'domain.json'))), []);
});

test('NRT files have no type column: handled, counted, recorded in the manifest', async () => {
  const { manifest, stats } = await buildLive({ ...opts, outDir: tmp() });
  assert.deepEqual(manifest.sources.map((s) => [s.file, s.records, s.has_type]), [['nrt-modis.csv', 6, false], ['nrt-viirs.csv', 5, false]]);
  assert.equal(manifest.records_without_type, 11);
  assert.equal(stats.rejected.lat, 1);
});

test('provenance: fetch time, per-sensor day coverage, skipped NOAA-21, clipped, duplicates, counts', async () => {
  const { manifest } = await buildLive({ ...opts, outDir: tmp() });
  assert.equal(manifest.fetched_at, '2026-11-12T12:00:00Z');
  assert.deepEqual(manifest.coverage, { modis: ['2026-11-10', '2026-11-12'], viirs: ['2026-11-11', '2026-11-12'], noaa20: ['2026-11-12', '2026-11-12'] });
  assert.deepEqual(manifest.skipped, { NOAA21: 1 });
  assert.equal(manifest.clipped_by_domain, 1);
  assert.equal(manifest.duplicates, 2);
  assert.deepEqual(manifest.fire_cell_days, { modis: 4, viirs: 2, noaa20: 1 });
  assert.deepEqual(manifest.domain, { id: 'fixture-box', version: '1', file: 'domain.json', res: 0.1 });
});

test('a rebuild into the same folder replaces the tiles of the previous run', async () => {
  const out = tmp();
  await buildLive({ ...opts, outDir: out });
  fs.writeFileSync(path.join(out, 'tiles', '0.1', 'x0y0.json'), '{}');
  await buildLive({ ...opts, outDir: out });
  assert.deepEqual(fs.readdirSync(path.join(out, 'tiles', '0.1')), ['x17y13.json']);
});
