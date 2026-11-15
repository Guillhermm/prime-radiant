import { liveSeriesFromTiles, liveComparison, seriesForAoi } from '../../core/index.js';

/** The daily-share table and the type-0 shares (gate V3 L1, L5), fetched once; null when either fails. */
let tables = null;
export const loadLiveTables = (fetchFn = fetch) => (tables ??= Promise.all(['daily-share.json', 'type0-share.json'].map(async (f) => {
  const res = await fetchFn(new URL(`../../core/data/${f}`, import.meta.url));
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  return (await res.json()).share;
})).then(([share, type0]) => ({ share, type0 })).catch(() => { tables = null; return null; }));

/** Live view's sentence for a reason core or the loader gives for showing no comparison. */
export const LIVE_REASONS = {
  unavailable: 'Live data unavailable.',
  outside: 'Live data covers Brazil only, where its method was checked. This area has no live comparison.',
  noK: 'No NOAA-20 to S-NPP ratio for this area, so live values cannot be put in archive units.',
  noDays: 'No complete live day for this area yet.',
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
  const { manifest: lm, domain, tiles } = live;
  const fetchedAt = lm.fetched_at;
  const cells = domain ? seriesForAoi(result.bbox, {}, result.manifest, { res: 0.1, domain }).domain.inside : null;
  if (cells === 0) return { reason: LIVE_REASONS.outside, fetched_at: fetchedAt };
  const K = result.harmonized.K;
  if (!K || !Number.isFinite(K.value) || K.value <= 0) return { reason: LIVE_REASONS.noK, fetched_at: fetchedAt };
  const series = liveSeriesFromTiles(tiles, lm, result.bbox, { K, cells });
  const cmp = liveComparison({ live: series, harmonized: result.harmonized.series, share, fetchedAt, now, partialMonths: result.partialMonths ?? [], type0Share: type0 });
  const view = cmp.month ?? cmp.season;
  if (!view) return { reason: cmp.reason ? `${LIVE_REASONS.noDays} (${cmp.reason}.)` : LIVE_REASONS.noDays, fetched_at: fetchedAt };
  const notes = [];
  if (cmp.daysNotObserved?.length) notes.push(`${cmp.daysNotObserved[0]} to ${cmp.daysNotObserved.at(-1)} not observed: the live record starts on ${lm.coverage.noaa20?.[0] ?? lm.day0}, so only the days since are compared.`);
  if (cmp.month) notes.push(`${cmp.daysCounted} complete day${cmp.daysCounted === 1 ? '' : 's'} counted through ${cmp.lastCompleteDay}${cmp.daysMissing.length ? `, ${cmp.daysMissing.length} missing (skipped, the band uses only the days counted)` : ''}.`);
  if (cmp.typeBias) notes.push(cmp.typeBias);
  if (cells !== null && result.domain?.partial) notes.push('Only the part of the area inside Brazil is counted.');
  return {
    fetched_at: fetchedAt, live: view.live, band: view.band, provisional: true, preview: false,
    title: cmp.month ? 'This month so far against past years' : 'This season against past years',
    sub: cmp.month
      ? 'Running total of NOAA-20 detections in S-NPP units. The band is the middle half of the same days in earlier VIIRS-era years.'
      : 'Live months so far. The band is the middle half of the same months in earlier VIIRS-era years.',
    lowConfidence: cmp.lowConfidence === true, lowConfidenceReasons: cmp.lowConfidenceReasons, notes,
  };
};
