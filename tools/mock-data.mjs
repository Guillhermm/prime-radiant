import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateTile } from '../core/schema.js';
import { monthIndex } from '../core/months.js';

const RES = 0.1;
const TILE_DEG = 10;
const MONTH0 = '2000-11';
const COVERAGE_START = { modis: '2000-11', viirs: '2012-01' };

// Deliberately crude outlines: only enough to keep synthetic fires on land.
const SOUTH_AMERICA = [[-77.5, 8.5], [-75, 11], [-71.5, 12.3], [-68, 10.7], [-62, 10.5], [-60, 8.5], [-57, 6], [-52, 5], [-50, 1.5],
  [-48, -1], [-44, -2.5], [-39, -3.5], [-35, -5.5], [-35, -9], [-37.5, -12.5], [-39, -17], [-40, -22], [-44, -23.2], [-48, -26],
  [-48.8, -28.5], [-52, -33], [-54, -34.8], [-58, -34.5], [-57, -37.5], [-62, -39], [-65, -41], [-65, -45], [-67.5, -46.5],
  [-66, -48], [-69, -51.5], [-68.5, -54], [-72, -53], [-74, -50], [-75, -46], [-73.5, -42], [-73.5, -37], [-71.5, -30],
  [-70.3, -24], [-70.3, -18.5], [-76, -14], [-79, -8], [-81, -5], [-80, -1], [-79.5, 1.5]];
const CALIFORNIA = [[-124.4, 42], [-120, 42], [-120, 39], [-114.6, 35], [-114.7, 32.7], [-117.1, 32.5], [-118.5, 34],
  [-120.6, 34.5], [-121.9, 36.6], [-123, 38], [-124.4, 40.4]];

// [lon, lat, sigma deg, weight]: where the synthetic fire density concentrates.
const SA_HOTSPOTS = [[-55, -10, 5, 1], [-60, -12, 4, 0.8], [-48, -8, 4, 0.9], [-46, -14, 4, 0.7], [-62, -16, 3.5, 0.8],
  [-61, -23, 3.5, 0.4], [-52, -18, 4, 0.5], [-52, -5, 3, 0.6], [-68, 7, 3, 0.5], [-57, -18, 1.5, 0.9], [-57, -23, 2, 0.4],
  [-42, -10, 3, 0.3], [-72, -37, 2, 0.4]];
const CA_HOTSPOTS = [[-121, 39.5, 2.5, 0.8], [-123, 40.5, 1.5, 0.6], [-119.5, 37, 2, 0.7], [-118.2, 34.4, 1.8, 0.9], [-117, 33.2, 1.2, 0.5]];

// Years with unusually many (or few) fires, before the random year-to-year spread.
const SA_YEARS = { 2005: 1.9, 2007: 1.8, 2010: 2.2, 2019: 1.7, 2020: 1.8, 2024: 2.1, 2009: 0.6, 2012: 0.7, 2017: 0.75 };
const CA_YEARS = { 2008: 1.8, 2018: 2.6, 2020: 2.8, 2021: 2.2, 2024: 1.7, 2010: 0.5, 2019: 0.5, 2023: 0.55 };

const SA_PEAK = (lon, lat) => (lat > 2 ? 2 : lat < -30 && lon < -68 ? 2 : 9);

export const REGIONS = [
  { id: 'south-america', polygon: SOUTH_AMERICA, hotspots: SA_HOTSPOTS, years: SA_YEARS, peak: SA_PEAK, sharp: 1.6, intensity: 10 },
  { id: 'california', polygon: CALIFORNIA, hotspots: CA_HOTSPOTS, years: CA_YEARS, peak: () => 8, sharp: 1.3, intensity: 6 },
];

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

