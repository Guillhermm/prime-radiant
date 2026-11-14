import { validateManifest, validateTile, locate } from '../../core/index.js';

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
export const dataSourceConfig = ({ fixtures = false } = {}) => ({
  manifestUrl: fixtures ? '../fixtures/manifest.json' : '../data/manifest.json',
  root: '../',
});

const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

// core has no tile lookup for a bbox, so the ids come from the grid math in core/grid.js.
// Only ids the manifest lists are returned: a tile the pipeline did not publish holds no detections.
export const tileIdsForBbox = (bbox, manifest) => {
  const [w, s, e, n] = bbox;
  if (!Array.isArray(bbox) || !bbox.every(Number.isFinite) || !(w < e) || !(s < n)) {
    throw new DataSourceError('bbox', `invalid bbox: ${bbox}`);
  }
  const { res } = manifest.grid;
  const eps = 1e-9; // the east and north edges are exclusive
  const sw = locate(w, s, res);
  const ne = locate(e - eps, n - eps, res);
  const listed = new Set(manifest.tiles);
  const ids = [];
  for (let tx = sw.tx; tx <= ne.tx; tx++) {
    for (let ty = sw.ty; ty <= ne.ty; ty++) {
      const id = `${res}/x${tx}y${ty}`;
      if (listed.has(id)) ids.push(id);
    }
  }
  return ids;
};

export const tileUrl = (manifest, id, root = '') => {
  const base = /^(https?:)?\/\//.test(manifest.base_url) || manifest.base_url.startsWith('/') ? manifest.base_url : root + manifest.base_url;
  return `${base.endsWith('/') ? base : `${base}/`}tiles/${id}.json`;
};

const tileRules = (manifest) => {
  const idx = (c) => [monthIdx(c[0]) - monthIdx(manifest.month0), monthIdx(c[1]) - monthIdx(manifest.month0)];
  return {
    monthCount: monthIdx(manifest.last_month) - monthIdx(manifest.month0) + 1,
    cellsPerSide: Math.round(manifest.grid.tile_deg / manifest.grid.res),
    coverage: { modis: idx(manifest.coverage.modis), viirs: idx(manifest.coverage.viirs) },
  };
};

/**
 * @param {{manifestUrl: string, root?: string, fetchFn?: typeof fetch, concurrency?: number}} cfg
 * `load(bbox)` aborts the previous load, fetches the needed tiles (at most `concurrency` at a
 * time), validates each with core's schema and returns `{manifest, tiles, ids}`. Validated tiles
 * are cached for the session; a failed or aborted fetch is not.
 */
export const createDataSource = ({ manifestUrl, root = '', fetchFn = (...a) => fetch(...a), concurrency = 6 }) => {
  const tileCache = new Map();
  let manifestPromise = null;
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

  const fetchTile = async (m, id, signal) => {
    if (tileCache.has(id)) return tileCache.get(id);
    const url = tileUrl(m, id, root);
    const tile = await getJson(url, signal);
    const errors = validateTile(tile, tileRules(m));
    if (errors.length) throw new DataSourceError('invalid', `tile ${id}: ${errors[0].message}`, { url, errors });
    tileCache.set(id, tile);
    return tile;
  };

  const load = async (bbox) => {
    current?.abort();
    const ctrl = new AbortController();
    current = ctrl;
    const { signal } = ctrl;
    try {
      const m = await manifest();
      if (signal.aborted) throw new DataSourceError('aborted', 'superseded by a newer query');
      const ids = tileIdsForBbox(bbox, m);
      const tiles = {};
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          tiles[id] = await fetchTile(m, id, signal);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
      return { manifest: m, tiles, ids };
    } catch (err) {
      ctrl.abort(); // stops the sibling workers
      throw err;
    }
  };

  return { manifest, load, cancel: () => current?.abort() };
};
