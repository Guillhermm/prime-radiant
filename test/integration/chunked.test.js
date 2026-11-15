// M4-K1: the chunked build (files grouped by the year in their name, compacted per year) must give
// the same bytes as one pass over the same records (files with no year stay in one running total).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../../pipeline/build.js';

const root = new URL('../../fixtures/', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr-chunk-'));
const opts = { domainFile: path.join(root, 'domain', 'box.geojson'), month0: '2022-01', dataVersion: 'fixture-1',
  generatedAt: '2026-11-14T00:00:00Z', baseUrl: 'fixtures/' };

/** Every file under dir, relative path -> contents. */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const HEAD = 'latitude,longitude,acq_date,acq_time,satellite,type';
/** Deterministic rows for one year and satellite: a few cells over a few days, duplicates included. */
const rows = (year, sat) => {
  const out = [];
  for (let m = 1; m <= 12; m += 3) {
    for (let d = 1; d <= 4; d++) {
      for (const [lat, lon] of [[40.05, -9.95], [40.05, -9.95], [41.23, -5.51], [49.95, -0.05]]) {
        out.push(`${lat},${lon},${year}-${String(m).padStart(2, '0')}-${String(d * (m % 5 + 1)).padStart(2, '0')},1200,${sat},0`);
      }
    }
  }
  return out;
};

test('chunked by year equals one pass over the same records, byte for byte', async () => {
  const yearly = tmp(), loose = tmp();
  const all = [];
  for (const year of [2022, 2023]) {
    for (const [dir, sat] of [['modis', 'Terra'], ['modis', 'Aqua'], ['viirs-snpp', 'N'], ['viirs-jpss1', 'N20']]) {
      const r = rows(year, sat);
      fs.appendFileSync(path.join(yearly, `${dir}_${year}_Box.csv`), (fs.existsSync(path.join(yearly, `${dir}_${year}_Box.csv`)) ? '' : `${HEAD}\n`) + r.join('\n') + '\n');
      all.push(...r);
    }
  }
  fs.writeFileSync(path.join(loose, 'all-records.csv'), `${HEAD}\n${all.join('\n')}\n`); // no year in the name: one pass
  const a = tmp(), b = tmp();
  const ra = await build({ ...opts, inputs: [yearly], outDir: a });
  const rb = await build({ ...opts, inputs: [loose], outDir: b });
  assert.deepEqual(ra.stats.fire_cell_days, rb.stats.fire_cell_days);
  assert.ok(ra.stats.duplicates > 0);
  const ta = tree(a), tb = tree(b);
  assert.deepEqual(Object.keys(ta), Object.keys(tb));
  for (const f of Object.keys(ta)) assert.ok(ta[f] === tb[f], `${f} differs between chunked and one-pass`);
});

test('the fixture CSVs renamed with their year (chunked path) still build to the golden tiles', async () => {
  const dir = tmp();
  for (const f of ['firms-modis-50.csv', 'firms-viirs-50.csv', 'firms-noaa20-20.csv']) {
    fs.copyFileSync(path.join(root, f), path.join(dir, f.replace('.csv', '_2023.csv')));
  }
  const out = tmp();
  await build({ ...opts, month0: '2023-01', inputs: [dir], outDir: out });
  for (const r of ['tiles/0.1/x17y13.json', 'tiles/1/x17y13.json', 'domain.json']) {
    assert.equal(fs.readFileSync(path.join(out, r), 'utf8'), fs.readFileSync(path.join(root, 'golden', r), 'utf8'), r);
  }
});
