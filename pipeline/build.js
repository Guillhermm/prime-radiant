/**
 * Build CLI: FIRMS archive files -> tiles + manifest.
 *   node pipeline/build.js --in raw/country --in raw/firms-2026 --out data/ [--bbox w,s,e,n]
 *     [--domain pipeline/domain/brazil.geojson] [--admin1 pipeline/domain/brazil-admin1.geojson]
 * With --domain, records outside the polygon are dropped (clipped_by_domain) after the bbox
 * prefilter and domain.json is written next to the manifest. Coverage still counts them.
 * Archive files only: NRT records (no `type` field) are skipped and counted. One year at a
 * time: files are grouped by the year in their name (or their folder), and the dedupe set of
 * a year is dropped once its files are binned. Files with no year in either come last.
 * A first pass over the same files builds the static-source mask (pipeline/static-mask.js); type-0
 * records in a masked cell are dropped and counted as static_masked. `staticMask: false` skips it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { checkBbox } from '../core/tiles.js';
import { polygonsOf, bboxOfPolygons, createClipper } from '../core/domain.js';
import { readFirms, newStats } from './read.js';
import { binRecords, createBinResult } from './bin.js';
import { createCoverage, buildManifest, coverageIndexes } from './manifest.js';
import { compareTileIds, writeTileSet } from './write-tiles.js';
import { compactInto, countsOf, createStore, tileIdsOf, totalsOf } from './compact.js';
import { regionOf, writeOverview } from './overview.js';
import { createPlaces } from './places.js';
import { writePlaces } from './gazetteer.js';
import { writeGlobalLevel } from './levels.js';
import { createMaskBuilder, maskKey, serializeMask, STATIC_MASK } from './static-mask.js';

const EXT = /\.(csv|csv\.gz|zip|dbf)$/i;

function listFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return EXT.test(p) ? [p] : [];
  return fs.readdirSync(p).sort().flatMap((n) => listFiles(path.join(p, n)));
}

/** Year of a file from its name, else from its folder name; null when neither has one. */
export function yearOf(file) {
  const re = /(?:^|[^0-9])((?:19|20)\d\d)(?:[^0-9]|$)/;
  return re.exec(path.basename(file))?.[1] ?? re.exec(path.basename(path.dirname(file)))?.[1] ?? null;
}

export function inBbox([w, s, e, n], lon, lat) {
  const lonOk = w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
  return lonOk && lat >= s && lat <= n;
}

/**
 * @param {{inputs: string[], outDir: string, bbox?: number[], month0?: string, dataVersion?: string,
 *   generatedAt?: string, baseUrl?: string, domainFile?: string, admin1File?: string, staticMask?: boolean}} o
 */
