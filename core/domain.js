/**
 * Spatial domain (docs/roadmap.md section 2): the 0.1 deg cells that intersect a polygon,
 * stored as row-wise runs `{rows: {latIdx: [[c0, c1], ...]}}` (latIdx 0 = lat -90, lonIdx 0 =
 * lon -180, both inclusive). A 1 deg cell is in the domain when any of its fine cells is.
 * Polygons are GeoJSON-style: a polygon is [outerRing, ...holeRings], a ring is [[lon, lat], ...].
 */
import { locate } from './grid.js';

const NCOL = 3600;
const NROW = 1800;

/** Polygons of a GeoJSON Polygon, MultiPolygon, Feature or FeatureCollection. */
export function polygonsOf(g) {
  if (g.type === 'FeatureCollection') return g.features.flatMap(polygonsOf);
  if (g.type === 'Feature') return polygonsOf(g.geometry);
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  throw new TypeError(`unsupported geometry: ${g.type}`);
}

/** [west, south, east, north] of the polygons (no antimeridian handling). */
export function bboxOfPolygons(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of polys.flatMap((p) => p[0])) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point is inside an outer ring and in none of its holes. Boundary points: unspecified. */
export function pointInPolygons(polys, lon, lat) {
  return polys.some(([outer, ...holes]) => inRing(outer, lon, lat) && !holes.some((h) => inRing(h, lon, lat)));
}

const clamp = (v, hi) => Math.min(hi, Math.max(0, v));

/**
 * Encode the cells that intersect the polygons. A cell is in when a ring edge crosses it, or
 * when its center is inside (even-odd, so holes work); nothing else can intersect.
 * @returns {{rows: Object<string, [number, number][]>}}
 */
export const rasterize = (polys) => ({ rows: scan(polys).rows });

/** rasterize plus, per row, the cell masks `full` (in domain) and `edge` (touched by a ring edge). */
function scan(polys) {
  const edge = new Map(); // row -> Uint8Array of columns touched by an edge
  const cross = new Map(); // row -> x of ring crossings at the row's center latitude
  const at = (m, j, make) => m.get(j) ?? m.set(j, make()).get(j);
  for (const ring of polys.flat()) {
    const [f, l] = [ring[0], ring.at(-1)];
    const closed = f[0] === l[0] && f[1] === l[1];
    for (let k = 1; k < ring.length + (closed ? 0 : 1); k++) { // an unclosed ring still gets its last edge
      const [xa, ya] = ring[k - 1];
      const [xb, yb] = ring[k % ring.length];
      const xAt = (y) => (yb === ya ? xa : xa + ((y - ya) * (xb - xa)) / (yb - ya));
      const [lo, hi] = [Math.min(ya, yb), Math.max(ya, yb)];
      for (let j = clamp(Math.floor((lo + 90) * 10), NROW - 1); j <= clamp(Math.floor((hi + 90) * 10), NROW - 1); j++) {
        const [y0, y1] = [Math.max(lo, j / 10 - 90), Math.min(hi, (j + 1) / 10 - 90)];
        const xs = yb === ya ? [xa, xb] : [xAt(y0), xAt(y1)];
        const row = at(edge, j, () => new Uint8Array(NCOL));
        row.fill(1, clamp(Math.floor((Math.min(...xs) + 180) * 10), NCOL - 1), clamp(Math.floor((Math.max(...xs) + 180) * 10), NCOL - 1) + 1);
        const yc = (j + 0.5) / 10 - 90;
        if ((ya <= yc) !== (yb <= yc)) at(cross, j, () => []).push(xAt(yc));
      }
    }
  }
  const rows = {};
  const masks = new Map();
  for (const [j, edgeMask] of edge) {
    const mask = edgeMask.slice();
    const xs = (cross.get(j) ?? []).sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      mask.fill(1, clamp(Math.ceil((xs[i] + 180) * 10 - 0.5), NCOL), clamp(Math.floor((xs[i + 1] + 180) * 10 - 0.5) + 1, NCOL));
    }
    const runs = [];
    for (let c = 0; c < NCOL; c++) {
      if (!mask[c]) continue;
      const c0 = c;
      while (c + 1 < NCOL && mask[c + 1]) c++;
      runs.push([c0, c]);
    }
    if (runs.length) { rows[j] = runs; masks.set(j, { full: mask, edge: edgeMask }); }
  }
  return { rows, masks };
}

/**
 * Fast exact membership for the build: a point is in when its 0.1 deg cell is wholly inside
 * the polygon, or the cell crosses the boundary and the point-in-polygon test says so.
 * @returns {{domain: {rows: object}, contains: (lon: number, lat: number) => boolean}}
 */
export function createClipper(polys) {
  const { rows, masks } = scan(polys);
  const boxed = polys.map((p) => ({ p, b: bboxOfPolygons([p]) }));
  const contains = (lon, lat) => {
    const gx = Math.min(NCOL - 1, Math.floor((Math.round(lon * 1e6) + 180e6) / 1e5));
    const gy = Math.min(NROW - 1, Math.floor((Math.round(lat * 1e6) + 90e6) / 1e5));
    const m = masks.get(gy);
    if (!m || !m.full[gx]) return false;
    if (!m.edge[gx]) return true;
    return pointInPolygons(boxed.filter(({ b }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]).map(({ p }) => p), lon, lat);
  };
  return { domain: { rows }, contains };
}

/**
 * Lookup over a decoded domain.json.
 * @returns {{has: (lon: number, lat: number, res?: number) => boolean,
 *   count: (x0: number, x1: number, y0: number, y1: number, res?: number) => number}}
 *   `count` is the number of in-domain cells with column in [x0, x1] and row in [y0, y1] at `res`.
 */
export function createDomain(domain) {
  const fine = new Map(Object.entries(domain.rows).map(([j, r]) => [Number(j), r]));
  let coarse;
  const runsAt = (res) => {
    if (res === 0.1) return fine;
    if (!coarse) {
      coarse = new Map();
      for (const [j, r] of fine) {
        const cj = Math.floor(j / 10);
        const all = [...(coarse.get(cj) ?? []), ...r.map(([a, b]) => [Math.floor(a / 10), Math.floor(b / 10)])].sort((p, q) => p[0] - q[0]);
        const merged = [];
        for (const run of all) {
          const last = merged.at(-1);
          if (last && run[0] <= last[1] + 1) last[1] = Math.max(last[1], run[1]);
          else merged.push([...run]);
        }
        coarse.set(cj, merged);
      }
    }
    return coarse;
  };
  const count = (x0, x1, y0, y1, res = 0.1) => {
    const m = runsAt(res);
    let n = 0;
    for (let j = y0; j <= y1; j++) {
      for (const [a, b] of m.get(j) ?? []) n += Math.max(0, Math.min(b, x1) - Math.max(a, x0) + 1);
    }
    return n;
  };
  const has = (lon, lat, res = 0.1) => {
    const p = locate(lon, lat, res);
    const per = res === 0.1 ? 100 : 10;
    const [x, y] = [p.tx * per + p.col, p.ty * per + p.row];
    return count(x, x, y, y, res) === 1;
  };
  return { has, count };
}
