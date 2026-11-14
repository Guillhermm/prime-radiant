import { seriesForAoi, harmonize, baseline, toCalendar, kpis } from '../../core/index.js';
import { aoiCellCount } from './bins.js';
import { typicalYear } from './stats.js';

/** The mock-data tool marks its manifest with a "synthetic-" dataVersion prefix. */
export const isSyntheticManifest = (manifest) => /^synthetic/i.test(manifest?.dataVersion ?? '');

const pad = (n) => String(n).padStart(2, '0');
const cellMonth = (c) => `${c.year}-${pad(c.month)}`;
const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

// from/to are inclusive "YYYY-MM"; null leaves that side open.
export const sliceCells = (cells, from, to) => cells.filter((c) => (!from || cellMonth(c) >= from) && (!to || cellMonth(c) <= to));

export const sliceSeries = (series, from, to) => {
  const first = monthIdx(series.start);
  const lo = Math.max(0, from ? monthIdx(from) - first : 0);
  const hi = Math.min(series.values.length - 1, to ? monthIdx(to) - first : Infinity);
  const startIdx = first + lo;
  return {
    ...series,
    start: `${Math.floor(startIdx / 12)}-${pad((startIdx % 12) + 1)}`.padStart(7, '0'),
    values: series.values.slice(lo, Math.max(lo, hi + 1)),
  };
};

/** Everything the result views need, from the loaded tiles and the committed query. */
export const buildResult = ({ bbox, from, to, manifest, tiles }) => {
  const sensors = seriesForAoi(bbox, tiles, manifest);
  const harmonized = harmonize(sensors);
  // The baseline runs on the whole record so a month's median does not depend on the range shown.
  const allCells = toCalendar(harmonized, baseline(harmonized));
  const cells = sliceCells(allCells, from, to);
  return {
    bbox, from, to, manifest, sensors,
    series: sliceSeries(harmonized, from, to),
    cells,
    allCells,
    typical: typicalYear(harmonized),
    kpis: kpis(cells),
    aoiCells: aoiCellCount(bbox, manifest.grid.res),
  };
};

export const csvMeta = (r) => ({
  region: `bbox west,south,east,north = ${r.bbox.join(',')}`,
  range: `${r.from ?? r.manifest.month0} to ${r.to ?? r.manifest.last_month}`,
  dataVersion: r.manifest.dataVersion,
  citation: r.manifest.citation,
});
