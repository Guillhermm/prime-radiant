import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../../pipeline/build.js';
import { validateManifest, validateTile } from '../../core/schema.js';

const root = new URL('../../fixtures/', import.meta.url).pathname;
const inputs = ['firms-modis-50.csv', 'firms-viirs-50.csv', 'firms-noaa20-20.csv'].map((f) => path.join(root, f));
const opts = { inputs, month0: '2023-01', dataVersion: 'fixture-1', generatedAt: '2026-11-14T00:00:00Z', baseUrl: 'fixtures/' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr-build-'));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const rels = ['manifest.json', 'tiles/0.1/x17y13.json', 'tiles/1/x17y13.json'];

test('fixture CSVs build to the golden files, byte for byte', async () => {
  const out = tmp();
  await build({ ...opts, outDir: out });
  for (const r of rels) assert.equal(read(out, r), read(root, 'golden', r), r);
});
test('golden tiles equal the hand-kept fixture tiles', () => {
  for (const r of rels.slice(1)) assert.equal(read(root, 'golden', r), read(root, r));
});
test('manifest and tiles pass the schema; coarse sums equal fine sums', async () => {
  const out = tmp();
  const { manifest, stats } = await build({ ...opts, outDir: out });
  assert.deepEqual(validateManifest(manifest), []);
  const fine = JSON.parse(read(out, 'tiles/0.1/x17y13.json'));
  const coarse = JSON.parse(read(out, 'tiles/1/x17y13.json'));
  assert.deepEqual(validateTile(fine, { manifest }), []);
  assert.deepEqual(validateTile(coarse, { manifest, res: 1 }), []);
  const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
  for (const s of ['modis', 'viirs', 'noaa20']) assert.equal(sum(fine[s]), sum(coarse[s]), s);
  assert.deepEqual(stats.fire_cell_days, { modis: 35, viirs: 35, noaa20: 14 });
  assert.equal(stats.detections_in, 120);
});
test('bbox clips records but coverage still comes from the whole input', async () => {
  const out = tmp();
  const { manifest, stats } = await build({ ...opts, outDir: out, bbox: [-10, 40, -9, 41] });
  assert.ok(stats.clipped_by_bbox > 0);
  assert.deepEqual(manifest.coverage.noaa20, ['2023-05', '2023-06']);
  const t = JSON.parse(read(out, 'tiles/0.1/x17y13.json'));
  assert.deepEqual([...new Set(t.cell)], [0, 1]);
});
test('NRT files are skipped and counted', async () => {
  const dir = tmp();
  const nrt = path.join(dir, 'nrt_2023.csv');
  fs.writeFileSync(nrt, 'latitude,longitude,acq_date,acq_time,satellite\n40.05,-9.95,2023-05-01,0212,N20\n');
  const { stats } = await build({ ...opts, inputs: [...inputs, nrt], outDir: tmp() });
  assert.equal(stats.skipped.no_type, 1);
  assert.equal(stats.fire_cell_days.noaa20, 14);
});
