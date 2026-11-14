// Stand-ins for core/anomaly.js (M2-K1) and core/live.js (M3), used only with ?preview=1 so the
// anomaly and live views can be reviewed before core delivers. Not validated by the Second
// Foundation: the numbers are a rendering aid, never a result.
const pad = (n) => String(n).padStart(2, '0');
export const PREVIEW_NOTE = 'Preview: placeholder anomaly and live numbers, not validated.';
export const PREVIEW_MIN_YEARS = 9;
export const PREVIEW_FLAG_RANK = 0.9;

/** Percentile rank with ties split evenly; null without a value or with fewer than `minYears` others. */
export const previewRank = (value, others, minYears = PREVIEW_MIN_YEARS) => {
  const pool = others.filter((v) => typeof v === 'number');
  if (typeof value !== 'number' || pool.length < minYears) return null;
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  return (below + equal / 2) / pool.length;
};

/** Anomaly Series (see anomaly-layer.js for the contract) from calendar cells sorted any way. */
export const previewAnomaly = (cells) => {
  if (!cells.length) return null;
  const key = (c) => c.year * 12 + c.month - 1;
  const first = Math.min(...cells.map(key));
  const last = Math.max(...cells.map(key));
  const values = Array(last - first + 1).fill(null);
  const flags = Array(values.length).fill(false);
  for (const c of cells) {
    const others = cells.filter((o) => o.month === c.month && o.year !== c.year).map((o) => o.value);
    const rank = previewRank(c.value, others);
    values[key(c) - first] = rank;
    flags[key(c) - first] = rank !== null && rank >= PREVIEW_FLAG_RANK;
  }
  const start = `${Math.floor(first / 12)}-${pad((first % 12) + 1)}`.padStart(7, '0');
  return { id: 'anomaly', unit: 'fire-cell-days', start, values, flags, method: { id: 'preview', version: '0' }, comparable: true };
};

export const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
};

/** Live view input (see live-view.js for the contract): last 12 months against earlier years. */
export const previewLive = (cells, now = new Date()) => {
  const key = (c) => c.year * 12 + c.month - 1;
  const sorted = [...cells].sort((a, b) => key(a) - key(b));
  const season = sorted.slice(-12);
  if (!season.length) return null;
  const band = { p25: [], median: [], p75: [] };
  for (const c of season) {
    const past = sorted.filter((o) => o.month === c.month && o.year < c.year && o.value !== null).map((o) => o.value).sort((a, b) => a - b);
    band.p25.push(quantile(past, 0.25));
    band.median.push(quantile(past, 0.5));
    band.p75.push(quantile(past, 0.75));
  }
  const f = season[0];
  return {
    fetched_at: now.toISOString(),
    live: { id: 'live', unit: 'fire-cell-days', comparable: false, step: 'month', start: `${f.year}-${pad(f.month)}`, values: season.map((c) => c.value), method: { id: 'preview', version: '0' } },
    band,
    provisional: true,
  };
};
