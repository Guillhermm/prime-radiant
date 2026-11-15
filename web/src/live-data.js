import { liveSeriesFromTiles, liveComparison, seriesForAoi } from '../../core/index.js';

/** The daily-share table and the type-0 shares (gate V3 L1, L5), fetched once; null when either fails. */
let tables = null;
export const loadLiveTables = (fetchFn = fetch) => (tables ??= Promise.all(['daily-share.json', 'type0-share.json'].map(async (f) => {
  const res = await fetchFn(new URL(`../../core/data/${f}`, import.meta.url));
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  return (await res.json()).share;
})).then(([share, type0]) => ({ share, type0 })).catch(() => { tables = null; return null; }));

/** Type shares of 1: a live build with the static-source mask (gate G2) needs no type scaling. */
const NO_TYPE_SCALING = Array(12).fill(1);

/** The season without its last month, the current one, still open; null when no month is left. */
const wholeMonths = (season) => {
  const n = (season?.live.values.length ?? 0) - 1;
  if (n <= 0) return null;
  const cut = (a) => a.slice(0, n);
  return { ...season, live: { ...season.live, values: cut(season.live.values) }, band: Object.fromEntries(Object.entries(season.band).map(([k, v]) => [k, cut(v)])),
    daysCounted: cut(season.daysCounted), daysMissing: cut(season.daysMissing) };
};

/**
 * Brazilian 1 degree squares with live fires and a full comparison, linked from the outside-Brazil
 * callout. Picked on production data (2026-11-16: running totals of 175, 154 and 120 fire-cell-days
 * since 8 Nov, each with its band); named by center, as the app names a map pick.
 */
export const LIVE_EXAMPLES = [
  { name: '3.5°S 44.5°W', bbox: [-45, -4, -44, -3] },
  { name: '4.5°S 45.5°W', bbox: [-46, -5, -45, -4] },
  { name: '2.5°S 49.5°W', bbox: [-50, -3, -49, -2] },
];

