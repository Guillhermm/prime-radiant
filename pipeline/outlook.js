/**
 * Fire outlook CLI (experimental, method.md section 7): train and validate the logistic model on a
 * build's 1 deg tiles, then write next-month predictions as small tiles.
 *   node pipeline/outlook.js --data data/brazil [--live data/live] --out data/outlook [--model-out core/data/outlook-model.json]
 * With --live, complete months after the archive's VIIRS (NOAA-20 x K from the live tiles, type-0 share,
 * missing days scaled by the daily share) extend the series, so the target is the month after the
 * latest complete month. Output: <out>/manifest.json, <out>/report.json,
 * <out>/tiles/<id>.json = {target_month, last_observed_month, issued_at, based_on_data_to, cell[], p[], no_skill[]}. Deterministic; no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { baseline, KNOWN_PARTIAL_MONTHS } from '../core/baseline.js';
import { addMonths, monthIndex } from '../core/months.js';
import { coverageLookup } from '../core/tiles.js';
import { fitGbt, chooseRounds, predictGbt } from '../core/outlook-gbt.js';
import { parseTileId } from '../core/grid.js';
import { FEATURES_GBT, neighborAnomaly, FEATURES, OUTLOOK_METHOD, featuresAt, fitLogistic, outcome, predict, scoreSet } from '../core/outlook.js';

const FOLDS = 5;
/** Cells whose target median is at most this carry `no-skill` (gate V4 O2). */
export const NO_SKILL_MEDIAN = 1;
/** A live month with more than this share of its days missing is not usable (as core/live.js). */
const MAX_MISSING = 1 / 3;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const dayNum = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const coreData = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'core', 'data');
const round = (x, d = 4) => (x === null || x === undefined ? null : +x.toFixed(d));
const roundDeep = (o) => o && JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? round(v, 4) : v)));

/** 1 deg cell of a 0.1 deg cell id inside the same 10 deg tile (as write-tiles coarsen). */
const coarseCell = (c) => Math.floor(c / 100 / 10) * 10 + Math.floor((c % 100) / 10);

/**
 * Monthly NOAA-20 x K values per 1 deg cell from the live tiles, for months fully inside the live
 * period (last day before the fetch day). Per month: counted days are in NOAA-20 coverage and not
 * partial; a month with more than a third of its days missing is unusable; the sum of counted days x
 * K x type-0 share is divided by the daily-share increments of the counted days, so a month with gaps
 * is scaled to a whole month (core/live.js method). Absent rows on a counted day are 0.
 * @returns {{months: Map<number, Map<string, number>>, list: {month: string, counted: number, days: number, usable: boolean}[]}}
 */
export function liveMonths(liveDir, manifest, K, share, type0) {
  const lm = readJson(path.join(liveDir, 'manifest.json'));
  const d0 = dayNum(lm.day0), last = dayNum(lm.last_day);
  const fetchDay = dayNum(String(lm.fetched_at).slice(0, 10));
  const cov = lm.coverage?.noaa20;
  const partial = new Set(lm.partial_days?.noaa20 ?? []);
  const counted = (d) => Array.isArray(cov) && d >= cov[0] && d <= cov[1] && !partial.has(d);
  const inc = (mo, dom) => share[mo - 1][dom - 1] - (dom > 1 ? share[mo - 1][dom - 2] : 0);
  const sums = new Map(); // "YYYY-MM" -> Map cellKey -> sum
  const info = new Map();
  for (let d = d0; d <= last; d++) {
    const day = dayStr(d), ym = day.slice(0, 7);
    if (!info.has(ym)) info.set(ym, { month: ym, days: new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate(), counted: 0, frac: 0, lastDay: null });
    const e = info.get(ym);
    e.lastDay = day;
    if (d < fetchDay && counted(day)) { e.counted++; e.frac += inc(+ym.slice(5), +day.slice(8)); }
  }
  const usable = new Map();
  for (const e of info.values()) {
    const whole = e.lastDay === dayStr(Date.UTC(+e.month.slice(0, 4), +e.month.slice(5), 0) / 864e5) && dayNum(e.lastDay) < fetchDay;
    e.usable = whole && e.counted > 0 && e.days - e.counted <= e.days * MAX_MISSING;
    if (e.usable) { usable.set(e.month, e); sums.set(e.month, new Map()); }
  }
  for (const tile of lm.tiles) {
    const t = readJson(path.join(liveDir, 'tiles', '0.1', `${tile}.json`));
    t.cell.forEach((c, i) => {
      const day = dayStr(d0 + t.day[i]), ym = day.slice(0, 7);
      const v = t.noaa20[i];
      if (!sums.has(ym) || v === null || !counted(day) || dayNum(day) >= fetchDay) return;
      const key = `${tile}:${coarseCell(c)}`;
      const m = sums.get(ym);
      m.set(key, (m.get(key) ?? 0) + v);
    });
  }
  const months = new Map();
  for (const [ym, m] of sums) {
    const e = usable.get(ym);
    const scale = (K * (Number.isFinite(type0?.[+ym.slice(5) - 1]) ? type0[+ym.slice(5) - 1] : 1)) / e.frac;
    months.set(monthIndex(ym) - monthIndex(manifest.month0), new Map([...m].map(([k, v]) => [k, v * scale])));
  }
  return { months, list: [...info.values()].map(({ month, counted: c, days, usable: u }) => ({ month, counted: c, days, usable: u })), fetchedAt: lm.fetched_at };
}

