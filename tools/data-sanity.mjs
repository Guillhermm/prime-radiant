/**
 * Data sanity report (M1-K4). Re-reads the raw inputs the way pipeline/build.js does (same reader,
 * same clip, same binning, one year at a time) and prints, per year and sensor, detections in vs
 * fire-cell-days out, then checks the totals against the published tiles.
 *   node tools/data-sanity.mjs report --in raw/country --in raw/spike-2026 --data data/brazil --domain pipeline/domain/brazil.geojson
 *   node tools/data-sanity.mjs cell --in raw/country --data data/brazil --lon -57.05 --lat -17.95 --month 2020-09
 * `cell` lists the raw rows of the 0.1 deg cell that holds (lon, lat) in that month, per sensor, and the
 * tile value. Output is Markdown. Reads no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { polygonsOf, bboxOfPolygons, createClipper } from '../core/domain.js';
import { locate } from '../core/grid.js';
import { monthIndex } from '../core/months.js';
import { readFirms, newStats } from '../pipeline/read.js';
import { binRecords, createBinResult } from '../pipeline/bin.js';
import { yearOf, inBbox } from '../pipeline/build.js';

const EXT = /\.(csv|csv\.gz|zip|dbf)$/i;
const FAMILIES = ['modis', 'viirs', 'noaa20'];
const listFiles = (p) => (fs.statSync(p).isFile() ? (EXT.test(p) ? [p] : []) : fs.readdirSync(p).sort().flatMap((n) => listFiles(path.join(p, n))));

/** Sensor family of a raw file from its name. */
export function labelOf(file) {
  const n = path.basename(file).toLowerCase();
  if (/^modis|m-c61/.test(n)) return 'modis';
  if (/snpp|sv-c2/.test(n)) return 'viirs';
  if (/jpss1|j1v/.test(n)) return 'noaa20';
  return 'other';
}
const famOut = (f) => (f === 'modis_terra_only' ? 'modis' : f);

export async function report({ inputs, dataDir, domainFile, month0 = '2000-01' }) {
  const gj = JSON.parse(fs.readFileSync(domainFile, 'utf8'));
  const clipper = createClipper(polygonsOf(gj));
  const box = bboxOfPolygons(polygonsOf(gj));
  const groups = new Map();
  for (const f of inputs.flatMap(listFiles)) (groups.get(yearOf(f)) ?? groups.set(yearOf(f), []).get(yearOf(f))).push(f);
  const rows = []; // {year, sensor, in, rejected, accepted, clipped, skipped, dup, out}
  const reasons = {};
  for (const y of [...groups.keys()].sort()) {
    const into = createBinResult();
    const per = {};
    const cell = (s) => (per[s] ??= { in: 0, rejected: 0, accepted: 0, clipped: 0, skipped: 0, dup: 0, out: 0 });
    for (const f of groups.get(y)) {
      const s = labelOf(f);
      const rs = newStats();
      const c = cell(s);
      const before = { skipped: 0, dup: into.stats.duplicates, rej: into.stats.rejected };
      for (const v of Object.values(into.stats.skipped)) before.skipped += v;
      const tap = async function* () {
        for await (const rec of readFirms(f, rs)) {
          if (!inBbox(box, rec.lon, rec.lat) || !clipper.contains(rec.lon, rec.lat)) { c.clipped++; continue; }
          yield rec;
        }
      };
      await binRecords(tap(), { month0, into });
      let sk = 0;
      for (const v of Object.values(into.stats.skipped)) sk += v;
      c.in += rs.read;
      c.accepted += rs.accepted;
      c.rejected += rs.read - rs.accepted;
      c.skipped += sk - before.skipped + (into.stats.rejected - before.rej);
      c.dup += into.stats.duplicates - before.dup;
      for (const [k, v] of Object.entries(rs.rejected)) reasons[k] = (reasons[k] ?? 0) + v;
    }
    for (const [fam, tiles] of Object.entries(into.counts)) {
      let n = 0;
      for (const cells of Object.values(tiles)) for (const ms of Object.values(cells)) for (const v of ms.values()) n += v;
      cell(famOut(fam)).out += n;
    }
    for (const [s, c] of Object.entries(per)) {
      if (c.accepted !== c.clipped + c.skipped + c.dup + c.out) {
        // accepted counts rows before the clip; clipped counts only accepted rows, so this must close
        throw new Error(`year ${y} ${s}: accepted ${c.accepted} != clipped+skipped+dup+out ${c.clipped + c.skipped + c.dup + c.out}`);
      }
      rows.push({ year: y, sensor: s, ...c });
    }
  }
  // tiles side: fire-cell-days per year and sensor from the published fine tiles
  const tileSum = {};
  const dir = path.join(dataDir, 'tiles', '0.1');
  for (const f of fs.readdirSync(dir)) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    t.month.forEach((m, i) => {
      const y = String(2000 + Math.floor(m / 12));
      for (const s of FAMILIES) tileSum[`${y}:${s}`] = (tileSum[`${y}:${s}`] ?? 0) + (t[s][i] ?? 0);
    });
  }
  return { rows, reasons, tileSum };
}

