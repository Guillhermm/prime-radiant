/**
 * Binning: raw detection records -> monthly fire-cell-day counts per family.
 *
 * Families (docs/method.md sections 2-3):
 *  - `modis`: Terra + Aqua merged, from 2002-07-04 on.
 *  - `modis_terra_only`: Terra (Aqua does not exist yet) before 2002-07-04. Kept as a
 *    separate family so it is countable apart; the writer decides what to do with it.
 *  - `viirs`: S-NPP only.
 *  - `noaa20`: NOAA-20 only, never merged into `viirs`.
 *  - NOAA-21 (and any unknown satellite) is dropped and counted in `stats.skipped`.
 * Type filtering belongs to the reader. Records with `hasType` false (NRT files, which carry
 * no type field) are kept out of the archive series: dropped and counted in
 * `stats.skipped.no_type` unless `allowNoType` is set (the live pipeline, M3).
 */
import { locate } from '../core/grid.js';
import { monthIndex } from '../core/months.js';
import { createDedupe } from './dedupe.js';

export const MODIS_AQUA_START = '2002-07-04';

/** Family of a record, or null when the record is dropped. */
export function familyOf(rec) {
  if (rec.sensor === 'modis') {
    if (rec.satellite !== 'Terra' && rec.satellite !== 'Aqua') return null;
    return rec.utcDay < MODIS_AQUA_START ? 'modis_terra_only' : 'modis';
  }
  if (rec.sensor === 'viirs') {
    if (rec.satellite === 'SNPP') return 'viirs';
    if (rec.satellite === 'NOAA20') return 'noaa20';
  }
  return null;
}

/**
 * @typedef {Object} BinResult
 * @property {Object<string, Object<string, Object<string, Object<string, number>>>>} counts
 *   counts[family][tileId][cellId][monthIdx] = fire-cell-days. monthIdx is months since
 *   the manifest `month0`. Plain JSON-able objects; keys are strings of integers.
 * @property {{read: number, counted: number, duplicates: number,
 *   skipped: Object<string, number>, rejected: number}} stats
 * @property {ReturnType<typeof createDedupe>} dedupe fire-cell-days seen, per UTC year; kept
 *   across calls so a year split over several files is still deduplicated.
 *   `skipped` counts dropped satellites by name (e.g. NOAA21) and NRT records (`no_type`); `rejected` counts records
 *   with a bad coordinate/day or a month before `month0`.
 */

/** Empty result to accumulate into across calls (one call per year). */
export function createBinResult() {
  return { counts: {}, dedupe: createDedupe(), stats: { read: 0, counted: 0, duplicates: 0, skipped: {}, rejected: 0 } };
}

/**
 * Bin records (sync or async iterable) into `into`. Memory: `into.dedupe` holds one set per
 * UTC year seen; call `into.dedupe.dropYear(y)` once every file holding year y is binned.
 * @param {Iterable|AsyncIterable} records {sensor, satellite, lat, lon, utcDay, hasType}
 * @param {{month0: string, into?: BinResult, allowNoType?: boolean}} opts month0 = manifest month0 "YYYY-MM"
 * @returns {Promise<BinResult>}
 */
export async function binRecords(records, { month0, into = createBinResult(), allowNoType = false }) {
  const base = monthIndex(month0);
  const { counts, stats, dedupe } = into;
  for await (const rec of records) {
    stats.read++;
    if (!rec.hasType && !allowNoType) {
      stats.skipped.no_type = (stats.skipped.no_type ?? 0) + 1;
      continue;
    }
    const family = familyOf(rec);
    if (!family) {
      const k = String(rec.satellite);
      stats.skipped[k] = (stats.skipped[k] ?? 0) + 1;
      continue;
    }
    let loc;
    const day = /^(\d{4})-(\d{2})-\d{2}$/.exec(rec.utcDay ?? '');
    try {
      if (!day) throw new RangeError('bad day');
      loc = locate(rec.lon, rec.lat);
    } catch {
      stats.rejected++;
      continue;
    }
    const m = monthIndex(`${day[1]}-${day[2]}`) - base;
    if (m < 0) {
      stats.rejected++;
      continue;
    }
    if (!dedupe.add(family, loc.tile, loc.cell, rec.utcDay)) {
      stats.duplicates++;
      continue;
    }
    const cells = ((counts[family] ??= {})[loc.tile] ??= {});
    const months = (cells[loc.cell] ??= {});
    months[m] = (months[m] ?? 0) + 1;
    stats.counted++;
  }
  return into;
}