/**
 * Harmonized-equivalent monthly series per 1 deg cell: S-NPP as observed, else NOAA-20 x K, else
 * null (MODIS is not used). A month partial for the supplying sensor is null. K = sum(S-NPP) /
 * sum(NOAA-20) over months both sensors operated and neither is partial (method.md 4.4, one
 * scalar for the whole build). With `liveDir`, usable live months after the archive fill the nulls.
 */
export function loadCells(dataDir, { liveDir = null } = {}) {
  const manifest = readJson(path.join(dataDir, 'manifest.json'));
  const cov = coverageLookup(manifest);
  const n0 = monthIndex(manifest.last_month) - monthIndex(manifest.month0) + 1;
  const pv = new Set([...KNOWN_PARTIAL_MONTHS, ...(manifest.partial_months?.viirs ?? [])]);
  const pn = new Set([...KNOWN_PARTIAL_MONTHS, ...(manifest.partial_months?.noaa20 ?? [])]);
  const ym = (i) => addMonths(manifest.month0, i);
  const raw = [];
  for (const tile of manifest.tiles) {
    const t = readJson(path.join(dataDir, 'tiles', '1', `${tile}.json`));
    const byCell = new Map();
    t.cell.forEach((c, i) => {
      if (!byCell.has(c)) byCell.set(c, { tile, cell: c, v: new Array(n0).fill(null), n: new Array(n0).fill(null) });
      const e = byCell.get(c);
      if (t.month[i] < n0) { e.v[t.month[i]] = t.viirs[i]; e.n[t.month[i]] = t.noaa20[i]; }
    });
    raw.push(...byCell.values());
  }
  // Sparse rows: inside coverage a missing row is 0, outside it is null.
  for (const e of raw) {
    for (let i = 0; i < n0; i++) {
      if (cov('viirs', i) && e.v[i] === null) e.v[i] = 0;
      if (cov('noaa20', i) && e.n[i] === null) e.n[i] = 0;
    }
  }
  let sv = 0, sn = 0;
  for (let i = 0; i < n0; i++) {
    if (!cov('viirs', i) || !cov('noaa20', i) || pv.has(ym(i)) || pn.has(ym(i))) continue;
    for (const e of raw) { sv += e.v[i]; sn += e.n[i]; }
  }
  const K = sn > 0 ? sv / sn : null;
  let live = null;
  if (liveDir) {
    const share = readJson(path.join(coreData, 'daily-share.json')).share;
    const type0 = readJson(path.join(coreData, 'type0-share.json')).share;
    live = liveMonths(liveDir, manifest, K, share, type0);
  }
  const n = Math.max(n0, ...(live ? [...live.months.keys()].map((i) => i + 1) : []));
  const cells = raw.map((e) => {
    const values = new Array(n + 1).fill(null);
    for (let i = 0; i < n0; i++) {
      if (cov('viirs', i) && !pv.has(ym(i))) values[i] = e.v[i];
      else if (K !== null && cov('noaa20', i) && !pn.has(ym(i))) values[i] = e.n[i] * K;
    }
    for (const [i, m] of live?.months ?? []) if (values[i] === null) values[i] = m.get(`${e.tile}:${e.cell}`) ?? 0;
    return { tile: e.tile, cell: e.cell, values };
  });
  return { manifest, n, K, cells, live };
}

