/**
 * Manifest builder (docs/roadmap.md section 2). Coverage per sensor runs from the first to
 * the last UTC day that the input files hold archive records (hasType) for that sensor,
 * never guessed. Caveat: a day with no vegetation-fire detection at the edge of a file is
 * not seen, so the true range can be a few days wider; the effect is a month wrongly
 * marked partial, never a wrong count.
 */
import { monthIndex, monthString } from '../core/months.js';
import { familyOf, MODIS_AQUA_START } from './bin.js';

const SAT_SENSOR = { Terra: 'modis', Aqua: 'modis', SNPP: 'viirs', NOAA20: 'noaa20' };
const SENSOR_OF = { modis: 'modis', modis_terra_only: 'modis', viirs: 'viirs', noaa20: 'noaa20' };

// FIRMS acknowledgment text: verified online 2026-11-14 on
// https://www.earthdata.nasa.gov/data/tools/firms (LANCE named there as the parent system).
// Algorithm DOIs below were verified on the same page and in Crossref (reviewer, gate V1).
// Product DOIs (reviewer, V1): NASA CMR lists DOIs only for the NRT products
// (10.5067/FIRMS/MODIS/MCD14DL.NRT.0061, .../VIIRS/VNP14IMGT_NRT.002,
// .../VIIRS/VJ114IMGT_NRT.002). No DOI was found for the standard archive products this
// build uses (MCD14ML, VNP14IMGT, VJ114IMGT), so none is cited: never cite the NRT DOIs
// for archive data.
export const CITATION =
  'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource ' +
  'Management System (FIRMS), part of NASA\'s Land, Atmosphere Near real-time Capability for ' +
  'Earth observations (LANCE) and NASA\'s Earth Science Data and Information System (ESDIS). ' +
  'Products: MODIS Collection 6.1 active fire (Giglio et al. 2016, doi:10.1016/j.rse.2016.02.054); ' +
  'VIIRS 375 m active fire, S-NPP and NOAA-20 (Schroeder et al. 2014, doi:10.1016/j.rse.2013.12.008). ' +
  'Standard (archive) products MCD14ML and VNP14IMGT/VJ114IMGT; no product DOI found for them.';

export const SATELLITES = {
  modis: ['Terra', 'Aqua'],
  viirs: ['S-NPP'],
  noaa20: ['NOAA-20'],
  eras: { modis_aqua_from: MODIS_AQUA_START },
};

/** Tracks the first and last archive day seen per sensor. */
export function createCoverage() {
  const days = {};
  const acq = {}; // satellite -> Set of UTC days with an archive record (any type)
  return {
    /** An archive day of a satellite (Terra, Aqua, SNPP, NOAA20), whatever the record type. */
    addDay(satellite, utcDay) {
      if (satellite in SAT_SENSOR) (acq[satellite] ??= new Set()).add(utcDay);
    },
    acquisition() {
      const out = {};
      // Fixed satellite order, so the manifest does not depend on the order files are read in.
      for (const sat of Object.keys(SAT_SENSOR).filter((s) => acq[s])) {
        const set = acq[sat];
        const m = (out[sat] = {});
        for (const d of [...set].sort()) m[d.slice(0, 7)] = (m[d.slice(0, 7)] ?? 0) + 1;
      }
      return out;
    },
    add(rec) {
      if (!rec.hasType) return;
      const fam = familyOf(rec);
      if (!fam) return;
      this.addDay(rec.satellite, rec.utcDay);
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
 * A sensor with no records gets coverage null (and a console warning); with none at all it throws.
 * @param {{month0: string, days: Object<string,{first:string,last:string}>, tiles: string[],
 *   dataVersion: string, generatedAt: string, baseUrl?: string, caveats?: string[]}} o
 */
export function buildManifest({ month0, days, acquisition, tiles, dataVersion, generatedAt, baseUrl = 'data/', caveats = [], domain }) {
  const coverage = {};
  const partial = {};
  for (const s of ['modis', 'viirs', 'noaa20']) {
    const d = days[s];
    if (!d) {
      console.warn(`warning: no archive records for ${s}; its coverage is null`);
      coverage[s] = null;
      partial[s] = [];
      continue;
    }
    const [from, to] = [d.first.slice(0, 7), d.last.slice(0, 7)];
    coverage[s] = [from, to];
    partial[s] = [];
    if (d.first.slice(8) !== '01') partial[s].push(from);
    if (Number(d.last.slice(8)) < daysInMonth(to) && !partial[s].includes(to)) partial[s].push(to);
  }
  if (acquisition) {
    // Per satellite, every month from its first to its last archive month with fewer acquisition
    // days than days in the month is partial for its sensor family.
    for (const [sat, months] of Object.entries(acquisition)) {
      const keys = Object.keys(months).sort();
      if (!keys.length) continue;
      const sensor = SAT_SENSOR[sat];
      for (let i = monthIndex(keys[0]); i <= monthIndex(keys.at(-1)); i++) {
        const ym = monthString(i);
        if ((months[ym] ?? 0) < daysInMonth(ym) && partial[sensor] && !partial[sensor].includes(ym)) partial[sensor].push(ym);
      }
    }
    for (const s of Object.keys(partial)) partial[s].sort();
  }
  const last = Object.values(coverage).filter(Boolean).map((c) => c[1]).sort().at(-1);
  if (!last) throw new Error('no archive records for any sensor: coverage cannot be derived');
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
    ...(acquisition ? { acquisition_days: acquisition } : {}),
    satellites: SATELLITES,
    tiles,
    ...(domain ? { domain } : {}),
    citation: CITATION,
    caveats,
  };
}

/** Coverage as month-index ranges counted from month0, for the tile writer. */
export function coverageIndexes(manifest) {
  const m0 = monthIndex(manifest.month0);
  return Object.fromEntries(Object.entries(manifest.coverage).map(([s, c]) => [s, c && c.map((x) => monthIndex(x) - m0)]));
}
