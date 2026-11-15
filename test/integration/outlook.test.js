import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOutlook } from '../../pipeline/outlook.js';

// Synthetic 1 deg tile: seasonal fires with a persistent yearly level per cell, S-NPP 2012-01..2024-12,
// NOAA-20 2018-04..2024-12. Seeded, so the run is reproducible.
function makeBuild(dir) {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cell = [], month = [], modis = [], viirs = [], noaa20 = [];
  const level = Array.from({ length: 12 }, () => 0.5 + rnd() * 3);
  for (let c = 0; c < 12; c++) {
    let ar = 0;
    for (let m = 0; m < 156; m++) {
      const mo = m % 12;
      ar = 0.7 * ar + (rnd() - 0.5);
      const v = Math.round(level[c] * 10 * (1 + Math.sin((mo / 12) * 2 * Math.PI)) * Math.exp(ar) + 3);
      cell.push(c); month.push(m + 144); modis.push(0);
      viirs.push(v); noaa20.push(m >= 75 ? Math.round(v * 1.02) : null);
    }
  }
  // month index counted from month0 2000-01: 144 = 2012-01 .. 299 = 2024-12
  fs.mkdirSync(path.join(dir, 'tiles', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tiles', '1', 'x10y10.json'), JSON.stringify({ cell, month, modis, viirs, noaa20 }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    month0: '2000-01', last_month: '2024-12', dataVersion: 'test', tiles: ['x10y10'],
    coverage: { modis: ['2000-11', '2024-12'], viirs: ['2012-01', '2024-12'], noaa20: ['2018-04', '2024-12'] },
    partial_months: { modis: [], viirs: ['2012-01'], noaa20: [] },
  }));
}

test('outlook run is deterministic and writes tiles, manifest and report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-'));
  makeBuild(dir);
  const split = { trainTo: '2020-12', testFrom: '2022-01', testTo: '2024-12' };
  const out = path.join(dir, 'out');
  const a = runOutlook({ dataDir: dir, outDir: out, ...split });
  const b = runOutlook({ dataDir: dir, ...split });
  assert.deepEqual(a.model.weights, b.model.weights);
  assert.equal(a.manifest.month, '2025-01');
  assert.equal(a.manifest.status, 'experimental');
  const tile = JSON.parse(fs.readFileSync(path.join(out, 'tiles', 'x10y10.json'), 'utf8'));
  assert.equal(tile.cell.length, tile.p.length);
  assert.ok(tile.p.length > 0 && tile.p.every((p) => p >= 0 && p <= 1));
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.ok(report.counts.train > 0 && report.counts.test > 0);
  assert.equal(report.temporal.reliability.length, 10);
  assert.ok(Number.isFinite(report.temporal.bss_climatology));
  fs.rmSync(dir, { recursive: true });
});
