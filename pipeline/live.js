/**
 * Live (NRT) pipeline: FIRMS near-real-time files -> daily tiles + live manifest
 * (docs/roadmap.md M3-K1, docs/data.md "Live data").
 *   node pipeline/live.js --in raw/nrt --out data/live --fetched-at 2026-11-15T12:00:00Z
 *     [--domain pipeline/domain/brazil.geojson] [--download 7d]
 * Same grid, cell, dedupe, sensor families and domain clip as the archive build. NRT has no
 * `type` field, so nothing is filtered by type: records are admitted with allowNoType and
 * counted (`records_without_type`). NOAA-21 is skipped and counted. Tiles hold fire-cell-days
 * per UTC day: `{cell[], day[], modis[], viirs[], noaa20[]}`, `day` = days since manifest `day0`,
 * null outside a sensor's day coverage, 0 inside it with no detection. Pure parts take
 * `fetchedAt` as an argument; only `main` reads the clock. Only the 0.1 degree level is written.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { polygonsOf, bboxOfPolygons, createClipper } from '../core/domain.js';
import { readFirms, newStats } from './read.js';
import { binRecords, createBinResult, dayNumber, familyOf } from './bin.js';
import { SATELLITES } from './manifest.js';
import { SENSORS, compareTileIds } from './write-tiles.js';
import { inBbox } from './build.js';

const EXT = /\.(csv|csv\.gz|dbf)$/i;
const DAY_MS = 864e5;
const SENSOR_OF = { modis: 'modis', modis_terra_only: 'modis', viirs: 'viirs', noaa20: 'noaa20' };

// FIRMS active fire text files, verified 2026-11-15 (HTTP 200 with a `curl -r` range read; keyless).
// Headers: MODIS `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,
// version,bright_t31,frp,daynight`; VIIRS `latitude,longitude,bright_ti4,scan,track,acq_date,
// acq_time,satellite,confidence,version,bright_ti5,frp,daynight`. No `type`, no `instrument`.
// Satellite codes: MODIS `T`/`A`; VIIRS `N` (S-NPP), `N20`, `N21`. On 2026-11-15 the S-NPP 24h and
// 7d files held a header and no rows.
const ACTIVE_FIRE = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
export const WINDOWS = ['24h', '48h', '7d'];
/** Download URLs of the global NRT files for a window ('24h', '48h' or '7d'). */
export const nrtUrls = (window = '7d') => {
  if (!WINDOWS.includes(window)) throw new Error(`window must be one of ${WINDOWS.join(', ')}`);
  return [
    `${ACTIVE_FIRE}/modis-c6.1/csv/MODIS_C6_1_Global_${window}.csv`,
    `${ACTIVE_FIRE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_${window}.csv`,
    `${ACTIVE_FIRE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_${window}.csv`,
  ];
};

// NRT product DOIs: as verified in NASA CMR by the reviewer (gate V1), see pipeline/manifest.js.
export const LIVE_CITATION =
  'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource ' +
  'Management System (FIRMS), part of NASA\'s Land, Atmosphere Near real-time Capability for ' +
  'Earth observations (LANCE) and NASA\'s Earth Science Data and Information System (ESDIS). ' +
  'Near-real-time products: MODIS MCD14DL NRT (doi:10.5067/FIRMS/MODIS/MCD14DL.NRT.0061); ' +
  'VIIRS S-NPP VNP14IMGT NRT (doi:10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002); ' +
  'VIIRS NOAA-20 VJ114IMGT NRT (doi:10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002).';

export const LIVE_CAVEATS = [
  'Near-real-time data: not yet harmonized and not filtered by type (NRT files have no type field).',
];

