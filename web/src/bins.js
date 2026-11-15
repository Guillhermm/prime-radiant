// Density classes from docs/ux.md section 5.1. Fixed edges, not per-AOI quantiles.
export const BINS = [
  { id: 0, label: '0' },
  { id: 1, label: '1-3' },
  { id: 2, label: '4-15' },
  { id: 3, label: '16-63' },
  { id: 4, label: '64-255' },
  { id: 5, label: '256-1023' },
  { id: 6, label: '1024+' },
];

// Lower edge of classes 2 to 6, in fire-cell-days per 1,000 grid cells (log base 4).
const EDGES = [4, 16, 64, 256, 1024];

export const NODATA = 'nodata';

/** Fire-cell-days per 1,000 grid cells; null when there is no count or no cell. */
export const density = (count, cells) => (count === null || !(cells > 0) ? null : (count / cells) * 1000);

/**
 * Class of a monthly count: NODATA for null, 0 only for a raw count of 0, then 1 to 6.
 * A positive density below 1 still lands in class 1.
 */
export const binClass = (count, cells) => {
  if (count === null || count === undefined) return NODATA;
  if (count === 0) return 0;
  const d = density(count, cells);
  if (d === null) throw new RangeError(`cannot bin a positive count without grid cells (cells=${cells})`);
  return 1 + EDGES.filter((edge) => d >= edge).length;
};
