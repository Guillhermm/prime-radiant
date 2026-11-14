const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** True when `s` is a "YYYY-MM" string with a valid month. */
export const isMonth = (s) => typeof s === 'string' && YM.test(s);

/** Months since year 0 for a "YYYY-MM" string, so differences are month counts. */
export const monthNumber = (s) => {
  const m = YM.exec(s);
  if (!m) throw new RangeError(`not a YYYY-MM month: ${s}`);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
};

/** Index of month `s` counted from `month0` (0 for month0 itself). */
export const monthIndex = (month0, s) => monthNumber(s) - monthNumber(month0);

/** "YYYY-MM" string `i` months after `month0`. */
export const monthAt = (month0, i) => {
  const n = monthNumber(month0) + i;
  const year = Math.floor(n / 12);
  return `${String(year).padStart(4, '0')}-${String((n % 12) + 1).padStart(2, '0')}`;
};