const yearOf = (month0, T) => addMonths(month0, T).slice(0, 4);

/**
 * Samples of every cell: features at t for target T = t+1, with outcome, median, and the
 * `above` flag of persistence. `zeroT` lists the months where a cell had a value but a median of 0
 * (no outcome: no-skill cells).
 */
export function buildSamples(cells, month0) {
  const samples = [];
  const forecast = [];
  const zeroT = [];
  let last = -1;
  for (const c of cells) c.values.forEach((v, i) => { if (v !== null && i > last) last = i; });
  const gxy = (c) => { const { tx, ty } = parseTileId(c.tile); return [tx * 10 + (c.cell % 10), ty * 10 + Math.floor(c.cell / 10)]; };
  const at = new Map();
  for (const c of cells) {
    c.medians = baseline({ start: month0, values: c.values }).series.values;
    const [X, Y] = gxy(c);
    at.set(`${X},${Y}`, c);
  }
  for (const c of cells) {
    const medians = c.medians;
    const [X, Y] = gxy(c);
    const nbrs = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const o = (dx || dy) && at.get(`${X + dx},${Y + dy}`);
      if (o) nbrs.push(o);
    }
    for (let T = 1; T <= last + 1; T++) {
      const mo = Number(addMonths(month0, T).slice(5));
      const y = outcome(c.values, medians, T);
      const x = featuresAt(c.values, medians, T - 1, mo);
      if (x) {
        const xg = [...x, neighborAnomaly(nbrs, T - 1)];
        if (y !== null) samples.push({ tile: c.tile, cell: c.cell, T, x, xg, y, med: medians[T], above: x[0] > 0 ? 1 : 0 });
        if (T === last + 1) forecast.push({ tile: c.tile, cell: c.cell, x, xg, med: medians[T] });
      }
      if (x && c.values[T] !== null && medians[T] === 0) zeroT.push(T);
    }
  }
  return { samples, forecast, zeroT, lastMonth: addMonths(month0, last) };
}

const col = (rows, k) => rows.map((r) => r[k]);
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** Constant base rate and calibrated persistence P(above next | above now), fit on training samples. */
export function calibrate(train) {
  const c = mean(col(train, 'y'));
  const rate = (a) => { const r = train.filter((s) => s.above === a); return r.length ? mean(col(r, 'y')) : c; };
  return { constant: c, persistence: [rate(0), rate(1)] };
}

/** Gradient-boosted settings: depth 3, lr 0.1; rounds chosen on the last training year (training period only). */
export const GBT_OPTS = { depth: 3, lr: 0.1, bins: 32, lambda: 1, minLeaf: 20 };

/**
 * A model kind turns training samples into a scorer. `logistic` uses the six features, `gbt` the
 * seven (with the neighbour anomaly) and picks its rounds on the last calendar year of the training
 * samples, then refits on all of them.
 */
export function fitKind(kind, train, month0, fixedRounds = null) {
  if (kind === 'logistic') {
    const m = fitLogistic(col(train, 'x'), col(train, 'y'), {});
    return { model: m, score: (s) => predict(m, s.x) };
  }
  let rounds = fixedRounds, valLoss = null;
  if (rounds === null) {
    const lastYear = Math.max(...train.map((s) => +yearOf(month0, s.T)));
    const tr = train.filter((s) => +yearOf(month0, s.T) < lastYear), va = train.filter((s) => +yearOf(month0, s.T) === lastYear);
    ({ rounds, loss: valLoss } = chooseRounds({ X: col(tr, 'xg'), y: col(tr, 'y') }, { X: col(va, 'xg'), y: col(va, 'y') }, GBT_OPTS));
  }
  const m = { ...fitGbt(col(train, 'xg'), col(train, 'y'), { ...GBT_OPTS, rounds }), rounds, validation_log_loss: valLoss };
  return { model: m, score: (s) => predictGbt(m, s.xg) };
}

