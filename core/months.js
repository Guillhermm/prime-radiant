/** Month helpers on "YYYY-MM" strings. */

/** Months since year 0 of "YYYY-MM". */
export function monthIndex(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/** "YYYY-MM" for a months-since-year-0 index. */
export function monthString(n) {
  return `${Math.floor(n / 12)}`.padStart(4, '0') + '-' + `${(n % 12) + 1}`.padStart(2, '0');
}

/** "YYYY-MM" that is `n` months after `ym`. */
export function addMonths(ym, n) {
  return monthString(monthIndex(ym) + n);
}