const dayString = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Download the NRT files with an injected `fetch`; returns the written paths. Throws on a non-2xx. */
export async function downloadNrt({ fetch, urls, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed (${res.status}): ${path.basename(url)}`);
    const file = path.join(dir, path.basename(url));
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    out.push(file);
  }
  return out;
}

/**
 * Columnar daily tiles from binRecords counts indexed by absolute day number.
 * @param {Object} counts counts[family][tile][cell] = Map dayNumber -> count
 * @param {Object<string, [number, number]|null>} cov per sensor [first, last] absolute day numbers
 * @param {number} day0 absolute day number of the manifest day0
 * @param {Object<string, string[]>} [partial] per sensor partial days "YYYY-MM-DD": written null, never 0
 * @returns {Map<string, {cell: number[], day: number[], modis: (number|null)[], viirs: (number|null)[], noaa20: (number|null)[]}>}
 */
export function buildLiveTiles(counts, cov, day0, partial = {}) {
  const skip = Object.fromEntries(SENSORS.map((s) => [s, new Set((partial[s] ?? []).map(dayNumber))]));
  const tileIds = new Set();
  for (const fam of Object.values(counts)) for (const t of Object.keys(fam)) tileIds.add(t);
  const out = new Map();
  for (const id of [...tileIds].sort(compareTileIds)) {
    const rows = new Map();
    for (const [family, tiles] of Object.entries(counts)) {
      const sensor = SENSOR_OF[family];
      for (const [cell, days] of Object.entries(tiles[id] ?? {})) {
        for (const [d, n] of days) {
          const key = `${cell}:${d}`;
          const row = rows.get(key) ?? rows.set(key, { cell: +cell, day: d - day0 }).get(key);
          row[sensor] = (row[sensor] ?? 0) + n;
        }
      }
    }
    const list = [...rows.values()].sort((a, b) => a.cell - b.cell || a.day - b.day);
    const t = { cell: [], day: [], modis: [], viirs: [], noaa20: [] };
    for (const r of list) {
      t.cell.push(r.cell);
      t.day.push(r.day);
      for (const s of SENSORS) {
        const c = cov[s];
        const inside = c && r.day + day0 >= c[0] && r.day + day0 <= c[1] && !skip[s].has(r.day + day0);
        t[s].push(inside ? (r[s] ?? 0) : null);
      }
    }
    out.set(id, t);
  }
  return out;
}

/** Stable text form: one array per line. */
export function serializeLiveTile(t) {
  const body = ['cell', 'day', ...SENSORS].map((k) => `  "${k}": ${JSON.stringify(t[k])}`).join(',\n');
  return `{\n${body}\n}\n`;
}

/** A day is partial when a pass has under this share of the median of that pass over its neighbor days. */
export const PARTIAL_SHARE = 0.5;
/** Neighbor days on each side (a 7-day window centered on the day, the day itself excluded). */
export const PARTIAL_HALF_WINDOW = 3;

const median = (v) => {
  const a = [...v].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

/**
 * Partial days of one sensor (gate V3, L2): counts are records of the whole feed (before the domain clip, any
 * type) per day and pass, `{day: {D, N}}` (`A` when the file has no day/night field). A day is partial
 * when any pass has under 50% of the median of that pass over the 7 days centered on it, the day itself
 * excluded (fewer neighbors at the edges of the coverage window; days with no records count 0). The
 * fetch day is always partial, and so is a sensor's last day when it is earlier than `lastDay` (the
 * feed ended mid-day). The first day is not partial by default.
 * @param {Object<string, Object<string, number>>} counts
 * @param {{first: string, last: string}} cov
 * @returns {string[]} sorted days
 */
export function partialDays(counts, cov, fetchDay, lastDay = cov.last) {
  const first = dayNumber(cov.first);
  const n = dayNumber(cov.last) - first + 1;
  const passes = [...new Set(Object.values(counts).flatMap((c) => Object.keys(c)))];
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = dayString(first + i);
    let partial = d === fetchDay || (d === cov.last && cov.last < lastDay);
    for (const p of passes) {
      if (partial) break;
      const nb = [];
      for (let j = Math.max(0, i - PARTIAL_HALF_WINDOW); j <= Math.min(n - 1, i + PARTIAL_HALF_WINDOW); j++) {
        if (j !== i) nb.push(counts[dayString(first + j)]?.[p] ?? 0);
      }
      if (nb.length && (counts[d]?.[p] ?? 0) < PARTIAL_SHARE * median(nb)) partial = true;
    }
    if (partial) out.push(d);
  }
  return out;
}

/**
 * Live manifest. `coverage` and `partial_days` are in "YYYY-MM-DD"; `daily_records` holds the
 * record count of the whole feed per sensor, day and pass (D, N) that `partial_days` is derived from.
 * @param {{fetchedAt: string, days: Object<string, {first: string, last: string}>,
 *   dayCounts?: Object<string, Object<string, Object<string, number>>> sensor -> day -> pass -> records of the whole feed, tiles: string[],
 *   sources: object[], domain?: object, stats?: object, baseUrl?: string}} o
 */
export function buildLiveManifest({ fetchedAt, days, dayCounts = {}, tiles, sources, domain, stats, baseUrl = 'data/live/' }) {
  const coverage = {};
  const partial = {};
  for (const s of SENSORS) coverage[s] = days[s] ? [days[s].first, days[s].last] : null;
  const all = Object.values(coverage).filter(Boolean);
  if (!all.length) throw new Error('no NRT records for any sensor: coverage cannot be derived');
  const lastDay = all.map((c) => c[1]).sort().at(-1);
  for (const s of SENSORS) partial[s] = days[s] ? partialDays(dayCounts[s] ?? {}, days[s], fetchedAt.slice(0, 10), lastDay) : [];
  return {
    schema: 1,
    kind: 'live',
    fetched_at: fetchedAt,
    base_url: baseUrl,
    grid: { res: 0.1, tile_deg: 10 },
    granularity: 'day',
    day0: all.map((c) => c[0]).sort()[0],
    last_day: lastDay,
    coverage,
    partial_days: partial,
    partial_share: PARTIAL_SHARE,
    daily_records: dayCounts,
    satellites: SATELLITES,
    sources,
    ...(stats ?? {}),
    tiles,
    ...(domain ? { domain } : {}),
    citation: LIVE_CITATION,
    caveats: LIVE_CAVEATS,
  };
}

function listFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return EXT.test(p) ? [p] : [];
  return fs.readdirSync(p).sort().flatMap((n) => listFiles(path.join(p, n)));
}

/**
 * @param {{inputs: string[], outDir: string, fetchedAt: string, domainFile?: string, baseUrl?: string}} o
 *   `fetchedAt` is an ISO 8601 UTC time ("...Z"), passed in.
 */
export async function buildLive({ inputs, outDir, fetchedAt, domainFile, baseUrl }) {
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(fetchedAt ?? '')) throw new Error('fetchedAt must be an ISO 8601 UTC time ending in Z');
  let clipper, domainBox, domainInfo;
  if (domainFile) {
    const gj = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
    const polys = polygonsOf(gj);
    clipper = createClipper(polys);
    domainBox = bboxOfPolygons(polys);
    domainInfo = { id: gj.domain?.id ?? path.basename(domainFile, '.geojson'), version: String(gj.domain?.version ?? 'unknown'), file: 'domain.json', res: 0.1 };
  }
  const files = inputs.flatMap(listFiles);
  if (!files.length) throw new Error('no .csv, .csv.gz or .dbf files found in the inputs');

  const into = createBinResult();
  const days = {};
  const dayCounts = {};
  const sources = [];
  const reader = { read: 0, rejected: {} };
  let noType = 0;
  let clippedByDomain = 0;
  for (const f of files) {
    const rs = newStats();
    const src = { file: path.basename(f), records: 0, has_type: false };
    const tap = async function* () {
      for await (const rec of readFirms(f, rs)) {
        src.records++;
        if (rec.hasType) src.has_type = true; else noType++;
        const fam = familyOf(rec);
        if (fam) {
          const d = (days[SENSOR_OF[fam]] ??= { first: rec.utcDay, last: rec.utcDay });
          if (rec.utcDay < d.first) d.first = rec.utcDay;
          if (rec.utcDay > d.last) d.last = rec.utcDay;
        }
        // Partial days are judged on the whole feed, before the clip (gate V3 L2 re-check): in-domain
        // counts flag ordinary low-fire days and push month totals up.
        if (fam) {
          const c = ((dayCounts[SENSOR_OF[fam]] ??= {})[rec.utcDay] ??= {});
          const pass = rec.daynight ?? 'A';
          c[pass] = (c[pass] ?? 0) + 1;
        }
        if (clipper && !(inBbox(domainBox, rec.lon, rec.lat) && clipper.contains(rec.lon, rec.lat))) { clippedByDomain++; continue; }
        yield rec;
      }
    };
    await binRecords(tap(), { day0: '1970-01-01', into, allowNoType: true });
    sources.push(src);
    reader.read += rs.read;
    for (const [k, v] of Object.entries(rs.rejected)) reader.rejected[k] = (reader.rejected[k] ?? 0) + v;
  }

  const tileIds = [...new Set(Object.values(into.counts).flatMap((f) => Object.keys(f)))].sort(compareTileIds);
  const fcd = Object.fromEntries(SENSORS.map((s) => [s, 0]));
  for (const [fam, tiles] of Object.entries(into.counts)) {
    for (const cells of Object.values(tiles)) for (const ds of Object.values(cells)) for (const n of ds.values()) fcd[SENSOR_OF[fam]] += n;
  }
  const manifest = buildLiveManifest({
    fetchedAt, days, dayCounts, tiles: tileIds, sources, domain: domainInfo, baseUrl,
    stats: {
      records_without_type: noType,
      skipped: into.stats.skipped,
      duplicates: into.stats.duplicates,
      clipped_by_domain: clippedByDomain,
      fire_cell_days: fcd,
    },
  });
  const cov = Object.fromEntries(SENSORS.map((s) => [s, manifest.coverage[s]?.map(dayNumber) ?? null]));
  const built = buildLiveTiles(into.counts, cov, dayNumber(manifest.day0), manifest.partial_days);
  const dir = path.join(outDir, 'tiles', '0.1');
  fs.rmSync(path.join(outDir, 'tiles'), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const size = { tiles: 0, bytes: 0, brotli: 0 };
  for (const [id, t] of built) {
    const text = serializeLiveTile(t);
    fs.writeFileSync(path.join(dir, `${id}.json`), text);
    size.tiles++;
    size.bytes += Buffer.byteLength(text);
    size.brotli += zlib.brotliCompressSync(text).length;
  }
  if (clipper) fs.writeFileSync(path.join(outDir, 'domain.json'), `${JSON.stringify(clipper.domain)}\n`);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, stats: {
    detections_in: reader.read, rejected: reader.rejected, bin_rejected: into.stats.rejected,
    records_without_type: noType, skipped: into.stats.skipped, duplicates: into.stats.duplicates,
    clipped_by_domain: clippedByDomain, fire_cell_days: fcd, tiles: size,
    day0: manifest.day0, last_day: manifest.last_day,
  } };
}

async function main() {
  const { values } = parseArgs({ options: {
    in: { type: 'string', multiple: true }, out: { type: 'string' }, domain: { type: 'string' },
    'fetched-at': { type: 'string' }, download: { type: 'string' }, 'base-url': { type: 'string' },
  } });
  if (!values.in?.length || !values.out) {
    console.error('usage: node pipeline/live.js --in <dir|file> --out <dir> [--domain file.geojson] [--fetched-at ISO] [--download 24h|48h|7d]');
    process.exit(2);
  }
  const fetchedAt = values['fetched-at'] ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  if (values.download) await downloadNrt({ fetch, urls: nrtUrls(values.download), dir: values.in[0] });
  const { stats } = await buildLive({ inputs: values.in, outDir: values.out, fetchedAt, domainFile: values.domain, baseUrl: values['base-url'] });
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
