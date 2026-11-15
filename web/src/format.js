export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

// Fixed locale so labels and tests do not depend on the browser language.
const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatCount = (n) => COUNT.format(n);

/** Density with one decimal below 10, whole numbers above, for example "3.5" or "38". */
export const formatDensity = (d) => (d < 10 ? String(Number(d.toFixed(1))) : COUNT.format(Math.round(d)));

/** Short form for a cell too small for the full number: 999, 1.2k, 12k, 1.2M. */
const UNITS = [[1e3, 'k'], [1e6, 'M'], [1e9, 'B']];
export const abbreviateCount = (n) => {
  if (n < 999.5) return String(Math.round(n));
  let i = UNITS.findLastIndex(([size]) => n >= size);
  let v = n / UNITS[i][0];
  v = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  // 999,950 rounds to 1000k: show 1M instead.
  if (v >= 1000 && i < UNITS.length - 1) { i += 1; v = 1; }
  return `${v}${UNITS[i][1]}`;
};

export const monthLabel = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
