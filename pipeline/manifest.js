/**
 * Manifest builder (docs/roadmap.md section 2). Coverage per sensor runs from the first to
 * the last UTC day that the input files hold archive records (hasType) for that sensor,
 * never guessed. Caveat: a day with no vegetation-fire detection at the edge of a file is
 * not seen, so the true range can be a few days wider; the effect is a month wrongly
 * marked partial, never a wrong count.
 */
import { monthIndex } from '../core/months.js';
import { familyOf, MODIS_AQUA_START } from './bin.js';

const SENSOR_OF = { modis: 'modis', modis_terra_only: 'modis', viirs: 'viirs', noaa20: 'noaa20' };

// FIRMS acknowledgment text: verified online 2026-11-14 on
// https://www.earthdata.nasa.gov/data/tools/firms (LANCE named there as the parent system).
// Algorithm DOIs below were verified on the same page. The product-level DOIs
// (MCD14ML, VNP14IMGTDL, VJ114IMGTDL) could NOT be verified online (the page lists none):
// UNVERIFIED, so they are not cited; check them before adding.
export const CITATION =
  'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource ' +
  'Management System (FIRMS), part of NASA\'s Land, Atmosphere Near real-time Capability for ' +
  'Earth observations (LANCE) and NASA\'s Earth Science Data and Information System (ESDIS). ' +
  'Products: MODIS Collection 6.1 active fire (Giglio et al. 2016, doi:10.1016/j.rse.2016.02.054); ' +
  'VIIRS 375 m active fire, S-NPP and NOAA-20 (Schroeder et al. 2014, doi:10.1016/j.rse.2013.12.008). ' +
  'Product DOIs: unverified, to be added.';

export const SATELLITES = {
  modis: ['Terra', 'Aqua'],
  viirs: ['S-NPP'],
  noaa20: ['NOAA-20'],
  eras: { modis_aqua_from: MODIS_AQUA_START },
};

/** Tracks the first and last archive day seen per sensor. */
export function createCoverage() {
  const days = {};
  return {
    add(rec) {
      if (!rec.hasType) return;
      const fam = familyOf(rec);
      if (!fam) return;
      const d = (days[SENSOR_OF[fam]] ??= { first: rec.utcDay, last: rec.utcDay });
      if (rec.utcDay < d.first) d.first = rec.utcDay;
      if (rec.utcDay > d.last) d.last = rec.utcDay;
    },
    days: () => days,
  };
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * @param {{month0: string, days: Object<string,{first:string,last:string}>, tiles: string[],
 *   dataVersion: string, generatedAt: string, baseUrl?: string, caveats?: string[]}} o
 */
export function buildManifest({ month0, days, tiles, dataVersion, generatedAt, baseUrl = 'data/', caveats = [] }) {
  const coverage = {};
  const partial = {};
  for (const s of ['modis', 'viirs', 'noaa20']) {
    const d = days[s];
    if (!d) throw new Error(`no archive records for ${s}: coverage cannot be derived`);
    const [from, to] = [d.first.slice(0, 7), d.last.slice(0, 7)];
    coverage[s] = [from, to];
    partial[s] = [];
    if (d.first.slice(8) !== '01') partial[s].push(from);
    if (Number(d.last.slice(8)) < daysInMonth(to) && !partial[s].includes(to)) partial[s].push(to);
  }
  const last = Object.values(coverage).map((c) => c[1]).sort().at(-1);
  return {
    schema: 1,
    dataVersion,
    generated_at: generatedAt,
    base_url: baseUrl,
    grid: { res: 0.1, tile_deg: 10, coarse_res: 1 },
    month0,
    last_month: last,
    granularity: 'month',
    coverage,
    partial_months: partial,
    satellites: SATELLITES,
    tiles,
    citation: CITATION,
    caveats,
  };
}

/** Coverage as month-index ranges counted from month0, for the tile writer. */
export function coverageIndexes(manifest) {
  const m0 = monthIndex(manifest.month0);
  return Object.fromEntries(Object.entries(manifest.coverage).map(([s, c]) => [s, c.map((x) => monthIndex(x) - m0)]));
}
