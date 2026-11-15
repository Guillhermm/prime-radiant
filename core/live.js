import { addMonths } from './months.js';
import { LAST_EXCLUDED_ERA_MONTH, KNOWN_PARTIAL_MONTHS } from './baseline.js';
import { caveat, DEFAULT_GATES } from './caveats.js';
import { cellCenter } from './grid.js';
import { checkBbox } from './tiles.js';

const UNIT = 'fire-cell-days';
export const LIVE_METHOD = { id: 'live-vs-archive-band', version: 2 };
/** A live fetch older than this is stale: the view shows "Live unavailable" (roadmap M3-G1). */
export const LIVE_STALE_HOURS = 48;
/** Earlier complete years the band needs (same default as baseline()). */
export const LIVE_MIN_YEARS = 5;
/** Units the live Series must declare (gate V3 L3): NOAA-20 x K, S-NPP-equivalent. */
export const LIVE_UNITS = 'snpp-equivalent';
/** Band years start here: the first complete S-NPP month (gate V3 L4, the V2 VIIRS-era decision). */
export const VIIRS_ERA_START = '2012-02';
/**
 * An AOI with fewer in-domain 0.1 degree cells than this gets a low-confidence label. Chosen by
 * the Foundation, not validated: gate V3 measured the Pantanal (25-30% off either way) as too small
 * and Brazil-wide as fine; 2,000 cells is about 20,000 km2. Revisit with the science team.
 */
export const LIVE_MIN_CELLS = 2000;

/** Caveat ids for live data, kind 'live' (kind 'caveat' is the drawer's fixed 9). */
export const LIVE_CAVEAT_IDS = ['live-nrt', 'live-approximate', 'live-not-harmonized', 'live-unfiltered', 'live-provisional',
  'live-sensor', 'live-archive-lag', 'live-access'];

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

const dayNum = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/**
 * Live Series from the live tiles (gate V3 L3): NOAA-20 x K, so S-NPP units, for the whole live
 * period. NOAA-20 is the sensor live data has; MODIS is never used without x R, so it is not used.
 * Per day: null outside NOAA-20's coverage, on its manifest `partial_days`, and on the fetch day
 * (the UTC date of `fetched_at`, still open); else the sum of detections of the AOI's cells x K.
 * Never 0 for a day that was not observed.
 * @param {Record<string, {cell: number[], day: number[], noaa20: (number|null)[]}>} liveTiles by tile id
 * @param {object} liveManifest validated live manifest
 * @param {[number, number, number, number]} bbox [west, south, east, north]
 * @param {{K: number|{value: number|null}, cells?: number|null}} opts K from harmonize(); `cells` = in-domain 0.1 degree
 *   cells of the AOI (seriesForAoi(...).domain.inside), kept on the Series for the small-AOI label
 * @returns {object} Series id 'live', unit 'fire-cell-days', units 'snpp-equivalent', step 'day', comparable false
 */
export function liveSeriesFromTiles(liveTiles, liveManifest, bbox, { K, cells = null } = {}) {
  checkBbox(bbox);
  const k = typeof K === 'number' ? K : K?.value;
  if (!Number.isFinite(k) || k <= 0) throw new RangeError('liveSeriesFromTiles: K must be a positive number (NOAA-20 to S-NPP ratio)');
  const d0 = dayNum(liveManifest.day0);
  const span = dayNum(liveManifest.last_day) - d0 + 1;
  const cov = liveManifest.coverage?.noaa20;
  const fetchDay = String(liveManifest.fetched_at ?? '').slice(0, 10);
  const partial = new Set(liveManifest.partial_days?.noaa20 ?? []);
  const sums = Array(span).fill(0);
  const [w, s, e, n] = bbox;
  const inLon = (lon) => (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);
  for (const [id, t] of Object.entries(liveTiles)) {
    const inc = new Map();
    t.cell.forEach((c, i) => {
      if (!inc.has(c)) { const { lon, lat } = cellCenter(id, c); inc.set(c, inLon(lon) && lat >= s && lat <= n); }
      const v = t.noaa20[i];
      if (inc.get(c) && v !== null && t.day[i] < span) sums[t.day[i]] += v;
    });
  }
  const values = sums.map((sum, i) => {
    const day = dayStr(d0 + i);
    const inside = Array.isArray(cov) && day >= cov[0] && day <= cov[1];
    return !inside || partial.has(day) || (fetchDay && day >= fetchDay) ? null : sum * k;
  });
  return { id: 'live', unit: UNIT, units: LIVE_UNITS, step: 'day', start: liveManifest.day0, values, comparable: false,
    method: { id: 'noaa20-x-K', version: 1 }, cells };
}

