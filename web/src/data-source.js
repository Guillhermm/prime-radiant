import { validateManifest, validateTile, validateDomain, validateOverview, validatePlaces } from '../../core/schema.js';
import { tilesForBbox, cellCount, MAX_FINE_CELLS } from '../../core/index.js';
import { createDomain } from '../../core/domain.js';
import { parseTileId } from '../../core/grid.js';

// kind: 'network' | 'http' | 'parse' | 'invalid' | 'aborted' | 'bbox'
export class DataSourceError extends Error {
  constructor(kind, message, { cause, url, errors } = {}) {
    super(message, { cause });
    this.name = 'DataSourceError';
    this.kind = kind;
    this.url = url;
    this.errors = errors;
  }
}

// Paths are relative to the page, which sits one level under the site root in dev
// (the repo root is served, page at /web/) and at the root on Vercel, where ../ stays at the root.
// The fixtures have no overview.json or places.json, so fixture mode does not ask for them.
export const dataSourceConfig = ({ fixtures = false } = {}) => ({
  manifestUrl: fixtures ? '../fixtures/manifest.json' : '../data/manifest.json',
  root: '../',
  withOverview: !fixtures,
  withPlaces: !fixtures,
});

const baseOf = (manifest, root) => {
  const b = /^(https?:)?\/\//.test(manifest.base_url) || manifest.base_url.startsWith('/') ? manifest.base_url : root + manifest.base_url;
  return b.endsWith('/') ? b : `${b}/`;
};

/** URL of a tile at `res` (0.1 or 1) under the manifest's base_url. */
export const tileUrl = (manifest, id, res = 0.1, root = '') => `${baseOf(manifest, root)}tiles/${res}/${id}.json`;

/** URL of the manifest's domain file, next to the tiles. Null without a domain. */
export const domainUrl = (manifest, root = '') => {
  const file = manifest.domain?.file;
  if (!file) return null;
  if (!/^[\w-][\w.-]*$/.test(file)) throw new DataSourceError('invalid', `manifest: domain file "${file}" is not a plain file name`);
  return `${baseOf(manifest, root)}${file}`;
};

/** URL of overview.json, next to the tiles under the manifest's base_url. */
export const overviewUrl = (manifest, root = '') => `${baseOf(manifest, root)}overview.json`;

/** URL of places.json, the name suggestions, next to overview.json. */
export const placesUrl = (manifest, root = '') => `${baseOf(manifest, root)}places.json`;

/**
 * The tiles a query needs. harmonize falls back from the area to its 10 degree tiles, then the
 * ring around them, then everything (docs/method.md 4.3), so every query needs the whole record
 * at the coarse level; the fine level only for the area's own tiles, and not even those when
 * the area is large enough that core reads it at the coarse level. With a domain, tiles that
 * hold none of it are skipped: they have no records.
 */
export const tilesNeeded = (bbox, manifest, domain = null) => {
  let ids;
  try {
    ids = tilesForBbox(bbox, manifest);
  } catch (cause) {
    throw new DataSourceError('bbox', `invalid bbox: ${bbox}`, { cause });
  }
  const lookup = domain && createDomain(domain);
  const coarse = manifest.tiles.filter((id) => {
    if (!lookup) return true;
    const { tx, ty } = parseTileId(id);
    return lookup.count(tx * 10, tx * 10 + 9, ty * 10, ty * 10 + 9, 1) > 0;
  });
  return { fine: cellCount(bbox, 0.1) > MAX_FINE_CELLS ? [] : ids, coarse };
};

/**
 * @param {{manifestUrl: string, root?: string, fetchFn?: typeof fetch, concurrency?: number}} cfg
 * `overview()` resolves to the validated overview.json or null, never rejects; `places()` the same
 * for places.json, fetched once and cached for the session, the failure included.
 * `load(bbox)` aborts the previous load, fetches the needed tiles (at most `concurrency` at a
 * time), validates each with core's schema and returns `{manifest, domain, tiles: {fine, coarse}, ids}`.
 * The manifest, the domain and validated tiles are cached for the session; a failed or aborted
 * fetch is not.
 */
