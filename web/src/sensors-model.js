import { MONTH_ABBR } from './format.js';
import { sourcesOf } from './view-data.js';

// Sensors view numbers: every value and ratio is core's (seriesForAoi, harmonize). This file
// only lines them up by month or year and picks the example months the steps card explains.

const pad = (n) => String(n).padStart(2, '0');
const idxOf = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
export const monthAt = (start, i) => {
  const k = idxOf(start) + i;
  return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`;
};
const num = (v) => typeof v === 'number';

export const SOURCE_LABEL = { viirs: 'S-NPP', modis: 'MODIS × R', noaa20: 'NOAA-20 × K' };

/**
 * Per-month view of core's harmonized series, aligned with the sensors: the value, whether core
 * marked it estimated, and which sensor supplied it.
 * @param {{modis: object, viirs: object, noaa20?: object}} sensors raw Series of one range
 * @param {{series: object, R: object, K: object|null}} h core harmonize result, series cut to the same range
 */
export const fromCore = (sensors, h, manifest) => {
  const { modis } = sensors;
  if (h.series.start !== modis.start || h.series.values.length !== modis.values.length) {
    throw new Error(`fromCore: harmonized ${h.series.start}+${h.series.values.length} does not align with sensors ${modis.start}+${modis.values.length}`);
  }
  return sourcesOf(h, sensors, manifest).map((src, i) => ({
    value: num(h.series.values[i]) ? h.series.values[i] : null,
    estimated: src !== null && src.id !== 'viirs',
    source: src && SOURCE_LABEL[src.id],
    factor: src?.factor ?? null,
  }));
};

// The busiest month of `key` whose harmonized value core took from `source`.
const busiest = (sensors, months, key, source) => {
  let best = null;
  months.forEach((m, i) => {
    const v = sensors[key]?.values[i];
    if (m.source !== source || !num(v)) return;
    if (!best || v > best.count) best = { month: monthAt(sensors.modis.start, i), count: v, core: m.value, factor: m.factor };
  });
  return best;
};

/**
 * Points for the chart and the table, by year or by month. A year sums its months and is
 * estimated when any of its harmonized months is. `partial` lists the series whose year sum
 * misses months: every series when the range cuts the year (2000 starts in November), and the
 * harmonized one alone when a month a sensor counted has no harmonized value (Terra only).
 */
export const sensorPoints = (sensors, months, step = 'year') => {
  const at = (id, i) => sensors[id]?.values[i] ?? null;
  const list = sensors.modis.values.map((_, i) => ({
    key: monthAt(sensors.modis.start, i), modis: at('modis', i), viirs: at('viirs', i), noaa20: at('noaa20', i),
    harmonized: months[i].value, estimated: months[i].estimated, sources: months[i].source ? [months[i].source] : [],
  }));
  const any = (p) => num(p.modis) || num(p.viirs) || num(p.noaa20);
  if (step === 'month') return list.filter(any).map((p) => ({ ...p, partial: [] }));
  const years = new Map();
  for (const p of list) {
    const key = p.key.slice(0, 4);
    const y = years.get(key) ?? { key, modis: null, viirs: null, noaa20: null, harmonized: null, estimated: false, sources: [], months: 0, unharmonized: 0, inRange: [], withHarm: [] };
    const mo = Number(p.key.slice(5, 7));
    y.inRange.push(mo);
    if (num(p.harmonized)) y.withHarm.push(mo);
    for (const src of p.sources) if (!y.sources.includes(src)) y.sources.push(src);
    for (const id of ['modis', 'viirs', 'noaa20', 'harmonized']) if (num(p[id])) y[id] = (y[id] ?? 0) + p[id];
    y.estimated ||= p.estimated;
    y.months += 1;
    if (any(p) && !num(p.harmonized)) y.unharmonized += 1;
    years.set(key, y);
  }
  // `span` names the months a partial year's sum covers ("Jul–Dec"), for the label by its hollow point.
  const spanOf = (ms) => `${MONTH_ABBR[Math.min(...ms) - 1]}–${MONTH_ABBR[Math.max(...ms) - 1]}`;
  return [...years.values()].filter(any).map(({ months: n, unharmonized, inRange, withHarm, ...y }) => {
    if (n < 12) return { ...y, partial: ['modis', 'viirs', 'noaa20', 'harmonized'], span: spanOf(inRange) };
    if (unharmonized && num(y.harmonized)) return { ...y, partial: ['harmonized'], span: spanOf(withHarm) };
    return { ...y, partial: [] };
  });
};

/**
 * Everything the Sensors view shows for one range: core's R and K, the months, the examples
 * for the steps card (the busiest month scaled from MODIS and from NOAA-20) and the first and
 * last month where MODIS and S-NPP both have a value (the shaded overlap).
 */
export const sensorsSummary = (sensors, h, manifest) => {
  const months = fromCore(sensors, h, manifest);
  let from = null;
  let to = null;
  sensors.modis.values.forEach((m, i) => {
    if (!num(m) || !num(sensors.viirs.values[i])) return;
    from ??= monthAt(sensors.modis.start, i);
    to = monthAt(sensors.modis.start, i);
  });
  return {
    R: h.R, K: h.K, months, overlap: { from, to }, fit: h.fit ?? null,
    state: num(h.R?.value) ? 'ok' : 'no-r',
    example: busiest(sensors, months, 'modis', SOURCE_LABEL.modis),
    kExample: busiest(sensors, months, 'noaa20', SOURCE_LABEL.noaa20),
  };
};