/**
 * Per calendar month ratio type-0 / all types of the archive (gate V3 L5), VIIRS era, months
 * both series have, known partial months out. Index 0 = January; null when the month has no
 * all-types detections. The archive builds type 0 only today, so an all-types monthly Series
 * has to come from a separate build; without it pass nothing to liveComparison.
 * @param {{start: string, values: (number|null)[]}} allTypes
 * @param {{start: string, values: (number|null)[]}} type0 same start and length
 * @returns {(number|null)[]} 12 ratios
 */
export function type0Share(allTypes, type0) {
  const all = Array(12).fill(0), t0 = Array(12).fill(0);
  allTypes.values.forEach((a, i) => {
    const ym = addMonths(allTypes.start, i);
    const b = type0.values[i];
    if (a === null || b === null || b === undefined || ym < VIIRS_ERA_START || KNOWN_PARTIAL_MONTHS.includes(ym)) return;
    all[Number(ym.slice(5)) - 1] += a;
    t0[Number(ym.slice(5)) - 1] += b;
  });
  return all.map((a, m) => (a > 0 ? t0[m] / a : null));
}

/**
 * Statement of the no-type-filter bias for a calendar month (1-12), from gate V3 (docs/gates/V3.md):
 * the unfiltered NRT adds 0.4-1.5% in Aug-Nov and up to 3-10% in Feb-May; other months not measured.
 */
export function typeBiasStatement(month) {
  if (month >= 8 && month <= 11) return 'Not filtered by type: adds about 0.4% to 1.5% in this month (gate V3, Aug-Nov 2026 check).';
  if (month >= 2 && month <= 5) return 'Not filtered by type: adds up to 3% to 10% in this month (static sources weigh more in the wet season; gate V3).';
  return 'Not filtered by type: the bias in this month was not measured.';
}

/** Quantile of an ascending array by linear interpolation (type 7, as preview-stubs.js). */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

const daysIn = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();

/**
 * Values of calendar month `ym` in earlier years of the archive series: non-null, VIIRS era only
 * (2012-02 on, gate V3 L4), not a partial month (KNOWN_PARTIAL_MONTHS plus `partial`). Ascending.
 */
