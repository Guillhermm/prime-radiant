/**
 * Rolling live history. FIRMS serves at most 7 days of NRT, so the daily job builds the newest
 * window and merges it into the live data it published before:
 *   node pipeline/live-merge.js --prev <dir or https base> --next <new build dir> --out <dir>
 * Per sensor and day the newest build wins, except its first day, which a rolling window cuts
 * mid-day: there the earlier build's day is kept when it has one. Days older than the 1st of the
 * month before the last day are dropped. Partial days are derived again over the merged daily
 * record counts (pipeline/live.js), and a day kept from the earlier build that was null there
 * stays partial, because its counts were never stored. A build over another domain is not merged.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validateLiveManifest, validateLiveTile } from '../core/schema.js';
import { dayNumber } from './bin.js';
import { SENSORS, compareTileIds } from './write-tiles.js';
import { buildLiveManifest, buildLiveTiles, serializeLiveTile } from './live.js';

const dayString = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

/** First day kept: the 1st of the month before `lastDay`'s month. */
export const keepFrom = (lastDay) => {
  const y = Number(lastDay.slice(0, 4));
  const m = Number(lastDay.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};

/** {manifest, tiles} from a build directory or an https base URL (the published root manifest's site). */
export const readLive = async (src, { fetchFn = fetch } = {}) => {
  if (/^https:\/\//.test(src)) {
    const get = async (url) => {
      const res = await fetchFn(url, { headers: { 'user-agent': 'prime-radiant-live-job' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`live-merge: ${url} answered HTTP ${res.status}`);
      return res.json();
    };
    const root = src.endsWith('/') ? src : `${src}/`;
    const manifest = await get(`${root}live/manifest.json`);
    if (!manifest) return null;
    // base_url is "data/live/v/{version}/" relative to the site; the bucket has it without "data/".
    const base = `${root}${manifest.base_url.replace(/^data\//, '')}`;
    const tiles = {};
    for (const id of manifest.tiles) tiles[id] = await get(`${base}tiles/0.1/${id}.json`);
    return { manifest, tiles };
  }
  const file = path.join(src, 'manifest.json');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tiles = Object.fromEntries(manifest.tiles.map((id) => [id, JSON.parse(fs.readFileSync(path.join(src, 'tiles', '0.1', `${id}.json`), 'utf8'))]));
  return { manifest, tiles };
};

/**
 * Merge two live builds. Returns {manifest, tiles} with tiles as a Map id -> tile.
 * @param {{manifest: object, tiles: Record<string, object>}|null} prev
 * @param {{manifest: object, tiles: Record<string, object>}} next
 */
export const mergeLive = (prev, next) => {
  const nm = next.manifest;
  // A build over another domain (or none) cannot be merged day by day: start again from the new one.
  if (prev && (prev.manifest.domain?.id ?? null) !== (nm.domain?.id ?? null)) prev = null;
  // Nor can masked and unmasked counts (static-source mask, gate G2) be mixed.
  if (prev && !prev.manifest.static_mask !== !nm.static_mask) prev = null;
  if (!prev) return { manifest: nm, tiles: new Map(Object.entries(next.tiles)) };
  const pm = prev.manifest;
  const from = keepFrom(nm.last_day);
  // Which build each sensor-day comes from.
  const source = {};
  const days = {};
  for (const s of SENSORS) {
    const pick = new Map();
    const pc = pm.coverage[s];
    const nc = nm.coverage[s];
    if (pc) for (let d = dayNumber(pc[0]); d <= dayNumber(pc[1]); d++) pick.set(dayString(d), 'prev');
    if (nc) {
      for (let d = dayNumber(nc[0]); d <= dayNumber(nc[1]); d++) {
        const day = dayString(d);
        if (!(day === nc[0] && pick.has(day))) pick.set(day, 'next');
      }
    }
    for (const day of [...pick.keys()]) if (day < from) pick.delete(day);
    source[s] = pick;
    const list = [...pick.keys()].sort();
    days[s] = list.length ? { first: list[0], last: list.at(-1) } : null;
  }
  const records = (m, s, day) => m.daily_records?.[s]?.[day];
  const dayCounts = Object.fromEntries(SENSORS.map((s) => [s, Object.fromEntries([...source[s]]
    .map(([day, b]) => [day, records(b === 'prev' ? pm : nm, s, day)]).filter(([, r]) => r))]));

  // Counts per family-like key: counts[sensor][tile][cell] = Map(dayNumber -> n); nulls are not counts.
  const counts = Object.fromEntries(SENSORS.map((s) => [s, {}]));
  const forcedPartial = Object.fromEntries(SENSORS.map((s) => [s, new Set()]));
  for (const [which, build] of [['prev', prev], ['next', next]]) {
    const d0 = dayNumber(build.manifest.day0);
    for (const [id, t] of Object.entries(build.tiles)) {
      t.cell.forEach((cell, i) => {
        const day = dayString(d0 + t.day[i]);
        for (const s of SENSORS) {
          if (source[s].get(day) !== which) continue;
          const v = t[s][i];
          if (v === null) continue;
          const months = (((counts[s][id] ??= {})[cell]) ??= new Map());
          months.set(d0 + t.day[i], v);
        }
      });
    }
    // A day taken from this build that was partial in it has no counts: it stays partial.
    for (const s of SENSORS) for (const day of build.manifest.partial_days?.[s] ?? []) if (source[s].get(day) === which) forcedPartial[s].add(day);
  }

  const tileIds = [...new Set(SENSORS.flatMap((s) => Object.keys(counts[s])))].sort(compareTileIds);
  const sources = [...nm.sources, ...(pm.merged_sources ?? []), { file: `live ${pm.fetched_at}`, records: null, has_type: false }];
  const manifest = buildLiveManifest({
    fetchedAt: nm.fetched_at, days, dayCounts, tiles: tileIds, sources: nm.sources, domain: nm.domain, baseUrl: nm.base_url,
    stats: { merged_from: pm.fetched_at, merged_sources: sources.slice(nm.sources.length).slice(-60), ...(nm.static_mask ? { static_mask: nm.static_mask } : {}), ...(nm.share_domain ? { share_domain: nm.share_domain } : {}) },
  });
  for (const s of SENSORS) manifest.partial_days[s] = [...new Set([...manifest.partial_days[s], ...forcedPartial[s]])].filter((d) => source[s].has(d)).sort();
  const cov = Object.fromEntries(SENSORS.map((s) => [s, manifest.coverage[s]?.map(dayNumber) ?? null]));
  const tiles = buildLiveTiles(counts, cov, dayNumber(manifest.day0), manifest.partial_days);
  return { manifest, tiles };
};

/** Validate and write a merged build. */
export const writeLive = ({ manifest, tiles }, outDir) => {
  const errors = validateLiveManifest(manifest);
  if (errors.length) throw new Error(`live-merge: manifest ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
  const dir = path.join(outDir, 'tiles', '0.1');
  fs.rmSync(path.join(outDir, 'tiles'), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let bytes = 0, brotli = 0;
  for (const [id, t] of tiles) {
    const e = validateLiveTile(t, { manifest });
    if (e.length) throw new Error(`live-merge: tile ${id} ${e[0].code} ${e[0].path}`);
    const text = serializeLiveTile(t);
    fs.writeFileSync(path.join(dir, `${id}.json`), text);
    bytes += Buffer.byteLength(text);
    brotli += zlib.brotliCompressSync(text).length;
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { day0: manifest.day0, last_day: manifest.last_day, tiles: tiles.size, bytes, brotli };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { prev: { type: 'string' }, next: { type: 'string' }, out: { type: 'string' } } });
  if (!values.next || !values.out) {
    console.error('usage: node pipeline/live-merge.js [--prev <dir|https base>] --next <dir> --out <dir>');
    process.exit(2);
  }
  (async () => {
    const prev = values.prev ? await readLive(values.prev) : null;
    const next = await readLive(values.next);
    if (!next) throw new Error(`live-merge: no manifest in ${values.next}`);
    const merged = mergeLive(prev, next);
    const out = writeLive(merged, values.out);
    for (const d of [merged.manifest.domain, merged.manifest.share_domain]) if (d) fs.copyFileSync(path.join(values.next, d.file), path.join(values.out, d.file));
    console.log(JSON.stringify({ prev: prev?.manifest.fetched_at ?? null, ...out }));
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