export async function build({ inputs, outDir, bbox, month0 = '2000-01', dataVersion, generatedAt = new Date().toISOString(), baseUrl = 'data/', domainFile, admin1File, staticMask = true }) {
  const t0 = performance.now();
  if (bbox) checkBbox(bbox);
  let clipper, domainBox, domainInfo, region = null;
  if (domainFile) {
    const gj = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
    const polys = polygonsOf(gj);
    clipper = createClipper(polys);
    region = regionOf(gj);
    domainBox = bboxOfPolygons(polys);
    domainInfo = { id: gj.domain?.id ?? path.basename(domainFile, '.geojson'), version: String(gj.domain?.version ?? 'unknown'), file: 'domain.json', res: 0.1 };
  }
  const files = inputs.flatMap(listFiles);
  if (!files.length) throw new Error('no .csv, .csv.gz, .zip or .dbf files found in the inputs');
  const groups = new Map();
  for (const f of files) {
    const y = yearOf(f);
    (groups.get(y) ?? groups.set(y, []).get(y)).push(f);
  }
  const order = [...groups.keys()].sort((a, b) => (a === null) - (b === null) || String(a).localeCompare(String(b)));

  const inArea = (rec) => (!bbox || inBbox(bbox, rec.lon, rec.lat))
    && (!clipper || (inBbox(domainBox, rec.lon, rec.lat) && clipper.contains(rec.lon, rec.lat)));
  let mask = null;
  let maskStats = null;
  if (staticMask) {
    const mb = createMaskBuilder();
    for (const y of order) {
      // MODIS seeds nothing (pipeline/static-mask.js); its files are named modis_* by FIRMS.
      for (const f of groups.get(y).filter((g) => !/^modis/i.test(path.basename(g)))) {
        const rs = newStats();
        rs.allTypes = true;
        mb.startFile();
        // Typed sources outside the area still mask their neighbors inside it.
        for await (const rec of readFirms(f, rs)) if (rec.hasType && (rec.type !== 0 || inArea(rec))) mb.add(rec);
        mb.endFile();
      }
    }
    ({ mask, stats: maskStats } = mb.finish());
  }
  let staticMasked = 0;

  const into = createBinResult();
  const store = createStore();
  const coverage = createCoverage();
  const reader = { read: 0, accepted: 0, rejected: {} };
  let clipped = 0;
  let clippedByDomain = 0;
  for (const y of order) {
    for (const f of groups.get(y)) {
      const rs = newStats();
      rs.seen = (sat, day, hasType) => { if (hasType && day.slice(0, 7) >= month0) coverage.addDay(sat, day); };
      const tap = async function* () {
        for await (const rec of readFirms(f, rs)) {
          if (rec.hasType && rec.utcDay.slice(0, 7) >= month0) coverage.add(rec);
          if (bbox && !inBbox(bbox, rec.lon, rec.lat)) { clipped++; continue; }
          if (clipper && !(inBbox(domainBox, rec.lon, rec.lat) && clipper.contains(rec.lon, rec.lat))) { clippedByDomain++; continue; }
          if (mask && rec.hasType && mask.has(maskKey(rec.lat, rec.lon))) { staticMasked++; continue; }
          yield rec;
        }
      };
      await binRecords(tap(), { month0, into });
      reader.read += rs.read;
      reader.accepted += rs.accepted;
      for (const [k, v] of Object.entries(rs.rejected)) reader.rejected[k] = (reader.rejected[k] ?? 0) + v;
    }
    if (y !== null) {
      into.dedupe.dropYear(y);
      compactInto(store, into.counts);
    }
  }

  // Files with no year in their name stay in into.counts and are merged per tile.
  const loose = into.counts;
  const countsFor = (id) => {
    const c = countsOf(store, id);
    for (const [fam, tiles] of Object.entries(loose)) {
      if (!tiles[id]) continue;
      const cells = ((c[fam] ??= {})[id] ??= {});
      for (const [cell, months] of Object.entries(tiles[id])) {
        const to = (cells[cell] ??= new Map());
        for (const [m, n] of months) to.set(m, (to.get(m) ?? 0) + n);
      }
    }
    return c;
  };
  const tileIds = [...new Set([...tileIdsOf(store), ...Object.values(loose).flatMap((f) => Object.keys(f))])].sort(compareTileIds);
  const manifest = buildManifest({
    month0, days: coverage.days(), acquisition: coverage.acquisition(), tiles: tileIds, generatedAt, baseUrl, domain: domainInfo,
    dataVersion: dataVersion ?? generatedAt.slice(0, 10).replaceAll('-', ''),
  });
  const written = writeTileSet(tileIds, countsFor, coverageIndexes(manifest), outDir);
  fs.mkdirSync(outDir, { recursive: true });
  if (clipper) fs.writeFileSync(path.join(outDir, 'domain.json'), `${JSON.stringify(clipper.domain)}\n`);
  // The live job applies the same mask to near-real-time records, which carry no type.
  if (mask) fs.writeFileSync(path.join(outDir, 'static-mask.json'), serializeMask(mask));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const places = admin1File ? createPlaces(JSON.parse(fs.readFileSync(admin1File, 'utf8'))) : null;
  writeGlobalLevel(outDir);
  const overview = writeOverview(outDir, region, places);
  const placeNames = writePlaces(outDir, clipper?.domain ?? null);

  const fcd = totalsOf(store);
  for (const [fam, tiles] of Object.entries(loose)) {
    fcd[fam] = (fcd[fam] ?? 0) + Object.values(tiles).reduce((a, cells) => a + Object.values(cells).reduce((b, ms) => b + [...ms.values()].reduce((c, n) => c + n, 0), 0), 0);
  }
  return {
    manifest,
    stats: {
      detections_in: reader.read, accepted: reader.accepted, rejected: reader.rejected, clipped_by_bbox: clipped, clipped_by_domain: clippedByDomain,
      static_masked: staticMasked, static_mask: maskStats && { ...STATIC_MASK, ...maskStats },
      skipped: into.stats.skipped, bin_rejected: into.stats.rejected, duplicates: into.stats.duplicates,
      fire_cell_days: fcd, tiles: written.stats,
      place_names: placeNames.entries.length,
      overview: overview && { sensor: overview.sensor, year: overview.year, cells: overview.cells.length, hotspots: overview.hotspots.length },
      wall_seconds: +((performance.now() - t0) / 1000).toFixed(1),
      peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024),
    },
  };
}

/** `--bbox -60,-15,-50,-5` -> `--bbox=-60,...` (parseArgs rejects a value that starts with a dash). */
function joinBbox(argv) {
  return argv.flatMap((a, i) => (a === '--bbox' ? [] : argv[i - 1] === '--bbox' ? [`--bbox=${a}`] : [a]));
}

async function main() {
  const { values } = parseArgs({ args: joinBbox(process.argv.slice(2)), options: {
    in: { type: 'string', multiple: true }, out: { type: 'string' }, bbox: { type: 'string' },
    domain: { type: 'string' }, admin1: { type: 'string' }, 'no-static-mask': { type: 'boolean', default: false }, month0: { type: 'string' }, 'data-version': { type: 'string' }, 'base-url': { type: 'string' },
  } });
  if (!values.in?.length || !values.out) {
    console.error('usage: node pipeline/build.js --in <dir|file> [--in ...] --out <dir> [--bbox w,s,e,n] [--domain file.geojson] [--month0 YYYY-MM]');
    process.exit(2);
  }
  const bbox = values.bbox ? values.bbox.split(',').map(Number) : undefined;
  const { stats } = await build({
    inputs: values.in, outDir: values.out, bbox, month0: values.month0,
    domainFile: values.domain, admin1File: values.admin1, staticMask: !values['no-static-mask'], dataVersion: values['data-version'], baseUrl: values['base-url'],
  });
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