export const createDataSource = ({ manifestUrl, root = '', withOverview = true, withPlaces = true, fetchFn = (...a) => fetch(...a), concurrency = 6 }) => {
  const tileCache = new Map();
  let manifestPromise = null;
  let domainPromise = null;
  let current = null;

  const getJson = async (url, signal) => {
    let res;
    try {
      res = await fetchFn(url, { signal });
    } catch (cause) {
      if (signal?.aborted || cause?.name === 'AbortError') throw new DataSourceError('aborted', 'request aborted', { cause, url });
      throw new DataSourceError('network', `could not reach ${url}`, { cause, url });
    }
    if (!res.ok) throw new DataSourceError('http', `${url} answered ${res.status}`, { url });
    try {
      return await res.json();
    } catch (cause) {
      if (signal?.aborted) throw new DataSourceError('aborted', 'request aborted', { cause, url });
      throw new DataSourceError('parse', `${url} is not valid JSON`, { cause, url });
    }
  };

  const manifest = () => {
    manifestPromise ??= getJson(manifestUrl).then((m) => {
      const errors = validateManifest(m);
      if (errors.length) throw new DataSourceError('invalid', `manifest: ${errors[0].message}`, { url: manifestUrl, errors });
      return m;
    }).catch((err) => { manifestPromise = null; throw err; });
    return manifestPromise;
  };

  // No domain in the manifest means no clipping (roadmap section 2): null, not an empty domain.
  const domain = (m) => {
    domainPromise ??= (async () => {
      const url = domainUrl(m, root);
      if (!url) return null;
      const d = await getJson(url);
      const errors = validateDomain(d);
      if (errors.length) throw new DataSourceError('invalid', `domain: ${errors[0].message}`, { url, errors });
      return d;
    })().catch((err) => { domainPromise = null; throw err; });
    return domainPromise;
  };

  // The place picker's map is optional: anything wrong with it (missing, invalid, offline) is null,
  // and the app falls back to drawing or typing an area.
  const overview = async () => {
    if (!withOverview) return null;
    try {
      const m = await manifest();
      const o = await getJson(overviewUrl(m, root));
      return validateOverview(o).length ? null : o;
    } catch {
      return null;
    }
  };

  // Name suggestions are a convenience: anything wrong with the file means no suggestions.
  let placesPromise = null;
  const places = () => {
    placesPromise ??= (async () => {
      if (!withPlaces) return null;
      try {
        const p = await getJson(placesUrl(await manifest(), root));
        return validatePlaces(p).length ? null : p;
      } catch {
        return null;
      }
    })();
    return placesPromise;
  };

  const fetchTile = async (m, res, id, signal) => {
    const key = `${res}/${id}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const url = tileUrl(m, id, res, root);
    const tile = await getJson(url, signal);
    const errors = validateTile(tile, { manifest: m, res });
    if (errors.length) throw new DataSourceError('invalid', `tile ${key}: ${errors[0].message}`, { url, errors });
    tileCache.set(key, tile);
    return tile;
  };

  const load = async (bbox) => {
    current?.abort();
    const ctrl = new AbortController();
    current = ctrl;
    const { signal } = ctrl;
    try {
      const m = await manifest();
      const d = await domain(m);
      if (signal.aborted) throw new DataSourceError('aborted', 'superseded by a newer query');
      const need = tilesNeeded(bbox, m, d);
      const jobs = [...need.fine.map((id) => ['fine', 0.1, id]), ...need.coarse.map((id) => ['coarse', 1, id])];
      const tiles = { fine: {}, coarse: {} };
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const [level, res, id] = jobs[next++];
          tiles[level][id] = await fetchTile(m, res, id, signal);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
      return { manifest: m, domain: d, tiles, ids: need };
    } catch (err) {
      ctrl.abort(); // stops the sibling workers
      throw err;
    }
  };

  return { manifest, overview, places, load, cancel: () => current?.abort() };
};
