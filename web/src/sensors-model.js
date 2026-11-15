// Sensors view numbers. The harmonized series is core's output, the same one the Calendar shows.
// R is display math for the explanatory card only: docs/method.md section 4 (ratio of sums over
// the months both sensors report) without its threshold, fallback or interval, never applied to
// a plotted value, and shown as a Preview until the science team reviews it.

const pad = (n) => String(n).padStart(2, '0');
const idxOf = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const monthAt = (start, i) => {
  const k = idxOf(start) + i;
  return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`;
};
const num = (v) => typeof v === 'number';

/**
 * R = sum VIIRS / sum MODIS over the months where both report a value.
 * @returns {{r: number|null, months: number, withFire: number, from: string|null, to: string|null, modisSum: number, viirsSum: number}}
 */
export const overlapRatio = ({ modis, viirs }) => {
  let m = 0;
  let v = 0;
  let months = 0;
  let withFire = 0;
  let first = null;
  let last = null;
  modis.values.forEach((mv, i) => {
    const vv = viirs.values[i];
    if (!num(mv) || !num(vv)) return;
    months += 1;
    if (mv + vv > 0) withFire += 1;
    m += mv;
    v += vv;
    first ??= i;
    last = i;
  });
  return {
    r: m > 0 ? v / m : null, months, withFire, modisSum: m, viirsSum: v,
    from: first === null ? null : monthAt(modis.start, first), to: last === null ? null : monthAt(modis.start, last),
  };
};

const sourceOf = (h, mv, vv) => {
  if (!num(h)) return null;
  if (h === mv) return 'MODIS';
  if (h === vv) return 'VIIRS';
  return 'Adjusted by core';
};

/**
 * Per-month view of core's harmonized Series, aligned with the sensors. `source` names the
 * sensor whose count it carries; `estimated` comes from core when it marks months (the stub does not).
 */
export const fromCore = ({ modis, viirs }, harmonized) => {
  if (harmonized.start !== modis.start || harmonized.values.length !== modis.values.length) {
    throw new Error(`fromCore: harmonized ${harmonized.start}+${harmonized.values.length} does not align with sensors ${modis.start}+${modis.values.length}`);
  }
  return harmonized.values.map((v, i) => ({
    value: num(v) ? v : null, estimated: Boolean(harmonized.estimated?.[i]), source: sourceOf(v, modis.values[i], viirs.values[i]),
  }));
};

/** The busiest month MODIS saw alone, for the "how it is built" steps; null when there is none. */
export const exampleMonth = ({ modis, viirs }, r) => {
  let best = null;
  modis.values.forEach((mv, i) => {
    if (!num(mv) || num(viirs.values[i])) return;
    if (!best || mv > best.modis) best = { month: monthAt(modis.start, i), modis: mv };
  });
  return best && { ...best, scaled: r === null ? null : best.modis * r };
};

/**
 * Points for the chart and the table, by year or by month. A year sums its months; it is
 * estimated when any of its harmonized months is, and partial when a sensor has fewer than 12.
 */
export const sensorPoints = ({ modis, viirs }, harmonized, step = 'year') => {
  const months = modis.values.map((mv, i) => ({
    key: monthAt(modis.start, i), modis: mv, viirs: viirs.values[i], harmonized: harmonized[i].value, estimated: harmonized[i].estimated, sources: harmonized[i].source ? [harmonized[i].source] : [],
  }));
  if (step === 'month') return months.filter((p) => num(p.modis) || num(p.viirs));
  const years = new Map();
  for (const p of months) {
    const key = p.key.slice(0, 4);
    const y = years.get(key) ?? { key, modis: null, viirs: null, harmonized: null, estimated: false, sources: [], modisMonths: 0, viirsMonths: 0 };
    for (const src of p.sources) if (!y.sources.includes(src)) y.sources.push(src);
    if (num(p.modis)) { y.modis = (y.modis ?? 0) + p.modis; y.modisMonths += 1; }
    if (num(p.viirs)) { y.viirs = (y.viirs ?? 0) + p.viirs; y.viirsMonths += 1; }
    if (num(p.harmonized)) y.harmonized = (y.harmonized ?? 0) + p.harmonized;
    y.estimated ||= p.estimated;
    years.set(key, y);
  }
  return [...years.values()].filter((p) => num(p.modis) || num(p.viirs));
};

/** Everything the Sensors view shows, from the two sensor Series and core's harmonized Series of one range. */
export const sensorsSummary = (sensors, harmonizedSeries) => {
  const ratio = overlapRatio(sensors);
  const harmonized = fromCore(sensors, harmonizedSeries);
  let state = 'ok';
  if (ratio.months === 0) state = 'no-overlap';
  else if (ratio.r === null) state = 'no-fire';
  const ex = exampleMonth(sensors, ratio.r);
  // What the Calendar shows for the example month: core's harmonized value, whatever core did to it.
  const example = ex && { ...ex, core: harmonized[idxOf(ex.month) - idxOf(sensors.modis.start)].value };
  return { ratio, harmonized, state, example };
};

const cell = (v) => (num(v) ? String(Math.round(v * 100) / 100) : '');
const oneLine = (v) => String(v).replace(/[\r\n]+/g, ' ');

/** CSV text of the three monthly series with a Source column; `meta` adds "# key: value" lines. */
export const sensorsCsv = ({ modis, viirs }, harmonizedSeries, meta = {}) => {
  const { ratio, harmonized } = sensorsSummary({ modis, viirs }, harmonizedSeries);
  const method = harmonizedSeries.method ?? {};
  const head = {
    series: 'modis, viirs, harmonized',
    unit: 'fire-cell-days',
    harmonized: `core method ${[method.id ?? 'unknown', method.version].filter(Boolean).join(' ')}, the series the Calendar shows`,
    R: `${ratio.r === null ? 'not computed' : String(Math.round(ratio.r * 10000) / 10000)} (Preview, explanatory only, not applied to the harmonized column)`,
    ...meta,
  };
  const lines = Object.entries(head).map(([k, v]) => `# ${oneLine(k)}: ${oneLine(v)}`);
  lines.push('month,modis,viirs,harmonized,source');
  modis.values.forEach((mv, i) => {
    const hv = harmonized[i];
    const source = (hv.source ?? '') + (hv.estimated ? ', estimated' : '');
    lines.push(`${monthAt(modis.start, i)},${cell(mv)},${cell(viirs.values[i])},${cell(hv.value)},${source}`);
  });
  return `${lines.join('\n')}\n`;
};
