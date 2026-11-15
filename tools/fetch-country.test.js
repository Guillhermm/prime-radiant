import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countryFiles, fetchAll } from './fetch-country.mjs';

const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

test('the file list matches docs/data.md: MODIS from 2000, S-NPP from 2012, NOAA-20 from 2018', () => {
  const files = countryFiles(2025);
  assert.equal(files.length, 26 + 14 + 8);
  assert.deepEqual(files[0], { url: 'https://firms.modaps.eosdis.nasa.gov/data/country/modis/2000/modis_2000_Brazil.csv', name: 'modis_2000_Brazil.csv' });
  assert.ok(files.some((f) => f.url.endsWith('/viirs-jpss1/2018/viirs-jpss1_2018_Brazil.csv')));
  assert.ok(!files.some((f) => f.name === 'viirs-snpp_2011_Brazil.csv'));
});

test('downloads what is missing, keeps what is there, and fails on an HTTP error', async () => {
  const out = await mkdtemp(join(tmpdir(), 'pr-country-'));
  dirs.push(out);
  await writeFile(join(out, 'modis_2000_Brazil.csv'), 'kept');
  const asked = [];
  const ok = async (url) => { asked.push(url); return { ok: true, status: 200, body: new Response('latitude,longitude\n').body }; };
  await fetchAll({ out, to: 2018, fetchFn: ok, log: () => {} });
  assert.equal(asked.length, countryFiles(2018).length - 1, 'the existing file is not fetched again');
  assert.equal(await readFile(join(out, 'modis_2000_Brazil.csv'), 'utf8'), 'kept');
  assert.ok(!(await readdir(out)).some((f) => f.endsWith('.part')));
  const out2 = await mkdtemp(join(tmpdir(), 'pr-country-'));
  dirs.push(out2);
  await assert.rejects(fetchAll({ out: out2, to: 2018, fetchFn: async () => ({ ok: false, status: 404 }), log: () => {} }), /HTTP 404/);
});
