import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRounds, fitGbt, logLoss, predictGbt, quantileEdges } from './outlook-gbt.js';
import { fitLogistic, predict, neighborAnomaly, anomaly1p } from './outlook.js';

// XOR on two features with unequal corner counts (a perfectly balanced XOR has zero gain at the root,
// where greedy trees stall): no linear model fits it.
const xor = () => {
  const X = [], y = [];
  for (const [a, b, n] of [[0, 0, 50], [0, 1, 40], [1, 0, 30], [1, 1, 45]]) for (let k = 0; k < n; k++) { X.push([a, b]); y.push(a ^ b); }
  return { X, y };
};

test('quantileEdges: midpoints between distinct values, none for a constant feature', () => {
  const e = quantileEdges([[0, 5], [1, 5], [0, 5], [1, 5]], 4);
  assert.deepEqual(e[0], [0.5]);
  assert.deepEqual(e[1], []);
});

test('a depth-2 boosted model fits XOR that logistic regression cannot', () => {
  const { X, y } = xor();
  const lg = fitLogistic(X, y);
  const lgLoss = logLoss(X.map((x) => predict(lg, x)), y);
  const m = fitGbt(X, y, { rounds: 100, depth: 2, lr: 0.3, minLeaf: 5 });
  const p = X.map((x) => predictGbt(m, x));
  assert.ok(lgLoss > 0.6, `logistic stays near chance: ${lgLoss}`);
  assert.ok(logLoss(p, y) < 0.2);
  assert.ok(predictGbt(m, [0, 1]) > 0.85 && predictGbt(m, [1, 1]) < 0.15);
});

test('a single depth-1 round splits at the hand-checked threshold and leaf values', () => {
  // x < 0.5 -> y 0 (4 rows), x > 0.5 -> y 1 (4 rows); base rate 0.5, bias 0
  const X = [[0], [0.1], [0.2], [0.3], [0.7], [0.8], [0.9], [1]], y = [0, 0, 0, 0, 1, 1, 1, 1];
  const m = fitGbt(X, y, { rounds: 1, depth: 1, lr: 1, bins: 8, minLeaf: 1, lambda: 0 });
  assert.equal(m.bias, 0);
  const [f, thr, left, right] = m.trees[0];
  assert.equal(f, 0);
  assert.ok(thr > 0.3 && thr < 0.7);
  // gradient p - y = +-0.5, hessian 0.25: leaf = -G/H = -(4 * 0.5)/(4 * 0.25) = -2 and +2
  assert.ok(Math.abs(left + 2) < 1e-9 && Math.abs(right - 2) < 1e-9);
});

test('fitGbt is deterministic and chooseRounds picks a prefix that does not overfit pure noise', () => {
  const { X, y } = xor();
  const a = fitGbt(X, y, { rounds: 20, depth: 2, minLeaf: 5 }), b = fitGbt(X, y, { rounds: 20, depth: 2, minLeaf: 5 });
  assert.deepEqual(a, b);
  const noise = { X: X.map((_, i) => [i % 7]), y: X.map((_, i) => (i * 7919) % 3 === 0 ? 1 : 0) };
  const valid = { X: noise.X.map((_, i) => [(i + 3) % 7]), y: noise.y.map((_, i) => ((i + 5) * 104729) % 2) };
  const r = chooseRounds(noise, valid, { depth: 2, minLeaf: 5 }, 40);
  assert.ok(r.rounds >= 1 && r.rounds <= 40 && Number.isFinite(r.loss));
});

test('neighborAnomaly averages month t only, skips missing neighbours, 0 when none', () => {
  const nb = [
    { values: [1, 5, 99], medians: [1, 2, 1] },
    { values: [1, 2, 99], medians: [1, 2, 1] },
    { values: [1, null, 99], medians: [1, 2, 1] },
  ];
  assert.ok(Math.abs(neighborAnomaly(nb, 1) - anomaly1p(5, 2) / 2) < 1e-12);
  assert.equal(neighborAnomaly([], 1), 0);
  assert.equal(neighborAnomaly([nb[2]], 1), 0);
});

test('no leakage: changing neighbour values after t does not change the feature at t', () => {
  const mk = (late) => [{ values: [3, 4, late, late], medians: [2, 2, 2, 2] }];
  assert.equal(neighborAnomaly(mk(0), 1), neighborAnomaly(mk(500), 1));
});