/** Live view's sentence for a reason core or the loader gives for showing no comparison. */
export const LIVE_REASONS = {
  unavailable: 'Live data unavailable.',
  outside: 'Live data covers Brazil only, where its method was checked. This area has no live comparison.',
  noK: 'No NOAA-20 to S-NPP ratio for this area, so live values cannot be put in archive units.',
  noDays: 'No complete live day for this area yet.',
  wholeMonths: (since) => `Live data covers the whole world${since ? ` since ${since}` : ''}. Outside Brazil it is compared by whole months only, because the timing of fires within a month was measured over Brazil, so this area gets its first comparison once a whole month of live data is in.`,
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMon = (d) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

/**
 * The disclaimer over an uncompared running total outside the share region (gate V5 addendum,
 * 2026-11-16): from the first day counted, naming the days of the month not observed.
 */
export const runningTotalDisclaimer = (month) => {
  const firstDay = month.live.values.findIndex((v) => v !== null);
  const since = `${month.month}-${String(firstDay + 1).padStart(2, '0')}`;
  const unseen = month.daysNotObserved ?? [];
  const gap = unseen.length ? ` (${Number(unseen[0].slice(8))}${unseen.length > 1 ? ` to ${dayMon(unseen.at(-1))}` : ` ${MON[Number(unseen[0].slice(5, 7)) - 1]}`} not observed)` : '';
  return `NOAA-20 near-real-time, scaled to S-NPP, approximate. Running total since ${dayMon(since)} only${gap}. Not a monthly total, no comparison to past years. Static heat sources are masked from the archive; newer flares or eruptions can leak in.`;
};

/**
 * live-view input from the archive result and the live data (gate V3): NOAA-20 x K over the
 * area, clipped to the live domain, against the archive band. Month to date when core gives it,
 * else the season by month. Returns {reason, fetched_at} when there is nothing to compare.
 * @param {{result: object, live: {manifest: object, domain: object|null, tiles: object}|null,
 *   share: number[][], type0: (number|null)[], now?: Date}} o
 */
export const liveInput = ({ result, live, share, type0, now = new Date() }) => {
  if (!live) return { reason: LIVE_REASONS.unavailable, fetched_at: null };
  const { manifest: lm, domain, shareDomain = null, tiles } = live;
  const fetchedAt = lm.fetched_at;
  const cells = domain ? seriesForAoi(result.bbox, {}, result.manifest, { res: 0.1, domain }).domain.inside : null;
  if (cells === 0) return { reason: LIVE_REASONS.outside, fetched_at: fetchedAt };
  const K = result.harmonized.K;
  if (!K || !Number.isFinite(K.value) || K.value <= 0) return { reason: LIVE_REASONS.noK, fetched_at: fetchedAt };
  // A global live build: the measured shares hold where most of the area lies in their region.
  let measured = true;
  if (!domain && lm.share_domain) {
    const d = shareDomain ? seriesForAoi(result.bbox, {}, result.manifest, { res: 0.1, domain: shareDomain }).domain : null;
    measured = d !== null && d.inside * 2 >= d.cells;
  }
  const series = liveSeriesFromTiles(tiles, lm, result.bbox, { K, cells });
  const cmp = liveComparison({ live: series, harmonized: result.harmonized.series, share, fetchedAt, now,
    partialMonths: result.partialMonths ?? [], type0Share: lm.static_mask ? NO_TYPE_SCALING : type0 });
  // The share table was measured over Brazil; elsewhere fires ramp differently within a month (gate V5:
  // Punjab in October reads 2-3 times low), so only whole past months are compared there.
  // The month's running total does not use the shares, so it is still shown there, without a band.
  let total = null;
  if (!measured) {
    total = cmp.month;
    cmp.month = null;
    cmp.season = wholeMonths(cmp.season);
    if (!cmp.season && !total) return { reason: LIVE_REASONS.wholeMonths(lm.coverage?.noaa20?.[0] ?? lm.day0), fetched_at: fetchedAt, examples: LIVE_EXAMPLES };
  }
  if (total && !cmp.season) return runningTotal({ total, cmp, fetchedAt });
  const view = cmp.month ?? cmp.season;
  if (!view) return { reason: cmp.reason ? `${LIVE_REASONS.noDays} (${cmp.reason}.)` : LIVE_REASONS.noDays, fetched_at: fetchedAt };
  const notes = [];
  if (cmp.daysNotObserved?.length) notes.push(`${cmp.daysNotObserved[0]} to ${cmp.daysNotObserved.at(-1)} not observed: the live record starts on ${lm.coverage.noaa20?.[0] ?? lm.day0}, so only the days since are compared.`);
  if (cmp.month) notes.push(`${cmp.daysCounted} complete day${cmp.daysCounted === 1 ? '' : 's'} counted through ${cmp.lastCompleteDay}${cmp.daysMissing.length ? `, ${cmp.daysMissing.length} missing (skipped, the band uses only the days counted)` : ''}.`);
  if (cmp.typeBias) notes.push(cmp.typeBias);
  if (cells !== null && result.domain?.partial) notes.push('Only the part of the area inside Brazil is counted.');
  const last = total?.live.values.findLast((v) => v !== null);
  if (typeof last === 'number') notes.push(`This month so far: ${Math.round(last).toLocaleString('en-US')} fire-cell-days through ${dayMon(cmp.lastCompleteDay)}, not compared with past years outside Brazil.`);
  return {
    fetched_at: fetchedAt, live: view.live, band: view.band, provisional: true, preview: false,
    title: cmp.month ? 'This month so far against past years' : 'This season against past years',
    sub: cmp.month
      ? 'Running total of NOAA-20 detections in S-NPP units. The band is the middle half of the same days in earlier VIIRS-era years.'
      : 'Live months so far. The band is the middle half of the same months in earlier VIIRS-era years.',
    lowConfidence: cmp.lowConfidence === true, lowConfidenceReasons: cmp.lowConfidenceReasons, notes,
  };
};

const runningTotal = ({ total, cmp, fetchedAt }) => {
  const notes = [`${total.daysCounted} complete day${total.daysCounted === 1 ? '' : 's'} counted through ${cmp.lastCompleteDay}${total.daysMissing.length ? `, ${total.daysMissing.length} missing (skipped)` : ''}.`];
  if (cmp.typeBias) notes.push(cmp.typeBias);
  return {
    fetched_at: fetchedAt, live: total.live, band: null, provisional: true, preview: false,
    title: 'This month so far',
    sub: 'Running total of NOAA-20 detections in S-NPP units. Outside Brazil there is no comparison with past years yet.',
    disclaimer: runningTotalDisclaimer(total), examples: LIVE_EXAMPLES,
    lowConfidence: cmp.lowConfidence === true, lowConfidenceReasons: cmp.lowConfidenceReasons, notes,
  };
};
