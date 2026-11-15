// FIRMS archive reader: streams .csv, .csv.gz and .dbf (dBase III attribute table of a
// FIRMS Shapefile) and yields normalized records. Standard library only.
//
// Record: { sensor: 'modis'|'viirs', satellite: 'Terra'|'Aqua'|'SNPP'|'NOAA20'|'NOAA21',
//           lat, lon, utcDay: 'YYYY-MM-DD', hasType, daynight? ('D'|'N', only when the file has the column) }
// Rows that fail validation are never yielded and never silent: they are counted by
// reason in `stats.rejected`. type != 0 is rejected as 'type_excluded' when the file has a
// type field; files without one (NRT) yield records with hasType = false.
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';

// Satellite code -> [sensor, satellite]. MODIS codes verified in real CSV and DBF
// (Terra, Aqua; the NRT text files use T, A); S-NPP: CSV 'N', DBF 'SNPP'; NOAA-20 'N20' in CSV and DBF; NOAA-21 DBF 'N21'.
// Any other code (e.g. Landsat 'L8') is rejected and counted under 'satellite'.
const SATELLITES = new Map([
  ['Terra', ['modis', 'Terra']],
  ['Aqua', ['modis', 'Aqua']],
  ['T', ['modis', 'Terra']], // NRT text files (verified 2026-11-15 in MODIS_C6_1_Global_24h.csv)
  ['A', ['modis', 'Aqua']],
  ['N', ['viirs', 'SNPP']],
  ['SNPP', ['viirs', 'SNPP']],
  ['N20', ['viirs', 'NOAA20']],
  ['N21', ['viirs', 'NOAA21']],
]);

export const REJECT_REASONS = [
  'columns', 'lat', 'lon', 'date', 'time', 'satellite',
  'type_invalid', 'type_excluded', 'deleted', 'truncated',
];
const REQUIRED = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite'];

export function newStats() {
  return { read: 0, accepted: 0, rejected: {} };
}

function reject(stats, reason) {
  stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
  return null;
}

function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function validTime(s) {
  const m = /^(\d{2})(\d{2})$/.exec(s);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

function num(s) {
  // Real FIRMS DBF files write values near 0 in exponent form (e.g. lat '-7e-05').
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : NaN;
}

// Validate raw string fields {lat, lon, date (YYYY-MM-DD), time, satellite, type|undefined}.
// Returns a record, or null after counting the rejection.
export function normalize(f, stats) {
  const lat = num(f.lat);
  if (!(lat >= -90 && lat <= 90)) return reject(stats, 'lat');
  const lon = num(f.lon);
  if (!(lon >= -180 && lon <= 180)) return reject(stats, 'lon');
  if (!validDate(f.date)) return reject(stats, 'date');
  if (!validTime(f.time)) return reject(stats, 'time');
  const sat = SATELLITES.get(f.satellite);
  if (!sat) return reject(stats, 'satellite');
  const hasType = f.type !== undefined;
  stats.seen?.(sat[1], f.date, hasType); // acquisition days: any type, before the type filter
  if (hasType) {
    if (!/^\d+$/.test(f.type)) return reject(stats, 'type_invalid');
    if (Number(f.type) !== 0) return reject(stats, 'type_excluded');
  }
  stats.accepted++;
  const rec = { sensor: sat[0], satellite: sat[1], lat, lon, utcDay: f.date, hasType };
  if (f.daynight !== undefined) rec.daynight = f.daynight; // 'D' or 'N' when the file has the column
  return rec;
}

function columnMap(names) {
  const idx = {};
  names.forEach((n, i) => { idx[n.replace(/^\uFEFF/, '').trim().toLowerCase()] = i; });
  const missing = REQUIRED.filter((k) => !(k in idx));
  if (missing.length) throw new Error(`FIRMS header lacks required column(s): ${missing.join(', ')}`);
  return idx;
}

async function* readCsv(path, stats) {
  let input = fs.createReadStream(path);
  if (path.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let idx = null;
  for await (const line of rl) {
    if (idx === null) { idx = columnMap(line.split(',')); idx.width = line.split(',').length; continue; }
    if (line.trim() === '') continue;
    stats.read++;
    const c = line.split(',');
    if (c.length !== idx.width) { reject(stats, 'columns'); continue; }
    const g = (k) => c[idx[k]].trim();
    const rec = normalize({
      lat: g('latitude'), lon: g('longitude'), date: g('acq_date'), time: g('acq_time'),
      satellite: g('satellite'), type: 'type' in idx ? g('type') : undefined,
      daynight: 'daynight' in idx ? g('daynight') : undefined,
    }, stats);
    if (rec) yield rec;
  }
}

async function* readDbf(path, stats) {
  const fd = fs.createReadStream(path, { highWaterMark: 1 << 20 });
  let buf = Buffer.alloc(0);
  let fields = null;
  let recLen = 0;
  let headerLen = 0;
  let remaining = 0;
  let pos = 0; // start of unconsumed data in buf
  for await (const chunk of fd) {
    buf = pos < buf.length ? Buffer.concat([buf.subarray(pos), chunk]) : chunk;
    pos = 0;
    if (fields === null) {
      if (buf.length < 32) continue;
      headerLen = buf.readUInt16LE(8);
      recLen = buf.readUInt16LE(10);
      if (buf.length < headerLen) continue;
      remaining = buf.readUInt32LE(4);
      const names = [];
      const cols = {};
      let off = 1;
      for (let p = 32; p + 32 <= headerLen && buf[p] !== 0x0d; p += 32) {
        const name = buf.toString('latin1', p, p + 11).split('\0')[0].toLowerCase();
        const len = buf[p + 16];
        names.push(name);
        cols[name] = { off, len };
        off += len;
      }
      columnMap(names);
      fields = cols;
      pos = headerLen;
    }
    while (remaining > 0 && buf.length - pos >= recLen) {
      const rs = pos;
      pos += recLen;
      remaining--;
      stats.read++;
      if (buf[rs] === 0x2a) { reject(stats, 'deleted'); continue; }
      const g = (k) => buf.toString('latin1', rs + fields[k].off, rs + fields[k].off + fields[k].len).trim();
      const d = g('acq_date');
      const rec = normalize({
        lat: g('latitude'), lon: g('longitude'),
        date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d,
        time: g('acq_time'), satellite: g('satellite'),
        type: 'type' in fields ? g('type') : undefined,
        daynight: 'daynight' in fields ? g('daynight') : undefined,
      }, stats);
      if (rec) yield rec;
    }
  }
  if (fields === null) throw new Error('DBF header incomplete or file empty');
  if (remaining > 0) stats.rejected.truncated = (stats.rejected.truncated || 0) + remaining;
}

// Async iterable of records for one file; `stats` (from newStats) is filled as it streams.
export function readFirms(path, stats = newStats()) {
  const p = String(path).toLowerCase();
  if (p.endsWith('.dbf')) return readDbf(path, stats);
  if (p.endsWith('.csv') || p.endsWith('.csv.gz')) return readCsv(path, stats);
  throw new Error(`Unsupported FIRMS file (want .csv, .csv.gz or .dbf): ${path}`);
}
