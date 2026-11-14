/**
 * Tile writer (docs/roadmap.md section 2). Turns binRecords counts into columnar tiles:
 * `{cell[], month[], modis[], viirs[], noaa20[]}`, rows sorted by cell then month, sparse
 * (a row exists when any sensor has a count). Inside a sensor's coverage a missing count is
 * 0; outside it the value is null (never 0). `modis_terra_only` counts go into the `modis`
 * column (the eras do not overlap). The 1 deg coarse level is summed from the 0.1 deg rows,
 * so it counts fine fire-cell-days, not distinct (coarse cell, day) pairs.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { cellsPerSide, parseTileId } from '../core/grid.js';

export const SENSORS = ['modis', 'viirs', 'noaa20'];
const FAMILIES = { modis: ['modis', 'modis_terra_only'], viirs: ['viirs'], noaa20: ['noaa20'] };

/** Tile id order: west to east, then south to north (x then y, numeric). */
export function compareTileIds(a, b) {
  const [pa, pb] = [parseTileId(a), parseTileId(b)];
  return pa.tx - pb.tx || pa.ty - pb.ty;
}

/**
 * @param {Object} counts binRecords counts[family][tile][cell] = Map monthIdx -> count
 * @param {Object<string, [number, number]>} cov coverage per sensor as month indexes [from, to]
 * @returns {Map<string, {fine: object, coarse: object}>} tile id -> columnar tiles
 */
export function buildTiles(counts, cov) {
  const tileIds = new Set();
  for (const fam of Object.values(counts)) for (const t of Object.keys(fam)) tileIds.add(t);
  const out = new Map();
  for (const id of [...tileIds].sort(compareTileIds)) {
    const rows = new Map(); // "cell:month" -> {cell, month, modis, viirs, noaa20}
    for (const sensor of SENSORS) {
      for (const fam of FAMILIES[sensor]) {
        const cells = counts[fam]?.[id] ?? {};
        for (const [cell, months] of Object.entries(cells)) {
          for (const [m, n] of months) {
            const key = `${cell}:${m}`;
            const row = rows.get(key) ?? rows.set(key, { cell: +cell, month: +m }).get(key);
            row[sensor] = (row[sensor] ?? 0) + n;
          }
        }
      }
    }
    const fine = columns([...rows.values()], cov);
    out.set(id, { fine, coarse: coarsen(fine, cov) });
  }
  return out;
}

function columns(rows, cov) {
  rows.sort((a, b) => a.cell - b.cell || a.month - b.month);
  const t = { cell: [], month: [], modis: [], viirs: [], noaa20: [] };
  for (const r of rows) {
    t.cell.push(r.cell);
    t.month.push(r.month);
    for (const s of SENSORS) {
      const inside = r.month >= cov[s][0] && r.month <= cov[s][1];
      t[s].push(inside ? (r[s] ?? 0) : null);
    }
  }
  return t;
}

/** Sum a fine tile into 1 deg cells (coarse cell = floor(row/10)*10 + floor(col/10)); nulls stay null. */
export function coarsen(fine, cov) {
  const per = cellsPerSide(0.1);
  const rows = new Map();
  fine.cell.forEach((c, i) => {
    const cc = Math.floor(c / per / 10) * 10 + Math.floor((c % per) / 10);
    const key = `${cc}:${fine.month[i]}`;
    const row = rows.get(key) ?? rows.set(key, { cell: cc, month: fine.month[i] }).get(key);
    for (const s of SENSORS) if (fine[s][i] !== null) row[s] = (row[s] ?? 0) + fine[s][i];
  });
  return columns([...rows.values()], cov);
}

/** Stable text form: one array per line, so files diff and compress well. */
export function serializeTile(t) {
  const body = ['cell', 'month', ...SENSORS].map((k) => `  "${k}": ${JSON.stringify(t[k])}`).join(',\n');
  return `{\n${body}\n}\n`;
}

/**
 * Write tiles under `<outDir>/tiles/{0.1,1}/x{tx}y{ty}.json`.
 * @returns {{tiles: string[], stats: Object<string, {tiles: number, bytes: number, brotli: number}>}}
 */
export function writeTiles(counts, cov, outDir) {
  const built = buildTiles(counts, cov);
  const stats = { 0.1: { tiles: 0, bytes: 0, brotli: 0 }, 1: { tiles: 0, bytes: 0, brotli: 0 } };
  for (const res of ['0.1', '1']) fs.mkdirSync(path.join(outDir, 'tiles', res), { recursive: true });
  for (const [id, { fine, coarse }] of built) {
    for (const [res, t] of [['0.1', fine], ['1', coarse]]) {
      const text = serializeTile(t);
      fs.writeFileSync(path.join(outDir, 'tiles', res, `${id}.json`), text);
      const s = stats[res];
      s.tiles++;
      s.bytes += Buffer.byteLength(text);
      s.brotli += zlib.brotliCompressSync(text).length;
    }
  }
  return { tiles: [...built.keys()], stats };
}
