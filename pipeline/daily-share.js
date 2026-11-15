/**
 * Mean cumulative within-month share table (gate V3, L1): share[m][d-1] is the mean, over the
 * complete S-NPP months of calendar month m+1, of (fire-cell-days up to the end of day d) /
 * (fire-cell-days of the month). Used by core/live.js to scale a month to date to a full month.
 *   node pipeline/daily-share.js --in raw/country --years 2012-2025 --domain pipeline/domain/brazil.geojson
 *     --manifest data/brazil/manifest.json --out core/data/daily-share.json
 * Reads `viirs-snpp_{year}_Brazil.csv` (`--country` changes the name), type 0 only, domain clip, same
 * fire-cell-day dedupe as the archive. Months in the manifest's `partial_months.viirs` are excluded
 * (so are months without detections). A day past the end of a month counts as 1; a calendar month
 * with no usable month is null.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { polygonsOf, bboxOfPolygons, createClipper } from '../core/domain.js';
import { locate } from '../core/grid.js';
import { readFirms } from './read.js';
import { createDedupe } from './dedupe.js';
import { inBbox } from './build.js';

/** counts: {"YYYY-MM": number[31]} fire-cell-days per day of month -> share[12][31]. */
export function shareTable(counts, partialMonths = []) {
  const skip = new Set(partialMonths);
  const sum = Array.from({ length: 12 }, () => new Array(31).fill(0));
  const n = new Array(12).fill(0);
  for (const [ym, days] of Object.entries(counts)) {
    const total = days.reduce((a, b) => a + b, 0);
    if (skip.has(ym) || total === 0) continue;
    const m = +ym.slice(5, 7) - 1;
    let cum = 0;
    for (let d = 0; d < 31; d++) { cum += days[d]; sum[m][d] += cum / total; }
    n[m]++;
  }
  return sum.map((row, m) => (n[m] ? row.map((v) => +(v / n[m]).toFixed(4)) : null));
}

/** Daily fire-cell-days per month from the yearly files; returns {counts, years}. */
export async function dailyCounts({ dir, years, country = 'Brazil', domainFile }) {
  let clipper, box;
  if (domainFile) {
    const polys = polygonsOf(JSON.parse(fs.readFileSync(domainFile, 'utf8')));
    clipper = createClipper(polys);
    box = bboxOfPolygons(polys);
  }
  const counts = {};
  const used = [];
  for (const y of years) {
    const file = path.join(dir, `viirs-snpp_${y}_${country}.csv`);
    if (!fs.existsSync(file)) continue;
    used.push(y);
    const dedupe = createDedupe();
    for await (const r of readFirms(file)) {
      if (r.satellite !== 'SNPP' || !r.utcDay.startsWith(`${y}-`)) continue;
      if (clipper && !(inBbox(box, r.lon, r.lat) && clipper.contains(r.lon, r.lat))) continue;
      const l = locate(r.lon, r.lat);
      if (!dedupe.add('viirs', l.tile, l.cell, r.utcDay)) continue;
      (counts[r.utcDay.slice(0, 7)] ??= new Array(31).fill(0))[+r.utcDay.slice(8) - 1]++;
    }
  }
  return { counts, years: used };
}

async function main() {
  const { values: v } = parseArgs({ options: {
    in: { type: 'string' }, years: { type: 'string' }, domain: { type: 'string' }, manifest: { type: 'string' },
    out: { type: 'string' }, country: { type: 'string' },
  } });
  const m = /^(\d{4})-(\d{4})$/.exec(v.years ?? '');
  if (!v.in || !m || !v.out) {
    console.error('usage: node pipeline/daily-share.js --in <dir> --years 2012-2025 --out file.json [--domain file.geojson] [--manifest manifest.json] [--country Brazil]');
    process.exit(2);
  }
  const years = Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i);
  const partial = v.manifest ? JSON.parse(fs.readFileSync(v.manifest, 'utf8')).partial_months?.viirs ?? [] : [];
  const { counts, years: used } = await dailyCounts({ dir: v.in, years, country: v.country, domainFile: v.domain });
  const out = {
    source: `FIRMS archive S-NPP VIIRS standard, type 0, country files ${path.basename(v.in)}/viirs-snpp_{year}_${v.country ?? 'Brazil'}.csv; fire-cell-days with the domain clip; complete months only (manifest partial_months.viirs excluded)`,
    years: used,
    command: `node pipeline/daily-share.js ${process.argv.slice(2).join(' ')}`,
    share: shareTable(counts, partial),
  };
  fs.mkdirSync(path.dirname(v.out), { recursive: true });
  fs.writeFileSync(v.out, `${JSON.stringify(out, null, 1).replace(/\[\n\s+([\d.,\s\n]+?)\n\s+\]/g, (_, a) => `[${a.replace(/\s+/g, ' ')}]`)}\n`);
  console.log(`${used.length} years, ${Object.keys(counts).length} months`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