function pastYears(series, ym, partial) {
  const year = Number(ym.slice(0, 4));
  const out = [];
  series.values.forEach((v, i) => {
    const m = addMonths(series.start, i);
    if (v === null || m.slice(5) !== ym.slice(5) || Number(m.slice(0, 4)) >= year) return;
    if (m < VIIRS_ERA_START || m <= LAST_EXCLUDED_ERA_MONTH || partial.has(m)) return;
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
const dayList = (live) => live.values.map((value, i) => ({ day: dayStr(dayNum(live.start) + i), value }));

/** Share table check: 12 rows (January first) of 31 cumulative shares, share[m][d-1] by end of day d. */
function checkShare(share) {
  if (!Array.isArray(share) || share.length !== 12 || share.some((r) => !Array.isArray(r) || r.length !== 31 || r.some((v) => !Number.isFinite(v)))) {
    throw new TypeError('liveComparison: share must be the 12 x 31 table of daily cumulative shares (core/data/daily-share.json)');
  }
}

/**
 * Current season of near-real-time detections against the archive (roadmap M3-K3, gate V3 fixes).
 *
 * Input `live` is a daily Series (id 'live', start "YYYY-MM-DD", values per day, null = day not
 * observed or not complete, 0 = none detected) that MUST declare `units: 'snpp-equivalent'`
 * (liveSeriesFromTiles builds it: NOAA-20 x K); anything else throws RangeError. `harmonized`
 * is the archive's harmonized monthly Series. Live fire-cell-days never enter it (comparable: false).
 *
 * Band method: median and interquartile range (type 7 quantiles) of the same calendar month in
 * earlier years of the VIIRS era (2012-02 on; same exclusions as baseline(): known partial months and
 * `partialMonths`), multiplied by `share[month][d-1]`, the mean fraction of a month's fire-cell-days
 * already counted by the end of day d (the table from the national S-NPP daily data, gate V3 L1).
 * The band is therefore the expected month-to-date, not the month total. Fewer than `minYears`
 * usable years gives null band entries (never 0).
 *
 * `month`: current month to date, step 'day', values[d-1] = cumulative fire-cell-days through day
 * d, ending at the last complete day (the leading run of non-null days from the 1st: a null day
 * ends it, it is never counted as 0). null (with `reason`) when no complete day starts the month.
 * `season`: step 'month', one value per month from the first month fully covered by live data
 * to the current one; a past month with a null day is null; the current month is provisional and
 * its band uses the share at the last complete day.
 * Both match the live-view.js contract: `{live, band: {p25, median, p75}, provisional}`.
 *
 * Type filter (gate V3 L5): the archive keeps only presumed vegetation fires (type 0), the NRT
 * has no type. With `type0Share` (12 monthly ratios from `type0Share()`), live values are
 * multiplied by the ratio of their calendar month and `typeAdjusted` is true. Without it
 * (the simplest honest option today, the all-types archive is not built) values are kept and
 * `typeBias` carries the per-month bias statement.
 *
 * `lowConfidence` is true when `live.cells` (in-domain 0.1 degree cells) is under LIVE_MIN_CELLS,
 * null when it is unknown.
 *
 * @param {{live: object, harmonized: import('./index.js').Series, share: number[][],
 *   fetchedAt?: string|null, now?: Date, partialMonths?: string[], minYears?: number, type0Share?: (number|null)[]|null}} input
 * @returns {{fetched_at: string|null, stale: boolean, month: object|null, season: object|null, lastCompleteDay: string|null,
 *   lowConfidence: boolean|null, typeAdjusted: boolean, typeBias: string|null, reason?: string}}
 */
export function liveComparison({ live, harmonized, share, fetchedAt = null, now = new Date(), partialMonths = [], minYears = LIVE_MIN_YEARS, type0Share: t0 = null }) {
  if (live?.units !== LIVE_UNITS) throw new RangeError(`liveComparison: live Series must declare units "${LIVE_UNITS}" (NOAA-20 x K), got ${JSON.stringify(live?.units)}`);
  checkShare(share);
  const stale = isStale(fetchedAt, now);
  const cells = live.cells ?? null;
  const out = { fetched_at: fetchedAt, stale, month: null, season: null, lastCompleteDay: null,
    lowConfidence: cells === null ? null : cells < LIVE_MIN_CELLS, typeAdjusted: false, typeBias: null };
  const days = live.values?.length ? dayList(live) : [];
  const lastData = [...days].reverse().find((d) => d.value !== null);
  if (!lastData) return { ...out, reason: 'no complete live day' };
  const cur = lastData.day.slice(0, 7);
  const curNo = Number(cur.slice(5));
  const partial = new Set([...KNOWN_PARTIAL_MONTHS, ...partialMonths]);
  const meta = { id: 'live', unit: UNIT, units: LIVE_UNITS, comparable: false, method: LIVE_METHOD };
  const ratio = (ym) => (Array.isArray(t0) && Number.isFinite(t0[Number(ym.slice(5)) - 1]) ? t0[Number(ym.slice(5)) - 1] : 1);
  out.typeAdjusted = Array.isArray(t0) && Number.isFinite(t0[curNo - 1]);
  out.typeBias = out.typeAdjusted ? null : typeBiasStatement(curNo);

  // Current month: leading run of complete days from the 1st.
  const ds = days.filter((d) => d.day.startsWith(cur));
  const first = days[0].day;
  const startsOn1st = first <= `${cur}-01`;
  let run = 0;
  if (startsOn1st) while (run < ds.length && ds[run].value !== null) run++;
  const pool = pastYears(harmonized, cur, partial);
  if (run === 0) {
    out.reason = startsOn1st ? `${cur}-01 is not a complete day` : `live data starts after the 1st of ${cur}`;
  } else {
    let acc = 0;
    const values = ds.slice(0, run).map((d) => (acc += d.value) * ratio(cur));
    const band = toBand(values.map((_, i) => bandAt(pool, share[curNo - 1][i], minYears)));
    out.lastCompleteDay = ds[run - 1].day;
    out.month = { live: { ...meta, step: 'day', start: `${cur}-01`, values }, band, provisional: true, month: cur, basis: { years: pool.length, share: share[curNo - 1][run - 1] } };
  }

  // Season: months fully covered by live data; the current one needs its leading run.
  const firstMonth = first.endsWith('-01') ? first.slice(0, 7) : addMonths(first.slice(0, 7), 1);
  const last = run > 0 ? cur : addMonths(cur, -1);
  if (firstMonth <= last) {
    const months = [];
    for (let m = firstMonth; m <= last; m = addMonths(m, 1)) months.push(m);
    const values = months.map((m) => {
      const mine = days.filter((d) => d.day.startsWith(m));
      const use = m === cur ? mine.slice(0, run) : mine;
      return use.some((d) => d.value === null) ? null : use.reduce((a, d) => a + d.value, 0) * ratio(m);
    });
    const band = toBand(months.map((m) => bandAt(pastYears(harmonized, m, partial), m === cur ? share[curNo - 1][run - 1] : 1, minYears)));
    out.season = { live: { ...meta, step: 'month', start: firstMonth, values }, band, provisional: true };
  }
  return out;
}
