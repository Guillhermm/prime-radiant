import { seriesForAoi, seriesForLevels, harmonize, baseline, toCalendar, kpis, cellCount } from '../../core/index.js';
import { caveatsFor } from '../../core/caveats.js';
import { KNOWN_PARTIAL_MONTHS } from '../../core/baseline.js';
import { typicalYear } from './stats.js';

/** The mock-data tool marks its manifest with a "synthetic-" dataVersion prefix. */
export const isSyntheticManifest = (manifest) => /^synthetic/i.test(manifest?.dataVersion ?? '');

const pad = (n) => String(n).padStart(2, '0');
const cellMonth = (c) => `${c.year}-${pad(c.month)}`;
const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthAt = (start, i) => {
  const k = monthIdx(start) + i;
  return `${Math.floor(k / 12)}`.padStart(4, '0') + `-${pad((k % 12) + 1)}`;
};

// from/to are inclusive "YYYY-MM"; null leaves that side open.
export const sliceCells = (cells, from, to) => cells.filter((c) => (!from || cellMonth(c) >= from) && (!to || cellMonth(c) <= to));

export const sliceSeries = (series, from, to) => {
  const first = monthIdx(series.start);
  const lo = Math.max(0, from ? monthIdx(from) - first : 0);
  const hi = Math.min(series.values.length - 1, to ? monthIdx(to) - first : Infinity);
  return { ...series, start: monthAt(series.start, lo), values: series.values.slice(lo, Math.max(lo, hi + 1)) };
};

/** Every outage month in the manifest, any sensor: method.md section 3 keeps them all out of the baseline. */
export const partialMonthsOf = (manifest) => [...new Set(Object.values(manifest.partial_months ?? {}).flat())].sort();

/** The factor core applied in month `ym` (per-month when core used per-month ratios). */
export const factorFor = (ratio, ym) => (ratio?.perMonth ? ratio.perMonth[Number(ym.slice(5)) - 1].value : ratio?.value ?? null);

/**
 * What supplied each month of core's harmonized series: 'viirs' (S-NPP, observed), 'noaa20'
 * (NOAA-20 x K) or 'modis' (MODIS x R), null without a value. Mirrors core/harmonize.js, which
 * flags estimated months but does not name their source.
 */
export const sourcesOf = (h, sensors, manifest) => {
  const estimated = new Set((h.series.flags ?? []).filter((f) => f.flag === 'estimated').map((f) => f.month));
  const sEnd = manifest.coverage?.viirs?.[1] ?? null;
  return h.series.values.map((v, i) => {
    if (v === null) return null;
    const ym = monthAt(h.series.start, i);
    if (!estimated.has(ym)) return { id: 'viirs', factor: null };
    const n = sensors.noaa20?.values[i] ?? null;
    if (sEnd !== null && ym > sEnd && n !== null && h.K && factorFor(h.K, ym) !== null) return { id: 'noaa20', factor: { name: 'K', value: factorFor(h.K, ym) } };
    return { id: 'modis', factor: { name: 'R', value: factorFor(h.R, ym) } };
  });
};

/**
 * First and last month R was fitted on: inside core's window (R.window, which starts with Aqua
 * in 2002-08), with MODIS and S-NPP both counted and neither partial, the months core's
 * harmonize lets into the ratio. null when no month qualifies.
 */
export const fitWindow = (sensors, R, manifest) => {
  if (!R?.window) return null;
  const pm = manifest.partial_months ?? {};
  const out = new Set([...KNOWN_PARTIAL_MONTHS, ...(pm.modis ?? []), ...(pm.viirs ?? [])]);
  let from = null;
  let to = null;
  sensors.modis.values.forEach((m, i) => {
    const ym = monthAt(sensors.modis.start, i);
    if (m === null || sensors.viirs.values[i] === null || ym < R.window.from || ym > R.window.to || out.has(ym)) return;
    from ??= ym;
    to = ym;
  });
  return from ? { from, to } : null;
};

/**
 * Everything the result views need, from the loaded tiles and the committed query. Every
 * number is core's: harmonize over the fallback levels, baseline, toCalendar and kpis. Cells
 * are core's CalendarCells plus two view fields: `source` (what supplied the value) and
 * `medianYears` (the years core.baseline used for its median).
 */
export const buildResult = ({ bbox, from, to, manifest, tiles, domain = null }) => {
  const opts = domain ? { domain } : {};
  const aoi = seriesForAoi(bbox, tiles, manifest, opts);
  const sensors = { modis: aoi.modis, viirs: aoi.viirs, noaa20: aoi.noaa20 };
  const core = harmonize(seriesForLevels(bbox, tiles, manifest, opts), manifest);
  const harmonized = { ...core, fit: fitWindow(sensors, core.R, manifest) };
  const partialMonths = partialMonthsOf(manifest);
  // The baseline runs on the whole record so a month's median does not depend on the range shown.
  const base = baseline(harmonized.series, { partialMonths });
  const sources = sourcesOf(harmonized, sensors, manifest);
  const allCells = toCalendar(harmonized, base, manifest).map((c, i) => ({ ...c, source: sources[i], medianYears: base.yearsUsed[i] }));
  // Density is per 0.1 degree cell holding data: inside the domain only, whatever level core summed.
  const aoiCells = domain ? seriesForAoi(bbox, {}, manifest, { res: 0.1, domain }).domain.inside : cellCount(bbox, 0.1);
  return {
    bbox, from, to, manifest, sensors, harmonized,
    domain: { ...aoi.domain, outside: aoi.domain.inside === 0, info: manifest.domain ?? null },
    series: sliceSeries(harmonized.series, from, to),
    cells: sliceCells(allCells, from, to),
    allCells,
    typical: typicalYear(harmonized.series, { partialMonths }),
    kpis: kpis(harmonized, base, manifest, { from, to }),
    caveats: caveatsFor(harmonized),
    aoiCells,
  };
};

/** Header for core.toCsv. `generated` is the export day, passed in so the file stays deterministic. */
export const csvMeta = (r, { generated = new Date().toISOString().slice(0, 10), aoi = '' } = {}) => ({
  aoi,
  bbox: r.bbox,
  method: r.harmonized.series.method,
  R: r.harmonized.R,
  K: r.harmonized.K,
  dataVersion: r.manifest.dataVersion,
  domain: r.manifest.domain ? `${r.manifest.domain.id} ${r.manifest.domain.version}` : '',
  generated,
  citation: r.manifest.citation,
  caveats: r.caveats.map((c) => c.id),
  flags: r.harmonized.series.flags ?? [],
});
