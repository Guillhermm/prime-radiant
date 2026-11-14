/**
 * Build CLI: FIRMS archive files -> tiles + manifest.
 *   node pipeline/build.js --in raw/country --in raw/firms-2026 --out data/ [--bbox w,s,e,n]
 *     [--domain pipeline/domain/brazil.geojson]
 * With --domain, records outside the polygon are dropped (clipped_by_domain) after the bbox
 * prefilter and domain.json is written next to the manifest. Coverage still counts them.
 * Archive files only: NRT records (no `type` field) are skipped and counted. One year at a
 * time: files are grouped by the year in their name (or their folder), and the dedupe set of
 * a year is dropped once its files are binned. Files with no year in either come last.
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
import { compareTileIds, writeTiles } from './write-tiles.js';

const EXT = /\.(csv|csv\.gz|dbf)$/i;

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
 *   generatedAt?: string, baseUrl?: string, domainFile?: string}} o
 */
export async function build({ inputs, outDir, bbox, month0 = '2000-01', dataVersion, generatedAt = new Date().toISOString(), baseUrl = 'data/', domainFile }) {
  const t0 = performance.now();
  if (bbox) checkBbox(bbox);
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
  const groups = new Map();
  for (const f of files) {
    const y = yearOf(f);
    (groups.get(y) ?? groups.set(y, []).get(y)).push(f);
  }
  const order = [...groups.keys()].sort((a, b) => (a === null) - (b === null) || String(a).localeCompare(String(b)));

  const into = createBinResult();
  const coverage = createCoverage();
  const reader = { read: 0, accepted: 0, rejected: {} };
  let clipped = 0;
  let clippedByDomain = 0;
  for (const y of order) {
    for (const f of groups.get(y)) {
      const rs = newStats();
      const tap = async function* () {
        for await (const rec of readFirms(f, rs)) {
          if (rec.hasType && rec.utcDay.slice(0, 7) >= month0) coverage.add(rec);
          if (bbox && !inBbox(bbox, rec.lon, rec.lat)) { clipped++; continue; }
          if (clipper && !(inBbox(domainBox, rec.lon, rec.lat) && clipper.contains(rec.lon, rec.lat))) { clippedByDomain++; continue; }
          yield rec;
        }
      };
      await binRecords(tap(), { month0, into });
      reader.read += rs.read;
      reader.accepted += rs.accepted;
      for (const [k, v] of Object.entries(rs.rejected)) reader.rejected[k] = (reader.rejected[k] ?? 0) + v;
    }
    if (y !== null) into.dedupe.dropYear(y);
  }

  const tileIds = [...new Set(Object.values(into.counts).flatMap((f) => Object.keys(f)))].sort(compareTileIds);
  const manifest = buildManifest({
    month0, days: coverage.days(), tiles: tileIds, generatedAt, baseUrl, domain: domainInfo,
    dataVersion: dataVersion ?? generatedAt.slice(0, 10).replaceAll('-', ''),
  });
  const written = writeTiles(into.counts, coverageIndexes(manifest), outDir);
  fs.mkdirSync(outDir, { recursive: true });
  if (clipper) fs.writeFileSync(path.join(outDir, 'domain.json'), `${JSON.stringify(clipper.domain)}\n`);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const fcd = Object.fromEntries(Object.entries(into.counts).map(([fam, tiles]) =>
    [fam, Object.values(tiles).reduce((a, cells) => a + Object.values(cells).reduce((b, ms) => b + [...ms.values()].reduce((c, n) => c + n, 0), 0), 0)]));
  return {
    manifest,
    stats: {
      detections_in: reader.read, accepted: reader.accepted, rejected: reader.rejected, clipped_by_bbox: clipped, clipped_by_domain: clippedByDomain,
      skipped: into.stats.skipped, bin_rejected: into.stats.rejected, duplicates: into.stats.duplicates,
      fire_cell_days: fcd, tiles: written.stats,
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
    domain: { type: 'string' }, month0: { type: 'string' }, 'data-version': { type: 'string' }, 'base-url': { type: 'string' },
  } });
  if (!values.in?.length || !values.out) {
    console.error('usage: node pipeline/build.js --in <dir|file> [--in ...] --out <dir> [--bbox w,s,e,n] [--domain file.geojson] [--month0 YYYY-MM]');
    process.exit(2);
  }
  const bbox = values.bbox ? values.bbox.split(',').map(Number) : undefined;
  const { stats } = await build({
    inputs: values.in, outDir: values.out, bbox, month0: values.month0,
    domainFile: values.domain, dataVersion: values['data-version'], baseUrl: values['base-url'],
  });
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
