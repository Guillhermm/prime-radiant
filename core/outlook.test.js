import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anomaly1p, auc, bootstrapBss, brier, brierSkill, featuresAt, fitLogistic, lossAndGrad, outcome, predict, reliability, scoreSet,
} from './outlook.js';

test('anomaly1p is log1p of the ratio-like difference, 0 at the median', () => {
  assert.equal(anomaly1p(5, 5), 0);
  assert.ok(Math.abs(anomaly1p(Math.E - 1, 0)) - 1 < 1e-12);
});

test('outcome: above, not above, null for missing value or zero median', () => {
  assert.equal(outcome([null, 5], [null, 4], 1), 1);
  assert.equal(outcome([null, 4], [null, 4], 1), 0);
  assert.equal(outcome([null, 3], [null, 0], 1), null);
  assert.equal(outcome([null, null], [null, 4], 1), null);
  assert.equal(outcome([null, 3], [null, null], 1), null);
});

test('featuresAt builds the six features by hand and refuses missing inputs', () => {
  const n = 14;
  const values = new Array(n).fill(2);
  const medians = new Array(n).fill(2);
  values[11] = 5; medians[11] = 2; // this month t = 11
  values[0] = 8; medians[0] = 2; // target t+1 = 12, a year before = index 0 (t - 11)
  const x = featuresAt(values, medians, 11, 1);
  const a = Math.log1p(5) - Math.log1p(2);
  assert.equal(x.length, 6);
  assert.ok(Math.abs(x[0] - a) < 1e-12);
  assert.ok(Math.abs(x[1] - a / 3) < 1e-12); // the two months before are at their median
  assert.ok(Math.abs(x[2] - 0.5) < 1e-12 && Math.abs(x[3] - Math.sqrt(3) / 2) < 1e-12); // month 1: sin 30 deg
  assert.ok(Math.abs(x[4] - Math.log1p(2)) < 1e-12);
  assert.ok(Math.abs(x[5] - (Math.log1p(8) - Math.log1p(2))) < 1e-12);
  assert.equal(featuresAt(values.map((v, i) => (i === 10 ? null : v)), medians, 11, 1), null);
  assert.equal(featuresAt(values, medians.map((m, i) => (i === 12 ? 0 : m)), 11, 1)[4], 0); // median 0: forecast, labeled no-skill later
  assert.equal(featuresAt(values, medians.map((m, i) => (i === 12 ? null : m)), 11, 1), null);
  assert.equal(featuresAt(values, medians, 5, 1), null); // no year-before month
});

test('lossAndGrad matches a numerical gradient', () => {
  const X = [[0.5, -1], [1.5, 0.2], [-0.7, 0.9], [0.1, 0.1]];
  const y = [1, 0, 1, 0];
  const w = [0.3, -0.2], b = 0.1, l2 = 0.05;
  const { gw, gb } = lossAndGrad(w, b, X, y, l2);
  const h = 1e-6;
  for (let j = 0; j < 2; j++) {
    const up = w.slice(); up[j] += h; const dn = w.slice(); dn[j] -= h;
    const num = (lossAndGrad(up, b, X, y, l2).loss - lossAndGrad(dn, b, X, y, l2).loss) / (2 * h);
    assert.ok(Math.abs(num - gw[j]) < 1e-6);
  }
  const num = (lossAndGrad(w, b + h, X, y, l2).loss - lossAndGrad(w, b - h, X, y, l2).loss) / (2 * h);
  assert.ok(Math.abs(num - gb) < 1e-6);
});

test('fitLogistic separates toy data and is deterministic', () => {
  const X = [[-2], [-1.5], [-1], [1], [1.5], [2]];
  const y = [0, 0, 0, 1, 1, 1];
  const m = fitLogistic(X, y);
  assert.ok(predict(m, [-2]) < 0.1 && predict(m, [2]) > 0.9);
  assert.ok(m.weights[0] > 0);
  assert.deepEqual(fitLogistic(X, y), m);
});

test('scores by hand: brier, skill, auc with ties, reliability bins', () => {
  assert.equal(brier([1, 0, 0.5], [1, 0, 1]), 0.25 / 3);
  assert.equal(brierSkill(0.1, 0.2), 0.5);
  assert.equal(brierSkill(0.1, 0), null);
  assert.equal(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]), 0.75);
  assert.equal(auc([0.5, 0.5], [0, 1]), 0.5);
  assert.equal(auc([0.5, 0.6], [1, 1]), null);
  const r = reliability([0.05, 0.05, 0.95, 1], [0, 1, 1, 1]);
  assert.equal(r.length, 10);
  assert.deepEqual([r[0].n, r[0].observed, r[9].n, r[9].observed], [2, 0.5, 2, 1]);
  assert.equal(r[4].meanP, null);
  const sc = scoreSet({ p: [0.9, 0.1, 0.8, 0.2], constant: [0.5, 0.5, 0.5, 0.5], persist: [0.6, 0.4, 0.6, 0.4], y: [1, 0, 1, 0], block: ['a', 'a', 'b', 'b'] });
  assert.ok(sc.bss_constant > 0 && sc.bss_persistence > 0);
  assert.ok(Math.abs(sc.bss_constant - (1 - 0.025 / 0.25)) < 1e-12);
  assert.ok(sc.bss_constant_ci[0] <= sc.bss_constant_ci[1]);
});

