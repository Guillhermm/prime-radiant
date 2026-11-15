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
  return (west, south) => {
    const votes = new Map();
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const lon = west + 0.05 + i / 10;
        const lat = south + 0.05 + j / 10;
        const hit = states.find((s) => lon >= s.box[0] && lon <= s.box[2] && lat >= s.box[1] && lat <= s.box[3] && pointInPolygons(s.polys, lon, lat));
        if (hit) votes.set(hit, (votes.get(hit) ?? 0) + 1);
      }
    }
    let best = null;
    for (const [s, n] of votes) if (!best || n > best.n || (n === best.n && s.name < best.s.name)) best = { s, n };
    return best ? { country: best.s.country, state: best.s.name } : null;
  };
};
