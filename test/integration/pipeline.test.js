import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../../pipeline/build.js';
import { validateManifest, validateTile, validateDomain } from '../../core/schema.js';

const root = new URL('../../fixtures/', import.meta.url).pathname;
const inputs = ['firms-modis-50.csv', 'firms-viirs-50.csv', 'firms-noaa20-20.csv'].map((f) => path.join(root, f));
const opts = { domainFile: path.join(root, 'domain', 'box.geojson'), inputs, month0: '2023-01', dataVersion: 'fixture-1', generatedAt: '2026-11-14T00:00:00Z', baseUrl: 'fixtures/' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr-build-'));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const rels = ['manifest.json', 'domain.json', 'tiles/0.1/x17y13.json', 'tiles/1/x17y13.json'];

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
test('domain clips records after the bbox prefilter, writes domain.json, coverage ignores the clip', async () => {
  const dir = tmp();
  const small = path.join(dir, 'cell0.geojson');
  fs.writeFileSync(small, JSON.stringify({ type: 'Polygon', coordinates: [[[-9.98, 40.02], [-9.92, 40.02], [-9.92, 40.08], [-9.98, 40.08], [-9.98, 40.02]]] }));
  const out = tmp();
  const { manifest, stats } = await build({ ...opts, domainFile: small, outDir: out });
  assert.ok(stats.clipped_by_domain > 0);
  assert.deepEqual(manifest.domain, { id: 'cell0', version: 'unknown', file: 'domain.json', res: 0.1 });
  assert.deepEqual(validateManifest(manifest), []);
  const domain = JSON.parse(read(out, 'domain.json'));
  assert.deepEqual(domain, { rows: { 1300: [[1700, 1700]] } });
  assert.deepEqual(validateDomain(domain), []);
  const t = JSON.parse(read(out, 'tiles/0.1/x17y13.json'));
  assert.deepEqual([...new Set(t.cell)], [0]);
  assert.deepEqual(manifest.coverage.noaa20, ['2023-05', '2023-06']);
});
test('without --domain there is no domain.json and no manifest field', async () => {
  const out = tmp();
  const { manifest, stats } = await build({ ...opts, domainFile: undefined, outDir: out });
  assert.equal(manifest.domain, undefined);
  assert.equal(stats.clipped_by_domain, 0);
  assert.ok(!fs.existsSync(path.join(out, 'domain.json')));
});
test('a build without NOAA-20 warns, nulls its coverage and still passes the schema', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const out = tmp();
  const { manifest } = await build({ ...opts, inputs: inputs.slice(0, 2), outDir: out });
  assert.equal(manifest.coverage.noaa20, null);
  assert.deepEqual(validateManifest(manifest), []);
  const fine = JSON.parse(read(out, 'tiles/0.1/x17y13.json'));
  assert.deepEqual(validateTile(fine, { manifest }), []);
  assert.ok(fine.noaa20.every((v) => v === null));
});
test('a day gap in one satellite marks the month partial; excluded-type records still count as acquired', async () => {
  const dir = tmp();
  const f = path.join(dir, 'gap_2023.csv');
  const hdr = 'latitude,longitude,acq_date,acq_time,satellite,type\n';
  const days = Array.from({ length: 31 }, (_, i) => `2023-05-${String(i + 1).padStart(2, '0')}`).filter((d) => d !== '2023-05-10' && d !== '2023-05-11');
  const rows = days.map((d) => `40.05,-9.95,${d},0212,N20,0`);
  rows.push('40.05,-9.95,2023-05-10,0212,N20,2'); // type 2 on the gap day: acquired, not counted
  fs.writeFileSync(f, hdr + rows.join('\n') + '\n');
  const { manifest, stats } = await build({ ...opts, inputs: [f, path.join(root, 'firms-viirs-50.csv')], outDir: tmp() });
  assert.deepEqual(manifest.partial_months.noaa20, ['2023-05']);
  assert.equal(manifest.acquisition_days.NOAA20['2023-05'], 30);
  assert.equal(stats.fire_cell_days.noaa20, 29);
});

test('NRT records never count as acquisition days', async () => {
  const dir = tmp();
  const f = path.join(dir, 'gap_2023.csv');
  const days = Array.from({ length: 31 }, (_, i) => `2023-05-${String(i + 1).padStart(2, '0')}`).filter((d) => d !== '2023-05-10');
  fs.writeFileSync(f, 'latitude,longitude,acq_date,acq_time,satellite,type\n' + days.map((d) => `40.05,-9.95,${d},0212,N20,0`).join('\n') + '\n');
  const nrt = path.join(dir, 'nrt_2023.csv');
  fs.writeFileSync(nrt, 'latitude,longitude,acq_date,acq_time,satellite\n40.05,-9.95,2023-05-10,0212,N20\n');
  const { manifest } = await build({ ...opts, inputs: [f, nrt, path.join(root, 'firms-viirs-50.csv')], outDir: tmp() });
  assert.equal(manifest.acquisition_days.NOAA20['2023-05'], 30);
  assert.deepEqual(manifest.partial_months.noaa20, ['2023-05']);
});
test('a build with no full VIIRS year writes no overview.json and says so in its stats', async () => {
  const out = tmp();
  const { stats } = await build({ ...opts, outDir: out });
  assert.equal(stats.overview, null);
  assert.equal(fs.existsSync(path.join(out, 'overview.json')), false);
});
