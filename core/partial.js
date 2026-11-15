import { addMonths } from './months.js';
import { KNOWN_PARTIAL_MONTHS } from './baseline.js';

/** Partial MODIS month at the start of the Aqua era (method.md section 3). */
const MODIS_PARTIAL_MONTHS = ['2002-07'];

const inCoverage = (cov, ym) => Array.isArray(cov) && ym >= cov[0] && ym <= cov[1];

/** True when `ym` is the manifest's last month and the archive was generated before it ended. */
export function lastMonthIncomplete(ym, manifest) {
  if (!manifest?.last_month || ym !== manifest.last_month || !manifest.generated_at) return false;
  const built = Date.parse(manifest.generated_at);
  const end = Date.parse(`${addMonths(ym, 1)}-01T00:00:00Z`);
  return Number.isFinite(built) && built < end;
}

/**
 * Which sensor supplied month `ym` of the harmonized series (mirrors harmonize.js): 'viirs' when
 * observed, 'noaa20' for an outage month filled inside S-NPP coverage, else 'noaa20' after the S-NPP archive ends while NOAA-20 covers it, else 'modis'.
 */
export function supplier(ym, estimated, manifest) {
  if (!estimated) return 'viirs';
  if (inCoverage(manifest?.coverage?.viirs, ym) && inCoverage(manifest?.coverage?.noaa20, ym)
    && (KNOWN_PARTIAL_MONTHS.includes(ym) || (manifest?.partial_months?.viirs ?? []).includes(ym))) {
    return 'noaa20'; // estimated inside S-NPP coverage: outage fill (same partial set as harmonize.js)
  }
  const sEnd = manifest?.coverage?.viirs?.[1] ?? null;
  return sEnd !== null && ym > sEnd && inCoverage(manifest?.coverage?.noaa20, ym) ? 'noaa20' : 'modis';
}

/** True when `ym` is partial for `sensor`: listed in the manifest, a known partial month, or still filling. */
export function isPartial(ym, sensor, manifest) {
  const listed = manifest?.partial_months?.[sensor] ?? [];
  const known = sensor === 'viirs' ? KNOWN_PARTIAL_MONTHS : sensor === 'modis' ? MODIS_PARTIAL_MONTHS : [];
  return listed.includes(ym) || known.includes(ym) || lastMonthIncomplete(ym, manifest);
}

/**
 * Months of a harmonized series that are partial for the sensor that supplies them: S-NPP for
 * observed months, MODIS for MODIS x R, NOAA-20 for NOAA-20 x K. Pass to baseline() as
 * `partialMonths`; the calendar marks the same months `partial`.
 * @param {import('./index.js').Harmonized} harmonized
 * @param {object} manifest
 * @returns {string[]} "YYYY-MM", oldest first
 */
export function partialMonthsFor(harmonized, manifest) {
  const { series } = harmonized;
  const est = new Set((series.flags ?? []).filter((f) => f.flag === 'estimated').map((f) => f.month));
  const out = [];
  series.values.forEach((v, i) => {
    const ym = addMonths(series.start, i);
    if (v !== null && isPartial(ym, supplier(ym, est.has(ym), manifest), manifest)) out.push(ym);
  });
  return out;
}
