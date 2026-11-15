import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseModel, runOutlook } from '../../pipeline/outlook.js';

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
  const a = runOutlook({ dataDir: dir, outDir: out, now: '2025-03-05T00:00:00Z', ...split });
  const b = runOutlook({ dataDir: dir, now: '2025-03-05T00:00:00Z', ...split });
  assert.deepEqual(a.model.weights, b.model.weights);
  assert.equal(a.manifest.target_month, '2025-01');
  assert.equal(a.manifest.status, 'experimental');
  const tile = JSON.parse(fs.readFileSync(path.join(out, 'tiles', 'x10y10.json'), 'utf8'));
  assert.equal(tile.cell.length, tile.p.length);
  assert.ok(tile.p.length > 0 && tile.p.every((p) => p >= 0 && p <= 1));
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.ok(report.counts.train > 0 && report.counts.test > 0);
  assert.equal(report.temporal.reliability.length, 10);
  assert.ok(Number.isFinite(report.temporal.bss_constant) && report.temporal.bss_persistence_ci.length === 2);
  assert.equal(tile.target_month, '2025-01');
  assert.equal(tile.issued_at, '2025-03-05T00:00:00.000Z');
  assert.equal(tile.based_on_data_to, '2024-12-31');
  assert.ok(report.temporal_all.n >= report.temporal.n && report.temporal_all.bss_constant_ci.length === 2);
  assert.equal(a.manifest.mode, 'hindcast');
  fs.rmSync(dir, { recursive: true });
});

test('live months extend the series: forecast of the month after the latest complete month, else hindcast', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-live-'));
  makeBuild(dir);
  const live = path.join(dir, 'live');
  fs.mkdirSync(path.join(live, 'tiles', '0.1'), { recursive: true });
  const cell = [], day = [], noaa20 = [];
  for (let c = 0; c < 12; c++) for (let d = 0; d < 59; d++) { cell.push(Math.floor(c / 10) * 1000 + (c % 10) * 10); day.push(d); noaa20.push(30 + (c % 3)); }
  fs.writeFileSync(path.join(live, 'tiles', '0.1', 'x10y10.json'), JSON.stringify({ cell, day, modis: noaa20.map(() => null), viirs: noaa20.map(() => null), noaa20 }));
  fs.writeFileSync(path.join(live, 'manifest.json'), JSON.stringify({
    fetched_at: '2025-03-05T10:00:00Z', day0: '2025-01-01', last_day: '2025-03-04', tiles: ['x10y10'],
    coverage: { noaa20: ['2025-01-01', '2025-03-04'] }, partial_days: { noaa20: ['2025-01-10'] },
  }));
  const split = { trainTo: '2020-12', testFrom: '2022-01', testTo: '2024-12' };
  const a = runOutlook({ dataDir: dir, liveDir: live, ...split });
  assert.equal(a.manifest.mode, 'forecast');
  assert.equal(a.manifest.last_observed_month, '2025-02');
  assert.equal(a.manifest.target_month, '2025-03');
  assert.deepEqual(a.report.live_months.map((m) => [m.month, m.usable]), [['2025-01', true], ['2025-02', true], ['2025-03', false]]);
  const t = a.tiles.get('x10y10');
  assert.equal(t.target_month, '2025-03');
  assert.equal(t.no_skill.length, t.p.length);
  const h = runOutlook({ dataDir: dir, now: '2025-03-05T10:00:00Z', ...split });
  assert.equal(h.manifest.mode, 'hindcast');
  assert.equal(h.manifest.last_observed_month, '2024-12');
  assert.equal(h.manifest.target_month, '2025-01');
  fs.rmSync(dir, { recursive: true });
});

test('no-skill: a cell with median 0 is forecast but labeled, the others are not (V4 O2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-'));
  makeBuild(dir);
  const f = path.join(dir, 'tiles', '1', 'x10y10.json');
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  t.cell.forEach((c, i) => { if (c === 0) { t.viirs[i] = 0; if (t.noaa20[i] !== null) t.noaa20[i] = 0; } });
  fs.writeFileSync(f, JSON.stringify(t));
  const out = path.join(dir, 'out');
  runOutlook({ dataDir: dir, outDir: out, now: '2025-03-05T00:00:00Z', trainTo: '2020-12', testFrom: '2022-01', testTo: '2024-12' });
  const tile = JSON.parse(fs.readFileSync(path.join(out, 'tiles', 'x10y10.json'), 'utf8'));
  assert.equal(tile.no_skill.length, tile.cell.length);
  assert.ok(tile.cell.includes(0));
  tile.cell.forEach((c, i) => assert.equal(tile.no_skill[i], c === 0 ? 1 : 0, `cell ${c}`));
  fs.rmSync(dir, { recursive: true });
});

test('model flag: default is logistic unless GBT clearly wins; gbt is deterministic and keeps the output shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-'));
  makeBuild(dir);
  const split = { trainTo: '2020-12', testFrom: '2022-01', testTo: '2024-12', now: '2025-03-05T00:00:00Z' };
  const g1 = runOutlook({ dataDir: dir, model: 'gbt', ...split });
  const g2 = runOutlook({ dataDir: dir, model: 'gbt', ...split });
  assert.equal(g1.model.model, 'gbt');
  assert.deepEqual(g1.model.trees, g2.model.trees);
  assert.equal(g1.manifest.model, 'gbt');
  const t = [...g1.tiles.values()][0];
  assert.ok(t.p.length > 0 && t.p.every((p) => p >= 0 && p <= 1) && t.target_month === '2025-01');
  assert.ok(g1.model.compared.logistic.temporal && g1.model.compared.gbt.temporal);
  assert.equal(runOutlook({ dataDir: dir, model: 'logistic', ...split }).model.model, 'logistic');
  fs.rmSync(dir, { recursive: true });
});

test('chooseModel: non-overlapping CI or clearly better wins, overlap keeps logistic, forced choice wins', () => {
  const mk = (b, ci, sb = b) => ({ temporal: { bss_persistence: b, bss_persistence_ci: ci }, spatial: { bss_persistence: sb } });
  const lg = mk(0.05, [0.03, 0.07]);
  assert.equal(chooseModel(lg, mk(0.09, [0.08, 0.10])).model, 'gbt'); // non-overlapping
  assert.equal(chooseModel(lg, mk(0.07, [0.055, 0.09])).model, 'gbt'); // clearly: +0.02, lower above logistic point
  assert.equal(chooseModel(lg, mk(0.06, [0.04, 0.08])).model, 'logistic'); // overlap, lower below point
  assert.equal(chooseModel(lg, mk(0.09, [0.08, 0.10], 0.0)).model, 'logistic'); // tile-blocked worse
  assert.equal(chooseModel(lg, mk(0.0, [-0.1, 0.1]), 'gbt').model, 'gbt');
});
