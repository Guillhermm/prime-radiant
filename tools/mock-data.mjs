import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateTile, validateDomain, validateOverview } from '../core/schema.js';
import { monthIndex, monthString } from '../core/months.js';
import { createClipper, polygonsOf } from '../core/domain.js';
import { buildTiles, compareTileIds } from '../pipeline/write-tiles.js';
import { buildOverview, regionOf } from '../pipeline/overview.js';

const RES = 0.1;
const MONTH0 = '2000-11';
const START = { modis: '2000-11', viirs: '2012-01', noaa20: '2018-04' };
// S-NPP stopped on 2026-11-02 (docs/method.md section 3): its last full month.
const SNPP_END = '2026-10';
const DOMAIN_FILE = new URL('../pipeline/domain/brazil.geojson', import.meta.url);

// [lon, lat, sigma deg, weight]: where the synthetic fire density concentrates.
const HOTSPOTS = [[-55, -10, 5, 1], [-60, -12, 4, 0.8], [-48, -8, 4, 0.9], [-46, -14, 4, 0.7], [-62, -16, 3.5, 0.8],
  [-52, -18, 4, 0.5], [-52, -5, 3, 0.6], [-57, -18, 1.5, 0.9], [-42, -10, 3, 0.3], [-61, 3, 2.5, 0.4]];

// Years with unusually many (or few) fires, before the random year-to-year spread.
const YEARS = { 2005: 1.9, 2007: 1.8, 2010: 2.2, 2019: 1.7, 2020: 1.8, 2024: 2.1, 2009: 0.6, 2012: 0.7, 2017: 0.75 };
// North of the equator (Roraima) burns in the northern dry season.
const PEAK = (lat) => (lat > 1 ? 2 : 9);
const SHARP = 1.6;
const INTENSITY = 10;

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hash = (...n) => n.reduce((h, v) => Math.imul(h ^ (v | 0), 0x9E3779B1) >>> 0, 0x811C9DC5);
const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const poisson = (lambda, rng) => {
  if (lambda <= 0) return 0;
  if (lambda > 25) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rng(); } while (p > limit);
  return k - 1;
};

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Latest complete month for a given date: the month before the one it is in. */
export const latestCompleteMonth = (now = new Date()) => monthString(now.getUTCFullYear() * 12 + now.getUTCMonth() - 1);

const season = (month, peak) => Math.exp(SHARP * 2 * (Math.cos((2 * Math.PI * (month - peak)) / 12) - 1));

const yearFactors = (seed, firstYear, lastYear) => {
  const rng = mulberry32(hash(seed, 13, 7));
  const out = {};
  for (let y = firstYear; y <= lastYear; y++) out[y] = (YEARS[y] ?? 1) * Math.exp(0.25 * normal(rng));
  return out;
};

const cellRate = (lon, lat, gx, gy, seed) => {
  let w = 0;
  for (const [hx, hy, sigma, weight] of HOTSPOTS) w += weight * Math.exp(-((lon - hx) ** 2 + (lat - hy) ** 2) / (2 * sigma * sigma));
  return INTENSITY * w * Math.exp(0.9 * normal(mulberry32(hash(seed, gx, gy)))) * 0.06;
};

let domainCache = null;
/** The Brazil outline the real pipeline clips to, so synthetic data has the same domain. */
export const brazilDomain = () => {
  if (!domainCache) {
    const gj = JSON.parse(readFileSync(DOMAIN_FILE, 'utf8'));
    domainCache = { info: { id: gj.domain.id, version: String(gj.domain.version), file: 'domain.json', res: RES }, region: regionOf(gj), ...createClipper(polygonsOf(gj)) };
  }
  return domainCache;
};

// Coverage as [from, to] months, null for a sensor that has no month by `last` (as the pipeline does).
const coverageFor = (last) => {
  const span = (from, to) => (from <= to ? [from, to] : null);
  return { modis: span(START.modis, last), viirs: span(START.viirs, last < SNPP_END ? last : SNPP_END), noaa20: span(START.noaa20, last) };
};

/**
 * Builds the synthetic manifest, tiles (0.1 and 1 degree) and domain in memory, inside the
 * Brazil outline only, through the pipeline's own tile builder. Same seed and options give the
 * same output.
 * @param {{seed?: number, last?: string, now?: Date}} [opts]
 * @returns {{manifest: object, tiles: Record<string, object>, coarse: Record<string, object>, domain: object}}
 */
