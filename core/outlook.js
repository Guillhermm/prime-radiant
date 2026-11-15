/**
 * Fire outlook, experimental (method.md section 7). Pure functions: features per cell and month,
 * logistic regression, scores. Inputs are series of harmonized-equivalent fire-cell-days per 1 deg
 * cell (null = not available, never 0) and their baseline medians (core/baseline.js).
 */
export const OUTLOOK_METHOD = { id: 'outlook-logistic', version: 1 };
export const FEATURES = ['anomaly', 'anomaly-3m-mean', 'month-sin', 'month-cos', 'log1p-median-next', 'anomaly-prev-year'];

/** log1p ratio to the baseline median: log1p(v) - log1p(median). */
export const anomaly1p = (v, med) => Math.log1p(v) - Math.log1p(med);

const ok = (x) => x !== null && x !== undefined;

/**
 * Outcome at month index T: 1 when values[T] is above the baseline median, 0 when not, null when
 * the value or the median is missing or the median is 0 (then "above the median" only means
 * "any fire", and the cell is left out).
 */
export function outcome(values, medians, T) {
  if (!ok(values[T]) || !ok(medians[T]) || !(medians[T] > 0)) return null;
  return values[T] > medians[T] ? 1 : 0;
}

/**
 * Feature vector at month index t for the outlook of month t+1 (FEATURES order), or null when any
 * input is missing: this month and the two before need a value and a median, t+1 needs a median
 * > 0, and the same calendar month a year before the target (t-11) needs both.
 * `month` is the calendar month (1..12) of the target.
 */
export function featuresAt(values, medians, t, month) {
  const a = [];
  for (const k of [t, t - 1, t - 2]) {
    if (k < 0 || !ok(values[k]) || !ok(medians[k])) return null;
    a.push(anomaly1p(values[k], medians[k]));
  }
  const next = medians[t + 1];
  const p = t - 11;
  if (!ok(next) || !(next > 0) || p < 0 || !ok(values[p]) || !ok(medians[p])) return null;
  const ang = (2 * Math.PI * month) / 12;
  return [a[0], (a[0] + a[1] + a[2]) / 3, Math.sin(ang), Math.cos(ang), Math.log1p(next), anomaly1p(values[p], medians[p])];
}

export const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Mean log loss + 0.5 * l2 * |w|^2 (bias not penalized) and its gradient, on already standardized X. */
export function lossAndGrad(w, b, X, y, l2) {
  const n = X.length;
  const gw = new Array(w.length).fill(0);
  let gb = 0, loss = 0;
  for (let i = 0; i < n; i++) {
    let z = b;
    for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
    const p = sigmoid(z);
    loss -= y[i] ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12));
    const e = p - y[i];
    gb += e;
    for (let j = 0; j < w.length; j++) gw[j] += e * X[i][j];
  }
  let reg = 0;
  for (let j = 0; j < w.length; j++) { gw[j] = gw[j] / n + l2 * w[j]; reg += w[j] * w[j]; }
  return { loss: loss / n + 0.5 * l2 * reg, gw, gb: gb / n };
}

/**
 * Logistic regression by full-batch gradient descent with L2. Deterministic: zero start, fixed
 * iteration count, no randomness. Features are standardized with the training mean and std.
 * @returns {{mean: number[], std: number[], weights: number[], bias: number}}
 */
export function fitLogistic(X, y, { iters = 400, lr = 0.5, l2 = 1e-3 } = {}) {
  const d = X[0].length, n = X.length;
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const r of X) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  for (const r of X) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  let w = new Array(d).fill(0), b = 0;
  for (let it = 0; it < iters; it++) {
    const { gw, gb } = lossAndGrad(w, b, Z, y, l2);
    w = w.map((v, j) => v - lr * gw[j]);
    b -= lr * gb;
  }
  return { mean, std, weights: w, bias: b };
}

/** Probability of "above median" for one feature vector from a fitted or committed model. */
export function predict(model, x) {
  let z = model.bias;
  for (let j = 0; j < x.length; j++) z += model.weights[j] * ((x[j] - model.mean[j]) / model.std[j]);
  return sigmoid(z);
}

/** Mean squared error of probabilities against 0/1 outcomes. */
export function brier(p, y) {
  return p.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / p.length;
}

/** Brier skill score of a forecast against a reference: 1 - BS / BS_ref (positive = better). */
export const brierSkill = (bs, bsRef) => (bsRef > 0 ? 1 - bs / bsRef : null);

/** Area under the ROC curve (Mann-Whitney, ties count half); null with a single class. */
export function auc(p, y) {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const rank = new Array(p.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    for (let k = i; k <= j; k++) rank[idx[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  let pos = 0, sum = 0;
  y.forEach((v, i) => { if (v) { pos++; sum += rank[i]; } });
  const neg = y.length - pos;
  return pos && neg ? (sum - (pos * (pos + 1)) / 2) / (pos * neg) : null;
}

/** Reliability: `bins` equal-width probability bins with count, mean forecast and observed frequency. */
export function reliability(p, y, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, meanP: null, observed: null }));
  const sp = new Array(bins).fill(0), sy = new Array(bins).fill(0);
  p.forEach((v, i) => {
    const k = Math.min(bins - 1, Math.floor(v * bins));
    out[k].n++; sp[k] += v; sy[k] += y[i];
  });
  out.forEach((b, k) => { if (b.n) { b.meanP = sp[k] / b.n; b.observed = sy[k] / b.n; } });
  return out;
}

/** Scores of model, climatology and persistence on the same samples ({p, clim, persist, y} arrays). */
export function scoreSet({ p, clim, persist, y }) {
  const bs = brier(p, y), bc = brier(clim, y), bp = brier(persist, y);
  return {
    n: y.length, base_rate: y.reduce((s, v) => s + v, 0) / y.length,
    brier: bs, brier_climatology: bc, brier_persistence: bp,
    bss_climatology: brierSkill(bs, bc), bss_persistence: brierSkill(bs, bp),
    auc: auc(p, y), auc_climatology: auc(clim, y), auc_persistence: auc(persist, y),
    reliability: reliability(p, y),
  };
}

/** Climatology forecast: share of earlier years above the median, shrunk to 0.5 with 2 pseudo-years. */
export const climatology = (above, years) => (above + 1) / (years + 2);
