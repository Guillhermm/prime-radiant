import { addMonths } from './months.js';
import { KNOWN_PARTIAL_MONTHS } from './baseline.js';

/** Method id of the harmonized series (method.md section 4). */
export const HARMONIZE_METHOD = { id: 'ratio-of-sums', version: 1 };
const UNIT = 'fire-cell-days';
/** First month of the Terra + Aqua era that is not partial (2002-07 is partial, method.md section 3). */
const FIRST_OVERLAP_MONTH = '2002-08';
/** First month of the MODIS x R scaling: 2002-07 (partial) is scaled, Terra-only months are not. */
const FIRST_SCALED_MONTH = '2002-07';
/** Last full month of S-NPP operation (ended 2026-11-02, method.md section 3). */
const SNPP_LAST_FULL_MONTH = '2026-10';
/** Default end of the R overlap window: before MODIS orbit drift (gate V1, decided by the humans). */
const DEFAULT_R_TO = '2021-12';
const MAX_HALF_WIDTH = 0.25;
const MIN_YEARS = 5;

/** Seeded mulberry32 generator, returns floats in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile p (0..1) of a sorted array, linear interpolation between ranks. */
function percentile(sorted, p) {
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const ratio = (n, d) => (d > 0 ? n / d : null);

/** CI and usability of one ratio from its point value, bootstrap draws and the count of years with den > 0. */
function summarize(value, draws, failed, nYears) {
  const sorted = draws.filter((x) => x !== null).sort((a, b) => a - b);
  const ci = value !== null && sorted.length ? [percentile(sorted, 0.025), percentile(sorted, 0.975)] : null;
  const usable = ci !== null && nYears >= MIN_YEARS && (ci[1] - ci[0]) / 2 <= MAX_HALF_WIDTH * value;
  return { value, ci, nYears, failedDraws: failed, usable };
}

/**
 * Ratio of sums num/den over `rows` ({year, mon 0..11, n, d}), annual and per calendar month,
 * with a CI from resampling whole years (seeded).
 */
function estimateRatio(rows, seed, nDraws) {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const byYear = new Map(years.map((y) => [y, { n: 0, d: 0, mn: Array(12).fill(0), md: Array(12).fill(0) }]));
  const tot = { n: 0, d: 0, mn: Array(12).fill(0), md: Array(12).fill(0) };
  const yearsWithDen = new Set();
  const monthYears = Array.from({ length: 12 }, () => new Set());
  for (const r of rows) {
    for (const t of [byYear.get(r.year), tot]) {
      t.n += r.n; t.d += r.d; t.mn[r.mon] += r.n; t.md[r.mon] += r.d;
    }
    if (r.d > 0) { yearsWithDen.add(r.year); monthYears[r.mon].add(r.year); }
  }
  const annualDraws = [];
  const monthDraws = Array.from({ length: 12 }, () => []);
  if (years.length) {
    const next = rng(seed);
    for (let b = 0; b < nDraws; b++) {
      const s = { n: 0, d: 0, mn: Array(12).fill(0), md: Array(12).fill(0) };
      for (let k = 0; k < years.length; k++) {
        const y = byYear.get(years[Math.floor(next() * years.length)]);
        s.n += y.n; s.d += y.d;
        for (let c = 0; c < 12; c++) { s.mn[c] += y.mn[c]; s.md[c] += y.md[c]; }
      }
      annualDraws.push(ratio(s.n, s.d));
      for (let c = 0; c < 12; c++) monthDraws[c].push(ratio(s.mn[c], s.md[c]));
    }
  }
  const failed = (xs) => xs.filter((x) => x === null).length;
  const annual = summarize(ratio(tot.n, tot.d), annualDraws, failed(annualDraws), yearsWithDen.size);
  const months = Array.from({ length: 12 }, (_, c) => ({
    month: c + 1,
    ...summarize(ratio(tot.mn[c], tot.md[c]), monthDraws[c], failed(monthDraws[c]), monthYears[c].size),
  }));
  return { annual, months };
}

/** Overlap rows of two series: both counts present, month eligible. */
function overlapRows(num, den, start, eligible) {
  const rows = [];
  for (let i = 0; i < num.length; i++) {
    const ym = addMonths(start, i);
    if (num[i] === null || den[i] === null || !eligible(ym)) continue;
    rows.push({ year: Number(ym.slice(0, 4)), mon: Number(ym.slice(5)) - 1, n: num[i], d: den[i] });
  }
  return rows;
}

/**
 * Pick the first level whose ratio passes the usability rule (4.2/4.3); else the last, low confidence.
 * Per-calendar-month ratios when all twelve pass, else the annual one.
 */
function chooseRatio(levels, numKey, denKey, eligible, seed, nDraws) {
  let chosen = null;
  for (const lv of levels) {
    const num = lv[numKey]; const den = lv[denKey];
    const { annual, months } = estimateRatio(overlapRows(num.values, den.values, num.start, eligible), seed, nDraws);
    const perMonth = months.every((m) => m.usable);
    chosen = { ...annual, level: lv.level, usable: perMonth || annual.usable, ...(perMonth ? { perMonth: months } : {}) };
    if (chosen.usable) break;
  }
  return chosen;
}

const inCoverage = (cov, ym) => Array.isArray(cov) && ym >= cov[0] && ym <= cov[1];
const flagKey = (f) => `${f.month}|${f.flag}`;

/**
 * Harmonize MODIS and VIIRS into one series (method.md section 4).
 *
 * `levels` is the fallback order of method.md 4.3, each `{level, modis, viirs, noaa20?}` of raw
 * Series on the same month span. R = sum(S-NPP) / sum(MODIS) over full overlap months; K =
 * sum(S-NPP) / sum(NOAA-20) over full overlap months (4.4). Each is taken from the first level
 * that is usable, else from the last, with usable false. The harmonized series is built from
 * the first level (the AOI itself): S-NPP as observed, MODIS x R before S-NPP (from 2002-07),
 * NOAA-20 x K after S-NPP ends (MODIS x R when NOAA-20 is null), estimated months flagged.
 * A month partial for S-NPP (outage) inside NOAA-20 coverage, not partial for NOAA-20, is NOAA-20 x K
 * (usable K only), flagged `estimated` and `viirs-outage-filled`; else it stays observed.
 * Terra-only months stay null, flagged `terra-only`. Months after the S-NPP archive ends but
 * while S-NPP still operated (through 2026-10) are estimated and flagged `viirs-not-archived`.
 * A series that applies a factor that is not usable carries `{month: null, flag: 'low-confidence'}`.
 *
 * @param {{level: import('./index.js').FallbackLevel, modis: object, viirs: object, noaa20?: object}[]} levels
 * @param {object} manifest validated manifest (coverage, partial_months)
 * @param {{seed?: number, draws?: number, rWindow?: {from?: string, to?: string}}} [opts] CI resampling seed and number of draws (default 1000); R overlap window, default 2002-08..2021-12 (K is unchanged). `R.window` records the window used.
 * @returns {{series: object, R: object, K: object|null, reasons: string[]}}
 */
export function harmonize(levels, manifest, { seed = 20260, draws = 1000, rWindow = {} } = {}) {
  const window = { from: rWindow.from ?? FIRST_OVERLAP_MONTH, to: rWindow.to ?? DEFAULT_R_TO };
  const base = levels[0];
  const start = base.modis.start;
  const len = base.modis.values.length;
  const reasons = [];
  const partial = (s) => new Set([...KNOWN_PARTIAL_MONTHS, ...(manifest.partial_months?.[s] ?? [])]);
  const pm = partial('modis'); const pv = partial('viirs'); const pn = partial('noaa20');
  const mk = (values, flags) => ({
    id: 'harmonized', unit: UNIT, start, values, ...(flags.length ? { flags } : {}),
    method: HARMONIZE_METHOD, comparable: true,
  });
  const inputFlags = [];
  const seen = new Set();
  for (const s of [base.modis, base.viirs, base.noaa20]) {
    for (const f of s?.flags ?? []) if (!seen.has(flagKey(f))) { seen.add(flagKey(f)); inputFlags.push(f); }
  }
  const empty = { window, value: null, ci: null, level: base.level, nYears: 0, failedDraws: 0, usable: false };
  if ([base.modis, base.viirs, base.noaa20].every((s) => !s || s.values.every((v) => v === null))) {
    const why = inputFlags.find((f) => f.flag === 'outside-domain') ? 'outside-domain' : 'no-data';
    return { series: mk(Array(len).fill(null), inputFlags), R: empty, K: null, reasons: [`all inputs are null (${why})`] };
  }

  const R = chooseRatio(levels, 'viirs', 'modis',
    (ym) => ym >= window.from && ym <= window.to && !pm.has(ym) && !pv.has(ym), seed, draws);
  R.window = window;
  const hasNoaa = levels.every((l) => l.noaa20);
  const K = hasNoaa ? chooseRatio(levels, 'viirs', 'noaa20', (ym) => !pv.has(ym) && !pn.has(ym), seed, draws) : null;
  if (!R.usable) reasons.push(`R not usable at any level, using ${R.level}: low confidence`);
  else if (R.level !== base.level) reasons.push(`R taken from fallback level ${R.level}`);
  if (R.value === null) reasons.push('R undefined: no MODIS detections in the overlap');
  if (K && !K.usable) reasons.push(`K not usable at any level, using ${K.level}: low confidence`);
  else if (K && K.level !== base.level) reasons.push(`K taken from fallback level ${K.level}`);

  const sStart = manifest.coverage?.viirs?.[0] ?? null;
  const sEnd = manifest.coverage?.viirs?.[1] ?? null;
  const factor = (est, ym) => (est.perMonth ? est.perMonth[Number(ym.slice(5)) - 1].value : est.value);
  const values = [];
  const flags = [...inputFlags];
  let lowConfidence = false;
  let notArchived = 0;
  const outageFilled = [];
  for (let i = 0; i < len; i++) {
    const ym = addMonths(start, i);
    const v = base.viirs.values[i];
    const m = base.modis.values[i];
    const n = base.noaa20?.values[i] ?? null;
    let out = null;
    let estimated = false;
    if (v !== null && pv.has(ym) && !pn.has(ym) && n !== null && K?.usable && factor(K, ym) !== null
      && inCoverage(manifest.coverage?.noaa20, ym)) {
      out = n * factor(K, ym); estimated = true; outageFilled.push(ym);
    } else if (v !== null) out = v;
    else if (sEnd !== null && ym > sEnd && n !== null && K && factor(K, ym) !== null) {
      out = n * factor(K, ym); estimated = true; lowConfidence ||= !K.usable;
    } else if (m !== null && ym >= FIRST_SCALED_MONTH && (sStart === null || ym < sStart || (sEnd !== null && ym > sEnd))
      && factor(R, ym) !== null) {
      out = m * factor(R, ym); estimated = true; lowConfidence ||= !R.usable;
    } else if (m !== null && ym < FIRST_SCALED_MONTH) flags.push({ month: ym, flag: 'terra-only' });
    values.push(out);
    if (estimated) flags.push({ month: ym, flag: 'estimated' });
    if (outageFilled.at(-1) === ym) flags.push({ month: ym, flag: 'viirs-outage-filled' });
    if (sEnd !== null && ym > sEnd && ym <= SNPP_LAST_FULL_MONTH && v === null) {
      flags.push({ month: ym, flag: 'viirs-not-archived' });
      notArchived++;
    }
  }
  if (notArchived) reasons.push(`S-NPP operated after ${sEnd} but ${notArchived} month(s) are not archived yet: estimated, not observed`);
  if (outageFilled.length) reasons.push(`${outageFilled.length} S-NPP outage month(s) supplied by NOAA-20 x K`);
  if (lowConfidence) flags.push({ month: null, flag: 'low-confidence' });
  return { series: mk(values, flags), R, K, reasons };
}