function evaluate(fit, ref, test, month0) {
  return scoreSet({
    p: test.map(fit.score), constant: test.map(() => ref.constant),
    persist: test.map((s) => ref.persistence[s.above]), y: col(test, 'y'),
    block: test.map((s) => `${s.tile}|${yearOf(month0, s.T)}`),
  });
}

/**
 * Train on targets <= trainTo, test on targets in [testFrom, testTo]; plus 5-fold tile blocking.
 * The headline skill counts test samples whose target median is above NO_SKILL_MEDIAN; the share left out is reported.
 * `kind` is `logistic` or `gbt`.
 */
export function trainAndValidate(samples, zeroT, month0, { trainTo = '2020-12', testFrom = '2022-01', testTo = '2025-12', kind = 'logistic' } = {}) {
  const [a, b, c] = [trainTo, testFrom, testTo].map(monthIndex).map((m) => m - monthIndex(month0));
  const train = samples.filter((s) => s.T <= a);
  const test = samples.filter((s) => s.T >= b && s.T <= c);
  if (!train.length || !test.length) throw new Error(`no samples: train ${train.length}, test ${test.length}`);
  const fit = fitKind(kind, train, month0);
  const model = fit.model;
  const ref = calibrate(train);
  const head = test.filter((s) => s.med > NO_SKILL_MEDIAN);
  const low = test.filter((s) => s.med <= NO_SKILL_MEDIAN);
  const tiles = [...new Set(samples.map((s) => s.tile))].sort();
  const blocked = (set) => {
    const folded = [];
    for (let f = 0; f < FOLDS; f++) {
      const held = new Set(tiles.filter((_, i) => i % FOLDS === f));
      const tr = train.filter((s) => !held.has(s.tile));
      const te = set.filter((s) => held.has(s.tile));
      if (!tr.length || !te.length) continue;
      const ft = fitKind(kind, tr, month0, kind === 'gbt' ? model.rounds : null);
      const r = calibrate(tr);
      for (const s of te) folded.push({ s, p: ft.score(s), r });
    }
    return folded.length ? { folds: FOLDS, ...scoreSet({
      p: folded.map((f) => f.p), constant: folded.map((f) => f.r.constant),
      persist: folded.map((f) => f.r.persistence[f.s.above]), y: folded.map((f) => f.s.y),
      block: folded.map((f) => `${f.s.tile}|${yearOf(month0, f.s.T)}`),
    }) } : null;
  };
  const zero = zeroT.filter((T) => T >= b && T <= c).length;
  return {
    kind, model, score: fit.score, ref, counts: { train: train.length, test: head.length, test_all: test.length, test_median_le_1: low.length, train_from: addMonths(month0, Math.min(...col(train, 'T'))), train_to: trainTo },
    no_skill_share_of_test: (zero + low.length) / (zero + test.length),
    no_skill_test: { median_0: zero, median_le_1: low.length, skill_cells_months: head.length },
    temporal: evaluate(fit, ref, head, month0),
    spatial: blocked(head),
    temporal_all: evaluate(fit, ref, test, month0), spatial_all: blocked(test),
    temporal_median_le_1: low.length ? evaluate(fit, ref, low, month0) : null,
  };
}

export const GBT_METHOD = { id: 'outlook-gbt', version: 1 };

/**
 * Decision rule for the default model (O-GBT). `choice` is `auto`, `logistic` or `gbt` (forced by --model).
 * Auto picks GBT only when, on the headline set (median above 1, time split), its BSS vs calibrated
 * persistence beats the logistic one with a non-overlapping 95% CI (GBT lower bound above the logistic
 * upper bound), or clearly better: higher point estimate by at least 0.01 and GBT lower bound above the
 * logistic point estimate; and the tile-blocked point estimate is not worse. Otherwise logistic stays.
 */