export const inPolygon = (lon, lat, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const monthString = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Latest complete month for a given date: the month before the one it is in. */
export const latestCompleteMonth = (now = new Date()) => monthString(now.getUTCFullYear() * 12 + now.getUTCMonth() - 1);

const season = (month, peak, sharp) => Math.exp(sharp * 2 * (Math.cos((2 * Math.PI * (month - peak)) / 12) - 1));

const yearFactors = (region, seed, firstYear, lastYear) => {
  const rng = mulberry32(hash(seed, region.id.length, 7));
  const out = {};
  for (let y = firstYear; y <= lastYear; y++) out[y] = (region.years[y] ?? 1) * Math.exp(0.25 * normal(rng));
  return out;
};

const cellRate = (region, lon, lat, gx, gy, seed) => {
  let w = 0;
  for (const [hx, hy, sigma, weight] of region.hotspots) {
    w += weight * Math.exp(-((lon - hx) ** 2 + (lat - hy) ** 2) / (2 * sigma * sigma));
  }
  const patch = mulberry32(hash(seed, gx, gy));
  return region.intensity * w * Math.exp(0.9 * normal(patch)) * 0.06;
};

/**
 * Builds the synthetic manifest and tiles in memory. Same seed and options give the same output.
 * @param {{seed?: number, last?: string, regions?: typeof REGIONS, now?: Date}} [opts]
 * @returns {{manifest: object, tiles: Record<string, object>}}
 */
export const generate = ({ seed = 20261114, now = new Date(), last = latestCompleteMonth(now), regions = REGIONS } = {}) => {
  const count = monthIdx(last) - monthIdx(MONTH0) + 1;
  const modisFrom = monthIndex(MONTH0, COVERAGE_START.modis);
  const viirsFrom = monthIndex(MONTH0, COVERAGE_START.viirs);
  const tiles = {};
  const tileRows = {};

  for (const region of regions) {
    const factors = yearFactors(region, seed, 2000, Number(last.slice(0, 4)));
    const seasons = Array.from({ length: 12 }, () => 0);
    const xs = region.polygon.map((p) => p[0]);
    const ys = region.polygon.map((p) => p[1]);
    const gx0 = Math.floor((Math.min(...xs) + 180) / RES);
    const gx1 = Math.floor((Math.max(...xs) + 180) / RES);
    const gy0 = Math.floor((Math.min(...ys) + 90) / RES);
    const gy1 = Math.floor((Math.max(...ys) + 90) / RES);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const lon = -180 + (gx + 0.5) * RES;
        const lat = -90 + (gy + 0.5) * RES;
        if (!inPolygon(lon, lat, region.polygon)) continue;
        const base = cellRate(region, lon, lat, gx, gy, seed);
        if (base < 1.4) continue;
        const peak = region.peak(lon, lat);
        for (let m = 1; m <= 12; m++) seasons[m - 1] = season(m, peak, region.sharp);
        const ratio = 2.4 + 1.6 * mulberry32(hash(seed, gx, gy, 3))();
        const rng = mulberry32(hash(seed, gx, gy, 11));
        const tx = Math.floor(gx / 100);
        const ty = Math.floor(gy / 100);
        const id = `${RES}/x${tx}y${ty}`;
        const rows = (tileRows[id] ??= { cell: [], month: [], modis: [], viirs: [] });
        const cell = (gy % 100) * 100 + (gx % 100);
        for (let mi = modisFrom; mi < count; mi++) {
          const abs = monthIdx(MONTH0) + mi;
          const year = Math.floor(abs / 12);
          const month = (abs % 12) + 1;
          const days = daysIn(year, month);
          const lambda = base * seasons[month - 1] * factors[year] * Math.exp(0.35 * normal(rng));
          const modis = Math.min(days, poisson(lambda, rng));
          const hasViirs = mi >= viirsFrom;
          const viirs = hasViirs ? Math.min(days, poisson(lambda * ratio, rng)) : null;
          if (modis === 0 && !viirs) continue;
          rows.cell.push(cell);
          rows.month.push(mi);
          rows.modis.push(modis);
          rows.viirs.push(viirs);
        }
      }
    }
  }

  for (const [id, rows] of Object.entries(tileRows)) if (rows.cell.length) tiles[id] = rows;
  const stamp = (now instanceof Date ? now : new Date()).toISOString();
  const manifest = {
    schema: 1,
    // Humans and the app tell synthetic data apart by the "synthetic-" dataVersion prefix.
    dataVersion: `synthetic-${stamp.slice(0, 10).replaceAll('-', '')}`,
    generated_at: stamp,
    base_url: 'data/',
    grid: { res: RES, tile_deg: TILE_DEG, coarse_res: 1 },
    month0: MONTH0,
    last_month: last,
    granularity: 'month',
    coverage: { modis: [COVERAGE_START.modis, last], viirs: [COVERAGE_START.viirs, last] },
    satellites: {
      modis: [{ name: 'Terra', from: '2000-11' }, { name: 'Aqua', from: '2002-07' }],
      viirs: [{ name: 'S-NPP', from: '2012-01' }, { name: 'NOAA-20', from: '2018-04' }],
    },
    tiles: Object.keys(tiles).sort(),
    citation: 'SYNTHETIC DEMO DATA generated by tools/mock-data.mjs. Not real detections, not NASA FIRMS.',
    caveats: [],
  };
  return { manifest, tiles };
};

/** Validates everything with core/schema.js; returns the list of error messages. */
export const validateAll = ({ manifest, tiles }) => {
  const errors = validateManifest(manifest).map((e) => `manifest ${e.path}: ${e.message}`);
  const rules = {
    monthCount: monthIdx(manifest.last_month) - monthIdx(manifest.month0) + 1,
    coverage: Object.fromEntries(['modis', 'viirs'].map((s) => [s, manifest.coverage[s].map((m) => monthIndex(manifest.month0, m))])),
  };
  for (const [id, t] of Object.entries(tiles)) errors.push(...validateTile(t, rules).map((e) => `tile ${id} ${e.path}: ${e.message}`));
  return errors;
};

export const write = async ({ manifest, tiles }, dir) => {
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'tiles', String(RES)), { recursive: true });
  for (const [id, t] of Object.entries(tiles)) await writeFile(join(dir, 'tiles', `${id}.json`), JSON.stringify(t));
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
