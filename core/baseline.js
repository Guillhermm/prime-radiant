const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * STUB. Median of the same calendar month in all earlier years that have a value. The
 * complete-year and minimum-years rules are not applied until the science team fixes them.
 * @param {object} series a Series (usually harmonized)
 * @returns {object} Series with id "baseline"; null where no earlier year has a value
 */
export const baseline = (series) => {
  const values = series.values.map((_, i) => {
    const earlier = [];
    for (let j = i - 12; j >= 0; j -= 12) if (series.values[j] !== null) earlier.push(series.values[j]);
    return earlier.length ? median(earlier) : null;
  });
  return { id: 'baseline', unit: series.unit, start: series.start, values, method: { id: 'stub', version: '0' }, comparable: false };
};
