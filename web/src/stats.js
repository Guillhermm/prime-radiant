import { baseline } from '../../core/index.js';
import { MONTH_ABBR, MONTH_NAMES } from './format.js';

// Plain view arithmetic over CalendarCell lists: sums, orderings and labels. The only median here
// comes from core.baseline; nothing in this file is a new statistic. Comparisons and ranks are
// shown with the "Preview" tag until the Second Foundation validates them (docs/ux.md 5.6).

const ORD = ['th', 'st', 'nd', 'rd'];
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ORD[n % 10] ?? 'th'}`;

/** Sum of the values per year, newest first; `partial` when the range does not cover the whole year. */
export const yearTotals = (cells) => {
  const by = new Map();
  for (const c of cells) {
    if (!by.has(c.year)) by.set(c.year, { year: c.year, total: 0, months: [], withData: 0 });
    const y = by.get(c.year);
    y.months.push(c.month);
    if (c.value !== null) { y.total += c.value; y.withData += 1; }
  }
  const list = [...by.values()].sort((a, b) => b.year - a.year);
  const max = Math.max(0, ...list.map((y) => y.total));
  return list.map((y) => ({
    year: y.year,
    total: y.withData ? y.total : null,
    share: max > 0 ? y.total / max : 0,
    busiest: max > 0 && y.total === max,
    partial: y.months.length < 12,
    first: Math.min(...y.months),
    last: Math.max(...y.months),
  }));
};

/** Footnote for a year the range cuts: "2026 through October", "2000 from November". */
export const partialNote = (y) => {
  if (y.first === 1) return `${y.year} through ${MONTH_NAMES[y.last - 1]}`;
  if (y.last === 12) return `${y.year} from ${MONTH_NAMES[y.first - 1]}`;
  return `${y.year}, ${MONTH_NAMES[y.first - 1]} to ${MONTH_NAMES[y.last - 1]}`;
};

/**
 * Same calendar month in every year of `cells`, oldest first, with the rank of `cell` among them
 * (1 = busiest; ties share the better rank). Months without data are kept with value null and
 * never ranked.
 */
export const sameMonth = (cells, cell) => {
  const list = cells.filter((c) => c.month === cell.month).sort((a, b) => a.year - b.year);
  const ranked = list.filter((c) => c.value !== null);
  const rank = cell.value === null ? null : ranked.filter((c) => c.value > cell.value).length + 1;
  const order = [...ranked].sort((a, b) => b.value - a.value || a.year - b.year);
  return { list, count: ranked.length, rank, order };
};

/** "13th busiest of 26 Octobers", "Busiest of 26 Octobers"; null without a rank. */
export const rankSentence = ({ rank, count }, month) => {
  if (rank === null || count < 2) return null;
  const name = `${MONTH_NAMES[month - 1]}s`;
  return rank === 1 ? `Busiest of ${count} ${name}` : `${ordinal(rank)} busiest of ${count} ${name}`;
};

const MINUS = '−';

/**
 * Value against its median. A ratio ("2.7×") when it is at least double or under half, otherwise
 * a percentage ("+5%", "−12%"). `dir` is above, below or equal. Null without a median.
 */
export const compareToMedian = (value, median) => {
  if (typeof median !== 'number' || value === null || value === undefined) return null;
  if (median === 0) return value === 0 ? { kind: 'equal', text: 'equal to the median', dir: 'equal' } : { kind: 'zero-median', text: 'median is 0', dir: 'above' };
  const r = value / median;
  const dir = value > median ? 'above' : value < median ? 'below' : 'equal';
  if (r >= 2 || r < 0.5) return { kind: 'ratio', text: `${r.toFixed(1)}×`, dir };
  const p = Math.round((r - 1) * 100);
  if (p === 0) return { kind: 'pct', text: dir === 'equal' ? 'equal to the median' : '0%', dir };
  return { kind: 'pct', text: `${p > 0 ? '+' : MINUS}${Math.abs(p)}%`, dir };
};

/**
 * Years behind core.baseline's median for (year, month): the earlier years of the full series
 * with a value for that month. Mirrors the rule of the core/baseline.js stub until core returns
 * the years used itself (roadmap M1-K7).
 */
export const medianYears = (allCells, { year, month }) => {
  const ys = allCells.filter((c) => c.month === month && c.year < year && c.value !== null).map((c) => c.year);
  return ys.length ? { count: ys.length, from: Math.min(...ys), to: Math.max(...ys) } : null;
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * Typical year: for each calendar month, core.baseline's median over every complete calendar
 * year of `series` (the series cut at its last December, then one empty year appended so the
 * baseline of that year covers all earlier ones). Returns 12 entries {month, median, from, to},
 * median null where no year has a value.
 */
export const typicalYear = (series) => {
  const [y0, m0] = series.start.split('-').map(Number);
  const lastIdx = series.values.length - 1;
  const lastMonth = ((m0 - 1 + lastIdx) % 12) + 1;
  const cut = lastIdx - (lastMonth % 12);
  if (cut < 0) return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, median: null, from: null, to: null }));
  const values = [...series.values.slice(0, cut + 1), ...Array(12).fill(null)];
  const base = baseline({ ...series, values });
  const lastYear = y0 + Math.floor((m0 - 1 + cut) / 12);
  const firstYear = (month) => {
    for (let i = 0; i <= cut; i++) {
      if (((m0 - 1 + i) % 12) + 1 === month && values[i] !== null) return y0 + Math.floor((m0 - 1 + i) / 12);
    }
    return null;
  };
  return base.values.slice(-12).map((median, i) => ({ month: i + 1, median, from: median === null ? null : firstYear(i + 1), to: median === null ? null : lastYear }));
};

/** Month of the typical year with the largest median, or null. */
export const peakMonth = (typical) => typical.reduce((best, t) => (t.median !== null && (best === null || t.median > best.median) ? t : best), null);

export const monthYear = (year, month) => `${MONTH_ABBR[month - 1]} ${year}`;
export const ymOf = (year, month) => `${year}-${pad(month)}`;
