// Stand-in for core/live.js (M3), used only with synthetic data or ?preview=1 so the live view can
// be reviewed before its science gate (V3). Not validated by the Second Foundation: the numbers are
// a rendering aid, never a result.
const pad = (n) => String(n).padStart(2, '0');

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
