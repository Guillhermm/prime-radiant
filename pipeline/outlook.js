/**
 * Fire outlook CLI (experimental, method.md section 7): train and validate the logistic model on a
 * build's 1 deg tiles, then write next-month predictions as small tiles.
 *   node pipeline/outlook.js --data data/brazil --out data/outlook [--model-out core/data/outlook-model.json]
 * Output: <out>/manifest.json (month, skill scores), <out>/report.json (full validation),
 * <out>/tiles/<id>.json = {cell: number[], p: number[]}. Deterministic; no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { baseline, KNOWN_PARTIAL_MONTHS } from '../core/baseline.js';
import { addMonths, monthIndex } from '../core/months.js';
import { coverageLookup } from '../core/tiles.js';
import {
  FEATURES, OUTLOOK_METHOD, anomaly1p, climatology, featuresAt, fitLogistic, outcome, predict, scoreSet,
} from '../core/outlook.js';

const FOLDS = 5;
const round = (x, d = 4) => (x === null ? null : +x.toFixed(d));

/**
 * Harmonized-equivalent monthly series per 1 deg cell: S-NPP as observed, else NOAA-20 x K, else
 * null (MODIS is not used). A month partial for the supplying sensor is null. K = sum(S-NPP) /
 * sum(NOAA-20) over months both sensors operated and neither is partial (method.md 4.4, one
 * scalar for the whole build).
 */
export function loadCells(dataDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
  const cov = coverageLookup(manifest);
  const n = monthIndex(manifest.last_month) - monthIndex(manifest.month0) + 1;
  const pv = new Set([...KNOWN_PARTIAL_MONTHS, ...(manifest.partial_months?.viirs ?? [])]);
  const pn = new Set([...KNOWN_PARTIAL_MONTHS, ...(manifest.partial_months?.noaa20 ?? [])]);
  const ym = (i) => addMonths(manifest.month0, i);
  const raw = [];
  for (const tile of manifest.tiles) {
    const t = JSON.parse(fs.readFileSync(path.join(dataDir, 'tiles', '1', `${tile}.json`), 'utf8'));
    const byCell = new Map();
    t.cell.forEach((c, i) => {
      if (!byCell.has(c)) byCell.set(c, { tile, cell: c, v: new Array(n).fill(null), n: new Array(n).fill(null) });
      const e = byCell.get(c);
      if (t.month[i] < n) { e.v[t.month[i]] = t.viirs[i]; e.n[t.month[i]] = t.noaa20[i]; }
    });
    raw.push(...byCell.values());
  }
  // Sparse rows: inside coverage a missing row is 0, outside it is null.
  for (const e of raw) {
    for (let i = 0; i < n; i++) {
      if (cov('viirs', i) && e.v[i] === null) e.v[i] = 0;
      if (cov('noaa20', i) && e.n[i] === null) e.n[i] = 0;
    }
  }
  let sv = 0, sn = 0;
  for (let i = 0; i < n; i++) {
    if (!cov('viirs', i) || !cov('noaa20', i) || pv.has(ym(i)) || pn.has(ym(i))) continue;
    for (const e of raw) { sv += e.v[i]; sn += e.n[i]; }
  }
  const K = sn > 0 ? sv / sn : null;
  const cells = raw.map((e) => {
    const values = new Array(n + 1).fill(null);
    for (let i = 0; i < n; i++) {
      if (cov('viirs', i) && !pv.has(ym(i))) values[i] = e.v[i];
      else if (K !== null && cov('noaa20', i) && !pn.has(ym(i))) values[i] = e.n[i] * K;
    }
    return { tile: e.tile, cell: e.cell, values };
  });
  return { manifest, n, K, cells };
}

/** Samples of every cell: features at t for target T = t+1, with outcome, persistence and climatology. */
export function buildSamples(cells, month0) {
  const samples = [];
  const forecast = [];
  let last = -1;
  for (const c of cells) c.values.forEach((v, i) => { if (v !== null && i > last) last = i; });
  for (const c of cells) {
    const medians = baseline({ start: month0, values: c.values }).series.values;
    const cnt = Array.from({ length: 12 }, () => ({ above: 0, years: 0 }));
    for (let T = 1; T <= last + 1; T++) {
      const mo = Number(addMonths(month0, T).slice(5));
      const clim = climatology(cnt[mo - 1].above, cnt[mo - 1].years);
      const y = outcome(c.values, medians, T);
      const x = featuresAt(c.values, medians, T - 1, mo);
      if (x) {
        if (y !== null) samples.push({ tile: c.tile, cell: c.cell, T, x, y, persist: x[0] > 0 ? 1 : 0, clim });
        if (T === last + 1) forecast.push({ tile: c.tile, cell: c.cell, x });
      }
      if (y !== null) { cnt[mo - 1].above += y; cnt[mo - 1].years++; }
    }
  }
  return { samples, forecast, lastMonth: addMonths(month0, last) };
}

const col = (rows, k) => rows.map((r) => r[k]);

function evaluate(model, test) {
  return scoreSet({ p: test.map((s) => predict(model, s.x)), clim: col(test, 'clim'), persist: col(test, 'persist'), y: col(test, 'y') });
}

