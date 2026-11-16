/**
 * Gradient-boosted decision trees for binary log loss (method.md section 7), pure and deterministic:
 * no randomness, quantile-binned split candidates, Newton leaf values, shallow depth-wise trees.
 * A tree is `[feature, threshold, left, right]` (go left when x[feature] <= threshold) or a number (leaf).
 */
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Up to `bins` - 1 split thresholds per feature, midpoints between distinct sorted values. With at most
 * `bins` distinct values every gap is a candidate; otherwise one per quantile, placed after the quantile
 * value so ties never hide a boundary.
 */
export function quantileEdges(X, bins = 32) {
  const d = X[0].length;
  const edges = [];
  for (let j = 0; j < d; j++) {
    const v = X.map((r) => r[j]).sort((a, b) => a - b);
    const u = v.filter((x, i) => i === 0 || x > v[i - 1]);
    const cuts = new Set();
    if (u.length <= bins) for (let k = 1; k < u.length; k++) cuts.add((u[k - 1] + u[k]) / 2);
    else {
      for (let k = 1; k < bins; k++) {
        const q = v[Math.floor((k * v.length) / bins)];
        const nxt = u[u.indexOf(q) + 1];
        if (nxt !== undefined) cuts.add((q + nxt) / 2);
      }
    }
    edges.push([...cuts].sort((a, b) => a - b));
  }
  return edges;
}

const binOf = (edge, x) => { let k = 0; while (k < edge.length && x > edge[k]) k++; return k; };

function growTree(B, edges, g, h, rows, depth, { lambda, minLeaf, minGain }) {
  let G = 0, H = 0;
  for (const i of rows) { G += g[i]; H += h[i]; }
  const leaf = () => -G / (H + lambda);
  if (depth === 0 || rows.length < 2 * minLeaf) return leaf();
  let best = null;
  for (let j = 0; j < edges.length; j++) {
    const nb = edges[j].length + 1;
    if (nb < 2) continue;
    const hg = new Array(nb).fill(0), hh = new Array(nb).fill(0), hn = new Array(nb).fill(0);
    for (const i of rows) { const b = B[i][j]; hg[b] += g[i]; hh[b] += h[i]; hn[b]++; }
    let gl = 0, hl = 0, nl = 0;
    for (let b = 0; b < nb - 1; b++) {
      gl += hg[b]; hl += hh[b]; nl += hn[b];
      if (nl < minLeaf || rows.length - nl < minLeaf) continue;
      const gain = gl * gl / (hl + lambda) + (G - gl) ** 2 / (H - hl + lambda) - G * G / (H + lambda);
      if (gain > minGain && (!best || gain > best.gain)) best = { gain, j, b };
    }
  }
  if (!best) return leaf();
  const left = [], right = [];
  for (const i of rows) (B[i][best.j] <= best.b ? left : right).push(i);
  return [best.j, edges[best.j][best.b], growTree(B, edges, g, h, left, depth - 1, { lambda, minLeaf, minGain }), growTree(B, edges, g, h, right, depth - 1, { lambda, minLeaf, minGain })];
}

const walk = (t, x) => { while (Array.isArray(t)) t = x[t[0]] <= t[1] ? t[2] : t[3]; return t; };

/** Raw log-odds of a fitted model for one feature vector. */
export function logit(model, x, rounds = model.trees.length) {
  let z = model.bias;
  for (let k = 0; k < rounds; k++) z += model.lr * walk(model.trees[k], x);
  return z;
}

/** Probability for one feature vector, optionally using only the first `rounds` trees. */
export const predictGbt = (model, x, rounds) => sigmoid(logit(model, x, rounds));

/** Mean log loss of probabilities. */
export const logLoss = (p, y) => p.reduce((s, v, i) => s - (y[i] ? Math.log(Math.max(v, 1e-12)) : Math.log(Math.max(1 - v, 1e-12))), 0) / p.length;

/**
 * Fit boosted trees on rows X (arrays of numbers) with 0/1 labels y.
 * @returns {{bias: number, lr: number, depth: number, trees: Array}}
 */
export function fitGbt(X, y, { rounds = 100, depth = 3, lr = 0.1, bins = 32, lambda = 1, minLeaf = 20, minGain = 1e-9 } = {}) {
  const n = X.length;
  const base = Math.min(Math.max(y.reduce((s, v) => s + v, 0) / n, 1e-6), 1 - 1e-6);
  const bias = Math.log(base / (1 - base));
  const edges = quantileEdges(X, bins);
  const B = X.map((r) => r.map((v, j) => binOf(edges[j], v)));
  const z = new Array(n).fill(bias);
  const all = X.map((_, i) => i);
  const trees = [];
  for (let k = 0; k < rounds; k++) {
    const g = new Array(n), h = new Array(n);
    for (let i = 0; i < n; i++) { const p = sigmoid(z[i]); g[i] = p - y[i]; h[i] = Math.max(p * (1 - p), 1e-6); }
    const t = growTree(B, edges, g, h, all, depth, { lambda, minLeaf, minGain });
    trees.push(t);
    for (let i = 0; i < n; i++) z[i] += lr * walk(t, X[i]);
    if (!Array.isArray(t)) break; // no split left: more rounds change nothing useful
  }
  return { bias, lr, depth, trees };
}

/**
 * Number of rounds by validation log loss: fit `maxRounds` on `train`, score every prefix on `valid`,
 * return the best count (at least 1). Pass a validation slice taken from the training period only.
 */
export function chooseRounds(train, valid, opts = {}, maxRounds = 300) {
  const m = fitGbt(train.X, train.y, { ...opts, rounds: maxRounds });
  const z = valid.X.map(() => m.bias);
  let best = 1, bestLoss = Infinity;
  for (let k = 0; k < m.trees.length; k++) {
    const p = valid.X.map((x, i) => { z[i] += m.lr * walk(m.trees[k], x); return sigmoid(z[i]); });
    const l = logLoss(p, valid.y);
    if (l < bestLoss - 1e-9) { bestLoss = l; best = k + 1; }
  }
  return { rounds: best, loss: bestLoss };
}

/**
 * Platt scaling: p = sigmoid(a * z + b) on raw log-odds z, fit by Newton steps (zero-to-identity start,
 * fixed 25 iterations, tiny ridge on the Hessian): deterministic.
 * @returns {{a: number, b: number}}
 */
export function fitPlatt(z, y) {
  let a = 1, b = 0;
  for (let it = 0; it < 25; it++) {
    let ga = 0, gb = 0, haa = 1e-9, hab = 0, hbb = 1e-9;
    for (let i = 0; i < z.length; i++) {
      const p = sigmoid(a * z[i] + b), e = p - y[i], w = Math.max(p * (1 - p), 1e-9);
      ga += e * z[i]; gb += e; haa += w * z[i] * z[i]; hab += w * z[i]; hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-12)) break;
    a -= (hbb * ga - hab * gb) / det;
    b -= (haa * gb - hab * ga) / det;
  }
  return { a, b };
}

/** Calibrated probability from raw log-odds. */
export const applyPlatt = (cal, z) => sigmoid(cal.a * z + cal.b);