const fmt = (n) => n.toLocaleString('en-US');
function printReport({ rows, reasons, tileSum }) {
  console.log('| Year | Sensor | Rows read | Rejected by reader | Clipped by domain | Other satellites / bad day | Same cell and day as another row | Fire-cell-days out | In published tiles |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const tot = {};
  for (const r of rows) {
    if (r.sensor === 'other') continue;
    const t = tileSum[`${r.year}:${r.sensor}`] ?? 0;
    console.log(`| ${r.year} | ${r.sensor} | ${fmt(r.in)} | ${fmt(r.rejected)} | ${fmt(r.clipped)} | ${fmt(r.skipped)} | ${fmt(r.dup)} | ${fmt(r.out)} | ${fmt(t)}${t === r.out ? '' : ' MISMATCH'} |`);
    const a = (tot[r.sensor] ??= { in: 0, rejected: 0, clipped: 0, skipped: 0, dup: 0, out: 0, t: 0 });
    for (const k of ['in', 'rejected', 'clipped', 'skipped', 'dup', 'out']) a[k] += r[k];
    a.t += t;
  }
  for (const [s, a] of Object.entries(tot)) console.log(`| total | ${s} | ${fmt(a.in)} | ${fmt(a.rejected)} | ${fmt(a.clipped)} | ${fmt(a.skipped)} | ${fmt(a.dup)} | ${fmt(a.out)} | ${fmt(a.t)} |`);
  console.log('\nRejected by reader, by reason:', JSON.stringify(reasons));
  console.log('Rows from files that are no sensor of the app (landsat and the like):', rows.filter((r) => r.sensor === 'other').map((r) => `${r.year}=${r.in}`).join(' ') || 'none');
}

async function cellReport({ inputs, dataDir, lon, lat, month }) {
  const here = locate(lon, lat);
  console.log(`Cell lon ${lon} lat ${lat} -> tile ${here.tile}, cell ${here.cell}; month ${month}`);
  const out = {};
  for (const f of inputs.flatMap(listFiles)) {
    if (!f.includes(month.slice(0, 4))) continue;
    for await (const r of readFirms(f, newStats())) {
      if (r.utcDay.slice(0, 7) !== month) continue;
      const p = locate(r.lon, r.lat);
      if (p.tile !== here.tile || p.cell !== here.cell) continue;
      (out[`${r.sensor}/${r.satellite}`] ??= []).push(r);
    }
  }
  // raw rows with their original columns are printed by the caller's grep; here: reduced to day lists
  const t = JSON.parse(fs.readFileSync(path.join(dataDir, 'tiles', '0.1', `${here.tile}.json`), 'utf8'));
  const idx = monthIndex(month) - monthIndex('2000-01');
  const row = t.cell.findIndex((c, i) => c === here.cell && t.month[i] === idx);
  const bySensor = {};
  for (const [k, rs] of Object.entries(out)) {
    console.log(`${k}: ${rs.length} rows, ${new Set(rs.map((r) => r.utcDay)).size} days`);
    (bySensor[{ 'modis/Terra': 'modis', 'modis/Aqua': 'modis', 'viirs/SNPP': 'viirs', 'viirs/NOAA20': 'noaa20' }[k] ?? k] ??= []).push(...rs);
  }
  for (const [s, rs] of Object.entries(bySensor)) {
    const days = new Set(rs.map((r) => r.utcDay));
    console.log(`${s} (satellites merged): ${rs.length} rows -> ${days.size} fire-cell-days: ${[...days].sort().map((d) => d.slice(8)).join(' ')}`);
  }
  console.log(`Tile ${here.tile} row for this cell and month: ${row < 0 ? 'none' : JSON.stringify({ modis: t.modis[row], viirs: t.viirs[row], noaa20: t.noaa20[row] })}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const { values } = parseArgs({ args: rest, options: { in: { type: 'string', multiple: true }, data: { type: 'string' }, domain: { type: 'string' }, lon: { type: 'string' }, lat: { type: 'string' }, month: { type: 'string' } } });
  if (cmd === 'report') printReport(await report({ inputs: values.in, dataDir: values.data, domainFile: values.domain }));
  else if (cmd === 'cell') await cellReport({ inputs: values.in, dataDir: values.data, lon: Number(values.lon), lat: Number(values.lat), month: values.month });
  else { console.error('usage: data-sanity.mjs report|cell ...'); process.exit(2); }
}