/** Train on targets <= trainTo, test on targets in [testFrom, testTo]; plus 5-fold tile blocking. */
export function trainAndValidate(samples, month0, { trainTo = '2020-12', testFrom = '2022-01', testTo = '2025-12', fit = {} } = {}) {
  const [a, b, c] = [trainTo, testFrom, testTo].map(monthIndex).map((m) => m - monthIndex(month0));
  const train = samples.filter((s) => s.T <= a);
  const test = samples.filter((s) => s.T >= b && s.T <= c);
  if (!train.length || !test.length) throw new Error(`no samples: train ${train.length}, test ${test.length}`);
  const model = fitLogistic(col(train, 'x'), col(train, 'y'), fit);
  const tiles = [...new Set(samples.map((s) => s.tile))].sort();
  const folded = { x: [], y: [], p: [], clim: [], persist: [] };
  for (let f = 0; f < FOLDS; f++) {
    const held = new Set(tiles.filter((_, i) => i % FOLDS === f));
    const tr = train.filter((s) => !held.has(s.tile));
    const te = test.filter((s) => held.has(s.tile));
    if (!tr.length || !te.length) continue;
    const m = fitLogistic(col(tr, 'x'), col(tr, 'y'), fit);
    for (const s of te) {
      folded.p.push(predict(m, s.x)); folded.clim.push(s.clim); folded.persist.push(s.persist); folded.y.push(s.y);
    }
  }
  return {
    model, counts: { train: train.length, test: test.length },
    temporal: evaluate(model, test),
    spatial: folded.y.length ? { folds: FOLDS, ...scoreSet(folded) } : null,
  };
}

const roundScores = (s) => s && JSON.parse(JSON.stringify(s, (k, v) => (typeof v === 'number' ? round(v, 4) : v)));
const skill = (s) => s && { n: s.n, brier: s.brier, brier_climatology: s.brier_climatology, brier_persistence: s.brier_persistence,
  bss_climatology: s.bss_climatology, bss_persistence: s.bss_persistence, auc: s.auc, auc_climatology: s.auc_climatology, auc_persistence: s.auc_persistence };

/** Whole run: returns {manifest, report, model, tiles}; writes files when outDir is given. */
export function runOutlook({ dataDir, outDir, modelOut, command = 'node pipeline/outlook.js', ...split }) {
  const { manifest, K, cells } = loadCells(dataDir);
  const { samples, forecast, lastMonth } = buildSamples(cells, manifest.month0);
  const v = trainAndValidate(samples, manifest.month0, split);
  const month = addMonths(lastMonth, 1);
  const rounded = (x) => x.map((r) => round(r, 6));
  const model = {
    method: OUTLOOK_METHOD, status: 'experimental', features: FEATURES,
    mean: rounded(v.model.mean), std: rounded(v.model.std), weights: rounded(v.model.weights), bias: round(v.model.bias, 6),
    trained: { to: split.trainTo ?? '2020-12', samples: v.counts.train }, command, dataVersion: manifest.dataVersion,
    metrics: { temporal: skill(roundScores(v.temporal)), spatial: skill(roundScores(v.spatial)) },
  };
  const report = { method: OUTLOOK_METHOD, status: 'experimental', dataVersion: manifest.dataVersion, K: round(K, 4),
    test: { from: split.testFrom ?? '2022-01', to: split.testTo ?? '2025-12' }, counts: v.counts,
    temporal: roundScores(v.temporal), spatial: roundScores(v.spatial) };
  // Predict with the rounded coefficients the committed file carries.
  const byTile = new Map();
  for (const f of forecast) {
    if (!byTile.has(f.tile)) byTile.set(f.tile, { cell: [], p: [] });
    const t = byTile.get(f.tile);
    t.cell.push(f.cell); t.p.push(round(predict(model, f.x), 3));
  }
  const outManifest = { schema: 1, status: 'experimental', month, lastObservedMonth: lastMonth, dataVersion: manifest.dataVersion,
    generated_at: new Date().toISOString(), grid: { res: 1, tile_deg: 10 }, tiles: [...byTile.keys()].sort(),
    cells: forecast.length, skill: model.metrics, method: OUTLOOK_METHOD };
  if (outDir) {
    fs.mkdirSync(path.join(outDir, 'tiles'), { recursive: true });
    for (const [id, t] of byTile) fs.writeFileSync(path.join(outDir, 'tiles', `${id}.json`), `${JSON.stringify(t)}\n`);
    fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(outManifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (modelOut) fs.writeFileSync(modelOut, `${JSON.stringify(model, null, 2)}\n`);
  return { manifest: outManifest, report, model, tiles: byTile };
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string' }, out: { type: 'string' }, 'model-out': { type: 'string' } } });
  if (!values.data || !values.out) {
    console.error('usage: node pipeline/outlook.js --data <build dir> --out <dir> [--model-out core/data/outlook-model.json]');
    process.exit(2);
  }
  const command = `node pipeline/outlook.js --data ${values.data} --out ${values.out}${values['model-out'] ? ` --model-out ${values['model-out']}` : ''}`;
  const { report, manifest } = runOutlook({ dataDir: values.data, outDir: values.out, modelOut: values['model-out'], command });
  console.log(JSON.stringify({ month: manifest.month, cells: manifest.cells, counts: report.counts, temporal: { ...report.temporal, reliability: undefined },
    spatial: report.spatial && { ...report.spatial, reliability: undefined } }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