export const generate = ({ seed = 20261114, now = new Date(), last = latestCompleteMonth(now) } = {}) => {
  const { info, region, domain, contains } = brazilDomain();
  const m0 = monthIndex(MONTH0);
  const count = monthIndex(last) - m0 + 1;
  const coverage = coverageFor(last);
  const cov = Object.fromEntries(Object.entries(coverage).map(([s, c]) => [s, c && c.map((m) => monthIndex(m) - m0)]));
  const inCov = (s, mi) => cov[s] !== null && mi >= cov[s][0] && mi <= cov[s][1];
  const factors = yearFactors(seed, 2000, Number(last.slice(0, 4)));
  const counts = { modis: {}, viirs: {}, noaa20: {} };

  for (const [row, runs] of Object.entries(domain.rows)) {
    const gy = Number(row);
    for (const [c0, c1] of runs) {
      for (let gx = c0; gx <= c1; gx++) {
        const lon = -180 + (gx + 0.5) * RES;
        const lat = -90 + (gy + 0.5) * RES;
        // The pipeline keeps a detection only when its point is inside the outline.
        if (!contains(lon, lat)) continue;
        const base = cellRate(lon, lat, gx, gy, seed);
        if (base < 1.4) continue;
        const peak = PEAK(lat);
        const ratio = 2.4 + 1.6 * mulberry32(hash(seed, gx, gy, 3))();
        const k = 0.9 + 0.2 * mulberry32(hash(seed, gx, gy, 5))();
        const rng = mulberry32(hash(seed, gx, gy, 11));
        const id = `x${Math.floor(gx / 100)}y${Math.floor(gy / 100)}`;
        const cell = (gy % 100) * 100 + (gx % 100);
        const put = (s, mi, n) => {
          if (!n) return;
          const months = ((counts[s][id] ??= {})[cell] ??= new Map());
          months.set(mi, n);
        };
        for (let mi = 0; mi < count; mi++) {
          const abs = m0 + mi;
          const year = Math.floor(abs / 12);
          const month = (abs % 12) + 1;
          const days = daysIn(year, month);
          const lambda = base * season(month, peak) * factors[year] * Math.exp(0.35 * normal(rng));
          if (inCov('modis', mi)) put('modis', mi, Math.min(days, poisson(lambda, rng)));
          if (inCov('viirs', mi)) put('viirs', mi, Math.min(days, poisson(lambda * ratio, rng)));
          if (inCov('noaa20', mi)) put('noaa20', mi, Math.min(days, poisson(lambda * ratio * k, rng)));
        }
      }
    }
  }

  const tiles = {};
  const coarse = {};
  for (const [id, t] of buildTiles(counts, cov)) {
    tiles[id] = t.fine;
    coarse[id] = t.coarse;
  }
  const stamp = (now instanceof Date ? now : new Date()).toISOString();
  const manifest = {
    schema: 1,
    // Humans and the app tell synthetic data apart by the "synthetic-" dataVersion prefix.
    dataVersion: `synthetic-${stamp.slice(0, 10).replaceAll('-', '')}`,
    generated_at: stamp,
    base_url: 'data/',
    grid: { res: RES, tile_deg: 10, coarse_res: 1 },
    month0: MONTH0,
    last_month: last,
    granularity: 'month',
    coverage,
    // S-NPP starts on 2012-01-20 (docs/method.md section 3); no synthetic outages.
    partial_months: { modis: [], viirs: coverage.viirs ? [START.viirs] : [], noaa20: [] },
    satellites: { modis: ['Terra', 'Aqua'], viirs: ['S-NPP'], noaa20: ['NOAA-20'], eras: { modis_aqua_from: '2002-07-04' } },
    tiles: Object.keys(tiles).sort(compareTileIds),
    domain: info,
    citation: 'SYNTHETIC DEMO DATA generated by tools/mock-data.mjs. Not real detections, not NASA FIRMS.',
    caveats: [],
  };
  return { manifest, tiles, coarse, domain, overview: buildOverview(manifest, coarse, region) };
};

/** Validates everything with core/schema.js; returns the list of error messages. */
export const validateAll = ({ manifest, tiles, coarse, domain, overview }) => {
  const errors = validateManifest(manifest).map((e) => `manifest ${e.path}: ${e.message}`);
  errors.push(...validateOverview(overview).map((e) => `overview ${e.path}: ${e.message}`));
  errors.push(...validateDomain(domain).map((e) => `domain ${e.path}: ${e.message}`));
  for (const [res, set] of [[0.1, tiles], [1, coarse]]) {
    for (const [id, t] of Object.entries(set)) errors.push(...validateTile(t, { manifest, res }).map((e) => `tile ${res}/${id} ${e.path}: ${e.message}`));
  }
  return errors;
};

export const write = async ({ manifest, tiles, coarse, domain, overview }, dir) => {
  await rm(dir, { recursive: true, force: true });
  for (const [res, set] of [['0.1', tiles], ['1', coarse]]) {
    await mkdir(join(dir, 'tiles', res), { recursive: true });
    for (const [id, t] of Object.entries(set)) await writeFile(join(dir, 'tiles', res, `${id}.json`), JSON.stringify(t));
  }
  await writeFile(join(dir, 'domain.json'), JSON.stringify(domain));
  await writeFile(join(dir, 'overview.json'), JSON.stringify(overview));
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL('../data', import.meta.url));
  const data = generate();
  const errors = validateAll(data);
  if (errors.length) {
    console.error(errors.slice(0, 10).join('\n'));
    process.exit(1);
  }
  await write(data, dir);
  const rows = Object.values(data.tiles).reduce((n, t) => n + t.cell.length, 0);
  console.log(`synthetic data ${data.manifest.dataVersion}: ${Object.keys(data.tiles).length} tiles, ${rows} rows, ${data.manifest.month0}..${data.manifest.last_month} -> ${dir}`);
}
