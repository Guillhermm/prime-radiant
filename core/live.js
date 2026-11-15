import { addMonths } from './months.js';
import { LAST_EXCLUDED_ERA_MONTH, KNOWN_PARTIAL_MONTHS } from './baseline.js';
import { caveat, DEFAULT_GATES } from './caveats.js';

const UNIT = 'fire-cell-days';
export const LIVE_METHOD = { id: 'live-vs-archive-band', version: 1 };
/** A live fetch older than this is stale: the view shows "Live unavailable" (roadmap M3-G1). */
export const LIVE_STALE_HOURS = 48;
/** Earlier complete years the band needs (same default as baseline()). */
export const LIVE_MIN_YEARS = 5;

/** Caveat ids for live data, kind 'live' (kind 'caveat' is the drawer's fixed 9). */
export const LIVE_CAVEAT_IDS = ['live-nrt', 'live-not-harmonized', 'live-unfiltered', 'live-provisional'];

/**
 * The live caveats, in order, resolved against a gate map (preliminary until gate V3 passes).
 * @param {Record<string, string>} [gates]
 */
export function liveCaveats(gates = DEFAULT_GATES) {
  return LIVE_CAVEAT_IDS.map((id) => caveat(id, gates));
}

/**
 * True when there is no fetch time or it is older than `hours` (default 48) at `now`.
 * An unparsable time is stale.
 * @param {string|null|undefined} fetchedAt ISO 8601
 * @param {Date} [now]
 * @param {number} [hours]
 */
export function isStale(fetchedAt, now = new Date(), hours = LIVE_STALE_HOURS) {
  if (!fetchedAt) return true;
  const age = (now - new Date(fetchedAt)) / 3.6e6;
  return Number.isNaN(age) || age > hours;
}

/** Quantile of an ascending array by linear interpolation (type 7, as preview-stubs.js). */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

const daysIn = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();

/**
 * Values of calendar month `ym` in earlier years of the archive series: non-null, after the
 * Terra-only era, not a partial month (KNOWN_PARTIAL_MONTHS plus `partial`). Ascending.
 */
function pastYears(series, ym, partial) {
  const year = Number(ym.slice(0, 4));
  const out = [];
  series.values.forEach((v, i) => {
    const m = addMonths(series.start, i);
    if (v === null || m.slice(5) !== ym.slice(5) || Number(m.slice(0, 4)) >= year) return;
    if (m <= LAST_EXCLUDED_ERA_MONTH || partial.has(m)) return;
    out.push(v);
  });
  return out.sort((a, b) => a - b);
}

/** Month-to-date band entry: p25, median, p75 of earlier years scaled by `fraction` (0..1), or nulls. */
function bandAt(pool, fraction, minYears) {
  if (pool.length < minYears) return { p25: null, median: null, p75: null };
  return { p25: quantile(pool, 0.25) * fraction, median: quantile(pool, 0.5) * fraction, p75: quantile(pool, 0.75) * fraction };
}

const toBand = (entries) => ({ p25: entries.map((e) => e.p25), median: entries.map((e) => e.median), p75: entries.map((e) => e.p75) });

/** "YYYY-MM-DD" days of a daily series with their values. */
function dayList(live) {
  const t0 = Date.parse(`${live.start}T00:00:00Z`);
  return live.values.map((value, i) => ({ day: new Date(t0 + i * 864e5).toISOString().slice(0, 10), value }));
}

/**
 * Current season of near-real-time detections against the archive (roadmap M3-K3, method V3).
 *
 * Input `live` is a daily Series (id 'live', start "YYYY-MM-DD", values per day, null = no data,
 * 0 = none detected) as api/live.js and pipeline/live.js give it. `harmonized` is the archive's
 * harmonized monthly Series. Live fire-cell-days are never added to it (comparable: false).
 *
 * Band method (an assumption for V3): the archive is monthly, so for the current month the band is
 * the median and the interquartile range (type 7 quantiles) of the same calendar month in earlier
 * complete years, multiplied by the fraction of the month observed (day d of N: d / N). Daily
 * archive data would give a true per-day band; the archive does not have it. Months before the
 * current one in the season use the full monthly band. Fewer than `minYears` usable earlier years
 * gives null band entries (never 0). Years excluded as in baseline(): Terra-only era, known
 * partial months, `partialMonths`.
 *
 * `month`: current month to date, step 'day', values[d-1] = cumulative fire-cell-days through day
 * d. A null day makes it and every later cumulative value null. null (with `reason`) when the
 * live data does not start on or before the 1st of that month.
 * `season`: step 'month', one value per month from the first month fully covered by live data
 * to the current month (the current one provisional, band scaled by day fraction).
 * Both match the live-view.js contract: `{live, band: {p25, median, p75}, provisional}` with
 * band arrays index-aligned with live.values.
 *
 * @param {{live: import('./index.js').Series, harmonized: import('./index.js').Series,
 *   fetchedAt?: string|null, now?: Date, partialMonths?: string[], minYears?: number}} input
 * @returns {{fetched_at: string|null, stale: boolean, month: object|null, season: object|null, reason?: string}}
 */
export function liveComparison({ live, harmonized, fetchedAt = null, now = new Date(), partialMonths = [], minYears = LIVE_MIN_YEARS }) {
  const stale = isStale(fetchedAt, now);
  const out = { fetched_at: fetchedAt, stale, month: null, season: null };
  if (!live?.values?.length) return { ...out, reason: 'no live data' };
  const partial = new Set([...KNOWN_PARTIAL_MONTHS, ...partialMonths]);
  const days = dayList(live);
  const last = days[days.length - 1].day;
  const cur = last.slice(0, 7);
  const dim = daysIn(cur);
  const seasonMeta = { id: 'live', unit: UNIT, comparable: false, method: LIVE_METHOD };
  const sumMonth = (ym) => {
    const ds = days.filter((d) => d.day.startsWith(ym));
    return ds.some((d) => d.value === null) ? null : ds.reduce((s, d) => s + d.value, 0);
  };

  // Current month, per day. Needs the 1st of the month.
  if (days[0].day <= `${cur}-01`) {
    const ds = days.filter((d) => d.day.startsWith(cur));
    const pool = pastYears(harmonized, cur, partial);
    let acc = 0, broken = false;
    const values = ds.map((d) => {
      if (broken || d.value === null) { broken = true; return null; }
      acc += d.value;
      return acc;
    });
    const band = toBand(ds.map((_, i) => bandAt(pool, (i + 1) / dim, minYears)));
    out.month = { live: { ...seasonMeta, step: 'day', start: `${cur}-01`, values }, band, provisional: true, month: cur, basis: { years: pool.length, dayFraction: ds.length / dim } };
  } else out.reason = `live data starts after the 1st of ${cur}`;

  // Season: months fully covered by live data (first month needs its 1st), current one provisional.
  const firstDay = days[0].day;
  const firstMonth = firstDay.endsWith('-01') ? firstDay.slice(0, 7) : addMonths(firstDay.slice(0, 7), 1);
  if (firstMonth <= cur) {
    const months = [];
    for (let m = firstMonth; m <= cur; m = addMonths(m, 1)) months.push(m);
    const band = toBand(months.map((m) => {
      const fraction = m === cur ? days.filter((d) => d.day.startsWith(cur)).length / dim : 1;
      return bandAt(pastYears(harmonized, m, partial), fraction, minYears);
    }));
    out.season = { live: { ...seasonMeta, step: 'month', start: firstMonth, values: months.map(sumMonth) }, band, provisional: true };
  }
  return out;
}
