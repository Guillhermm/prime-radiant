/**
 * Place names for 1 deg squares, from an admin-1 GeoJSON (states and provinces, one feature each,
 * properties {name, country}, or Natural Earth's own {name, admin} as in the global file). A square
 * takes the state that holds most of its 100 fine-cell centers; centers in no state (sea, a country
 * the file does not cover) do not vote. Features without a name are left out.
 */
import { bboxOfPolygons, pointInPolygons, polygonsOf } from '../core/domain.js';

/** @returns {(west: number, south: number) => {country: string, state: string}|null} */
export const createPlaces = (geojson) => {
  const states = (geojson?.features ?? []).filter((f) => f.properties?.name && (f.properties.country ?? f.properties.admin)).map((f) => {
    const polys = polygonsOf(f);
    return { name: String(f.properties.name), country: String(f.properties.country ?? f.properties.admin), polys, box: bboxOfPolygons(polys) };
  });
  // States whose box touches each 1 deg square: naming every square of a global overview stays fast.
  const index = new Map();
  for (const s of states) {
    for (let w = Math.floor(s.box[0]); w <= Math.min(179, Math.floor(s.box[2])); w++) {
      for (let so = Math.floor(s.box[1]); so <= Math.min(89, Math.floor(s.box[3])); so++) {
        const k = `${w},${so}`;
        (index.get(k) ?? index.set(k, []).get(k)).push(s);
      }
    }
  }
  return (west, south) => {
    const votes = new Map();
    const near = index.get(`${west},${south}`) ?? [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const lon = west + 0.05 + i / 10;
        const lat = south + 0.05 + j / 10;
        const hit = near.find((s) => lon >= s.box[0] && lon <= s.box[2] && lat >= s.box[1] && lat <= s.box[3] && pointInPolygons(s.polys, lon, lat));
        if (hit) votes.set(hit, (votes.get(hit) ?? 0) + 1);
      }
    }
    let best = null;
    for (const [s, n] of votes) if (!best || n > best.n || (n === best.n && s.name < best.s.name)) best = { s, n };
    return best ? { country: best.s.country, state: best.s.name } : null;
  };
};