export function chooseModel(lg, gb, choice = 'auto') {
  const l = lg.temporal, g = gb.temporal;
  const ls = lg.spatial?.bss_persistence ?? -Infinity, gs = gb.spatial?.bss_persistence ?? -Infinity;
  const nonOverlap = g.bss_persistence_ci[0] > l.bss_persistence_ci[1];
  const clearly = g.bss_persistence - l.bss_persistence >= 0.01 && g.bss_persistence_ci[0] > l.bss_persistence;
  const better = (nonOverlap || clearly) && gs >= ls;
  const model = choice === 'auto' ? (better ? 'gbt' : 'logistic') : choice;
  return { model, requested: choice, rule: 'gbt if (CI lower > logistic CI upper or diff >= 0.01 with CI lower > logistic point) and tile-blocked not worse; BSS vs calibrated persistence, median above 1, time split',
    logistic_bss_persistence: round(l.bss_persistence), gbt_bss_persistence: round(g.bss_persistence), logistic_ci: l.bss_persistence_ci.map((x) => round(x)), gbt_ci: g.bss_persistence_ci.map((x) => round(x)),
    gbt_beats_logistic: better };
}

const skill = (s) => s && { n: s.n, brier: s.brier, brier_constant: s.brier_constant, brier_persistence_calibrated: s.brier_persistence_calibrated,
  bss_constant: s.bss_constant, bss_constant_ci: s.bss_constant_ci, bss_persistence: s.bss_persistence, bss_persistence_ci: s.bss_persistence_ci,
  auc: s.auc, auc_persistence: s.auc_persistence };

/**
 * Whole run: returns {manifest, report, model, tiles}; writes files when outDir is given.
 * `now` (default: the live fetch time, else the current time) decides forecast vs hindcast: the
 * output is a forecast only when the last observed month is the month before `now`'s month.
 */
