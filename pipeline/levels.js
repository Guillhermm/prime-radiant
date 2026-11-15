/**
 * global.json: the whole-world fallback level (docs/method.md 4.3) computed once by the build with
 * the same core function the app uses, from the 1 deg tiles, so the app no longer downloads every
 * coarse tile for each query. Reads manifest.json, domain.json and tiles/1/*.json from the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { seriesForAoi, WORLD } from '../core/aggregate.js';
import { validateGlobalLevel } from '../core/schema.js';

/** @returns {{schema: 1, dataVersion: string, modis: object, viirs: object, noaa20: object}} */
export const buildGlobalLevel = (manifest, coarse, domain = null) => {
  const { modis, viirs, noaa20 } = seriesForAoi(WORLD, { coarse }, manifest, { res: 1, ...(domain ? { domain } : {}) });
  return { schema: 1, dataVersion: manifest.dataVersion, modis, viirs, noaa20 };
};

export const writeGlobalLevel = (dir) => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const manifest = read('manifest.json');
  const coarse = Object.fromEntries(manifest.tiles.map((id) => [id, read(`tiles/1/${id}.json`)]));
  const g = buildGlobalLevel(manifest, coarse, manifest.domain ? read(manifest.domain.file) : null);
  const errors = validateGlobalLevel(g, { manifest });
  if (errors.length) throw new Error(`global level: ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
  fs.writeFileSync(path.join(dir, 'global.json'), `${JSON.stringify(g)}\n`);
  return g;
};
