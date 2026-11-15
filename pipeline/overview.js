/**
 * overview.json: where it burned, for the place picker. One number per 1 deg cell (fire-cell-days
 * of one VIIRS sensor over the newest full calendar year) and a ranked list of hotspots kept apart.
 * One sensor, observed counts only, so no harmonization factor enters the map.
 *   node pipeline/overview.js --in <build dir> [--domain file.geojson] [--admin1 file.geojson]
 * With an admin-1 file, each hotspot carries `place: {country, state}` (pipeline/places.js), and
 * `countries` ranks the countries by the same numbers (countriesOf).
 * Reads manifest.json and tiles/1/*.json from the build and writes overview.json next to them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { cellCenter } from '../core/grid.js';
import { monthIndex } from '../core/months.js';
import { validateOverview } from '../core/schema.js';
import { createPlaces } from './places.js';

export const HOTSPOTS = 10;
export const COUNTRY_HOTSPOTS = 3;
export const MIN_APART_DEG = 3;
// S-NPP first: on a tie it is the sensor R and the calendar are built on.
const SENSORS = ['viirs', 'noaa20'];

/** Newest year whose 12 months the sensor covers within the manifest span, or null. */
export const fullYear = (manifest, sensor) => {
  const cov = manifest.coverage?.[sensor];
  if (!cov) return null;
  const last = monthIndex(cov[1]) < monthIndex(manifest.last_month) ? cov[1] : manifest.last_month;
  const y = Number(last.slice(0, 4)) - (last.endsWith('-12') ? 0 : 1);
  return monthIndex(`${y}-01`) >= monthIndex(cov[0]) ? y : null;
};

/** The sensor and year the overview uses: the newest full year, S-NPP on a tie. */
export const pickSource = (manifest) => {
  let best = null;
  for (const sensor of SENSORS) {
    const year = fullYear(manifest, sensor);
    if (year !== null && (best === null || year > best.year)) best = { sensor, year };
  }
  return best;
};

/** Greedy: highest value first, skipping any cell closer than `apart` degrees on both axes to one already taken. */
export const pickHotspots = (cells, { n = HOTSPOTS, apart = MIN_APART_DEG } = {}) => {
  const ranked = cells.filter((c) => c[2] > 0).sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
  const taken = [];
  for (const c of ranked) {
    if (taken.length >= n) break;
    if (taken.every((t) => Math.abs(t[0] - c[0]) >= apart || Math.abs(t[1] - c[1]) >= apart)) taken.push(c);
  }
  return taken.map(([w, s, value]) => ({ bbox: [w, s, w + 1, s + 1], value }));
};

/**
 * @param {object} manifest validated build manifest
 * @param {Object<string, {cell: number[], month: number[], viirs: (number|null)[], noaa20: (number|null)[]}>} coarse tile id -> 1 deg tile
 * @param {{id: string, name: string}|null} [region] the domain's label, from the domain file
 * @param {((west: number, south: number) => {country: string, state: string}|null)|null} [places] names a 1 deg square
 * @returns {object|null} the overview, or null when no VIIRS sensor covers a full year
 */
export const buildOverview = (manifest, coarse, region = null, places = null) => {
  const source = pickSource(manifest);
  if (!source) return null;
  const { sensor, year } = source;
  const m0 = monthIndex(manifest.month0);
  const from = monthIndex(`${year}-01`) - m0;
  const to = from + 11;
  const sums = new Map();
  for (const [id, t] of Object.entries(coarse)) {
    t.cell.forEach((cell, i) => {
      if (t.month[i] < from || t.month[i] > to || t[sensor][i] === null) return;
      const key = `${id}:${cell}`;
      sums.set(key, (sums.get(key) ?? 0) + t[sensor][i]);
    });
  }
  const cells = [...sums].map(([key, value]) => {
    const [id, cell] = key.split(':');
    const { lon, lat } = cellCenter(id, Number(cell), 1);
    return [Math.round(lon - 0.5), Math.round(lat - 0.5), value];
  }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const partial = (manifest.partial_months?.[sensor] ?? []).filter((m) => m.startsWith(`${year}-`));
  const named = (h) => {
    const place = places?.(h.bbox[0], h.bbox[1]);
    return place ? { ...h, place } : h;
  };
  return {
    schema: 1, dataVersion: manifest.dataVersion, region, sensor, year, res: 1, unit: 'fire-cell-days',
    partial_months: partial, cells,
    hotspots: pickHotspots(cells).map(named),
    ...(places ? { countries: countriesOf(cells, places) } : {}),
  };
};

/**
 * Countries ranked by the overview's fire-cell-days. A square belongs to the country of the state
 * holding most of its fine-cell centers (pipeline/places.js), so border squares count once, whole.
 * Each country: {country, value, bbox (its squares), top: its COUNTRY_HOTSPOTS hottest squares}.
 */
export const countriesOf = (cells, places) => {
  const by = new Map();
  for (const c of cells) {
    const p = places(c[0], c[1]);
    if (!p) continue;
    const e = by.get(p.country) ?? by.set(p.country, { country: p.country, value: 0, cells: [], names: new Map() }).get(p.country);
    e.value += c[2];
    e.cells.push(c);
    e.names.set(`${c[0]},${c[1]}`, p);
  }
  return [...by.values()].filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || (a.country < b.country ? -1 : 1))
    .map((e) => ({
      country: e.country,
      value: e.value,
      bbox: [Math.min(...e.cells.map((c) => c[0])), Math.min(...e.cells.map((c) => c[1])), Math.max(...e.cells.map((c) => c[0])) + 1, Math.max(...e.cells.map((c) => c[1])) + 1],
      top: pickHotspots(e.cells, { n: COUNTRY_HOTSPOTS }).map((h) => ({ ...h, place: e.names.get(`${h.bbox[0]},${h.bbox[1]}`) })),
    }));
};

/** The region label a domain file declares (`domain: {id, name}`), or null when it names none. */
export const regionOf = (geojson) => (geojson?.domain?.name ? { id: String(geojson.domain.id), name: String(geojson.domain.name) } : null);

/** Reads a build directory, writes overview.json into it; returns the overview or null when there is none to write. */
export const writeOverview = (dir, region = null, places = null) => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const manifest = read('manifest.json');
  const coarse = Object.fromEntries(manifest.tiles.map((id) => [id, read(`tiles/1/${id}.json`)]));
  const overview = buildOverview(manifest, coarse, region, places);
  if (!overview) return null;
  const errors = validateOverview(overview);
  if (errors.length) throw new Error(`overview: ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
  fs.writeFileSync(path.join(dir, 'overview.json'), `${JSON.stringify(overview)}\n`);
  return overview;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { in: { type: 'string' }, domain: { type: 'string' }, admin1: { type: 'string' } } });
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!values.in) {
    console.error('usage: node pipeline/overview.js --in <build dir>');
    process.exit(2);
  }
  const o = writeOverview(values.in, values.domain ? regionOf(readJson(values.domain)) : null, values.admin1 ? createPlaces(readJson(values.admin1)) : null);
  console.log(o ? `overview: ${o.sensor} ${o.year}, ${o.cells.length} cells, ${o.hotspots.length} hotspots` : 'overview: no VIIRS sensor covers a full year; nothing written');
}