export function runOutlook({ dataDir, liveDir = null, outDir, modelOut, now = null, issuedAt = null, command = 'node pipeline/outlook.js', model: choice = 'gbt', ...split }) {
  const { manifest, K, cells, live } = loadCells(dataDir, { liveDir });
  const { samples, forecast, zeroT, lastMonth } = buildSamples(cells, manifest.month0);
  const lg = trainAndValidate(samples, zeroT, manifest.month0, { ...split, kind: 'logistic' });
  const gb = trainAndValidate(samples, zeroT, manifest.month0, { ...split, kind: 'gbt' });
  const decision = chooseModel(lg, gb, choice);
  const v = decision.model === 'gbt' ? gb : lg;
  const target = addMonths(lastMonth, 1);
  const ref = new Date(now ?? live?.fetchedAt ?? Date.now());
  const complete = addMonths(ref.toISOString().slice(0, 7), -1);
  const mode = lastMonth === complete ? 'forecast' : 'hindcast';
  const rounded = (x) => x.map((r) => round(r, 6));
  const refs = { constant: round(v.ref.constant, 4), persistence_given_above: round(v.ref.persistence[1], 4), persistence_given_not_above: round(v.ref.persistence[0], 4) };
  const side = (r) => ({ temporal: skill(roundDeep(r.temporal)), spatial: skill(roundDeep(r.spatial)) });
  const common = { status: 'experimental', model: decision.model, trained: { from: v.counts.train_from, to: v.counts.train_to, samples: v.counts.train }, command, dataVersion: manifest.dataVersion,
    references: refs, metrics: side(v), decision, compared: { logistic: side(lg), gbt: side(gb) } };
  const model = decision.model === 'gbt'
    ? { method: GBT_METHOD, ...common, features: FEATURES_GBT, bias: round(v.model.bias, 6), lr: v.model.lr, depth: v.model.depth, rounds: v.model.rounds, validation_log_loss: round(v.model.validation_log_loss, 6),
      trees: JSON.parse(JSON.stringify(v.model.trees, (k, x) => (typeof x === 'number' ? round(x, 6) : x))) }
    : { method: OUTLOOK_METHOD, ...common, features: FEATURES, mean: rounded(v.model.mean), std: rounded(v.model.std), weights: rounded(v.model.weights), bias: round(v.model.bias, 6) };
  const report = { method: model.method, status: 'experimental', dataVersion: manifest.dataVersion, K: round(K, 4),
    test: { from: split.testFrom ?? '2022-01', to: split.testTo ?? '2025-12' }, counts: v.counts,
    no_skill_share_of_test: round(v.no_skill_share_of_test), no_skill_test: v.no_skill_test, references: model.references, model: decision.model, decision, compared: model.compared,
    gbt_full: decision.model === 'gbt' ? undefined : roundDeep({ temporal: gb.temporal, spatial: gb.spatial, temporal_all: gb.temporal_all, spatial_all: gb.spatial_all, temporal_median_le_1: gb.temporal_median_le_1, rounds: gb.model.rounds }),
    live_months: live?.list ?? null, temporal: roundDeep(v.temporal), spatial: roundDeep(v.spatial),
    temporal_all: roundDeep(v.temporal_all), spatial_all: roundDeep(v.spatial_all), temporal_median_le_1: roundDeep(v.temporal_median_le_1) };
  const issued = issuedAt ?? ref.toISOString();
  const through = dayStr(dayNum(`${addMonths(lastMonth, 1)}-01`) - 1);
  const stamp = { target_month: target, last_observed_month: lastMonth, issued_at: issued, based_on_data_to: through };
  const byTile = new Map();
  let sumP = 0, noSkill = 0;
  for (const f of forecast) {
    if (!byTile.has(f.tile)) byTile.set(f.tile, { ...stamp, cell: [], p: [], no_skill: [] });
    const t = byTile.get(f.tile);
    const p = round(v.score(f), 3);
    const ns = f.med > NO_SKILL_MEDIAN ? 0 : 1;
    t.cell.push(f.cell); t.p.push(p); t.no_skill.push(ns);
    sumP += p; noSkill += ns;
  }
  const outManifest = { schema: 1, status: 'experimental', mode, ...stamp,
    ...(mode === 'hindcast' ? { hindcast_note: `latest complete month is ${complete}; the newest data this output has is ${lastMonth}` } : {}),
    dataVersion: manifest.dataVersion, grid: { res: 1, tile_deg: 10 },
    tiles: [...byTile.keys()].sort(), cells: forecast.length, no_skill_cells: noSkill, no_skill_share: round(forecast.length ? noSkill / forecast.length : 0),
    model: decision.model, mean_p: round(forecast.length ? sumP / forecast.length : null), skill: model.metrics, no_skill_share_of_test: round(v.no_skill_share_of_test), method: model.method };
  if (outDir) {
    fs.mkdirSync(path.join(outDir, 'tiles'), { recursive: true });
    for (const [id, t] of byTile) fs.writeFileSync(path.join(outDir, 'tiles', `${id}.json`), `${JSON.stringify(t)}\n`);
    fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(outManifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({ ...stamp, mode, ...report }, null, 2)}\n`);
  }
  if (modelOut) fs.writeFileSync(modelOut, `${JSON.stringify(model, null, 2)}\n`);
  return { manifest: outManifest, report, model, tiles: byTile };
}

async function main() {
  const { values } = parseArgs({ options: { data: { type: 'string' }, live: { type: 'string' }, out: { type: 'string' }, 'model-out': { type: 'string' }, model: { type: 'string' } } });
  if (!values.data || !values.out) {
    console.error('usage: node pipeline/outlook.js --data <build dir> [--live <live dir>] --out <dir> [--model-out core/data/outlook-model.json]');
    process.exit(2);
  }
  const command = `node pipeline/outlook.js --data ${values.data}${values.live ? ` --live ${values.live}` : ''} --out ${values.out}${values['model-out'] ? ` --model-out ${values['model-out']}` : ''}${values.model ? ` --model ${values.model}` : ''}`;
  const { report, manifest } = runOutlook({ dataDir: values.data, liveDir: values.live, issuedAt: new Date().toISOString(), outDir: values.out, modelOut: values['model-out'], command, model: values.model ?? 'gbt' });
  const strip = (s) => s && { ...s, reliability: undefined };
  console.log(JSON.stringify({ model: report.model, decision: report.decision, compared: report.compared, mode: manifest.mode, target_month: manifest.target_month, last_observed_month: manifest.last_observed_month,
    cells: manifest.cells, mean_p: manifest.mean_p, no_skill_share: manifest.no_skill_share, no_skill_share_of_test: report.no_skill_share_of_test,
    counts: report.counts, references: report.references, live_months: report.live_months, temporal: strip(report.temporal), spatial: strip(report.spatial),
    temporal_all: strip(report.temporal_all), spatial_all: strip(report.spatial_all), temporal_median_le_1: strip(report.temporal_median_le_1) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