test('bootstrapBss (crossed) is seeded and collapses on identical blocks', () => {
  const blocks = [['a', 1], ['a', 2], ['b', 1], ['b', 2]].map(([tile, year]) => ({ tile, year, sm: 1, sc: 2, sp: 4 }));
  const a = bootstrapBss(blocks, { draws: 50 });
  assert.deepEqual(a, bootstrapBss(blocks, { draws: 50 }));
  assert.deepEqual(a.constant, [0.5, 0.5]);
  assert.deepEqual(a.persistence, [0.75, 0.75]);
});

import { bootstrapPairedDiff, cellLat, FEATURES_ENSO, ninoAt } from './outlook.js';
import { applyPlatt, fitPlatt } from './outlook-gbt.js';

test('ninoAt reads month t and t-3 only; a later month never changes it', () => {
  const s = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const a = ninoAt(s, 4);
  assert.deepEqual([a.nino, a.lag3, a.fallback], [0.5, 0.2, false]);
  const later = s.slice(); later[5] = 9; later[6] = -9;
  assert.deepEqual(ninoAt(later, 4), a); // t+1 and t+2 are ignored
  assert.equal(ninoAt(s, 2), null); // t-3 before the series
});

test('ninoAt falls back to the latest available month and says so', () => {
  const s = [0.1, 0.2, 0.3, 0.4, null, null];
  const a = ninoAt(s, 5);
  assert.equal(a.nino, 0.4); assert.equal(a.usedT, 3); assert.equal(a.fallback, true);
  assert.equal(a.lag3, 0.3); assert.equal(a.usedLag, 2); // t-3 = 2 is present
  assert.equal(ninoAt([null, null, null, null], 3), null);
});

test('cellLat is the center of the 1 deg cell', () => {
  assert.equal(cellLat('x10y8', 0), -10 + 0.5 - 0); // ty 8 -> 80-90 = -10, row 0
  assert.equal(cellLat('x10y8', 37), -10 + 3 + 0.5);
  assert.equal(FEATURES_ENSO.length, 10);
});

test('fitPlatt recovers a known miscalibration and is the identity on calibrated scores', () => {
  const build = (a, b) => {
    const z = [], y = [];
    for (let k = -8; k <= 8; k++) {
      const zz = k / 2, p = 1 / (1 + Math.exp(-(a * zz + b)));
      const ones = Math.round(p * 1000);
      for (let i = 0; i < 1000; i++) { z.push(zz); y.push(i < ones ? 1 : 0); }
    }
    return { z, y };
  };
  const m = build(0.5, 0.8);
  const f = fitPlatt(m.z, m.y);
  assert.ok(Math.abs(f.a - 0.5) < 0.02 && Math.abs(f.b - 0.8) < 0.02, JSON.stringify(f));
  const id = build(1, 0), g = fitPlatt(id.z, id.y);
  assert.ok(Math.abs(g.a - 1) < 0.02 && Math.abs(g.b) < 0.02);
  assert.ok(Math.abs(applyPlatt({ a: 1, b: 0 }, 0) - 0.5) < 1e-12);
  assert.deepEqual(fitPlatt(m.z, m.y), f); // deterministic
});

test('bootstrapPairedDiff: a consistent improvement has an interval below 0, a null one straddles it, seeded', () => {
  const blocks = [];
  for (const tile of ['a', 'b', 'c', 'd']) for (const year of ['2022', '2023', '2024']) blocks.push({ tile, year, d: -0.01 * 10 + ((tile + year).length % 2) * 0.001, n: 10 });
  const r = bootstrapPairedDiff(blocks);
  assert.ok(r.diff < 0 && r.ci[1] < 0);
  assert.deepEqual(bootstrapPairedDiff(blocks), r);
  const nul = blocks.map((b, i) => ({ ...b, d: i % 2 ? 0.2 : -0.2 }));
  const z = bootstrapPairedDiff(nul);
  assert.ok(z.ci[0] < 0 && z.ci[1] > 0);
});
