// Derives pipeline/domain/ne-gazetteer.json (names, bounding boxes and label points of countries,
// states or provinces and geographic regions) from three Natural Earth 10m files. Provenance and
// checksums: pipeline/domain/README.md.
//   node tools/derive-gazetteer.mjs <admin0.geojson> <admin1.geojson> <regions.geojson> [out]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pointInPolygons, polygonsOf } from '../core/domain.js';

const round = (v, f) => Math.round(f(v * 100)) / 100;

/** [w, s, e, n] rounded outward to 0.01 deg; w > e when the shape is narrower across the antimeridian. */
export const bboxOf = (polys) => {
  const pts = polys.flatMap((p) => p[0]);
  const lats = pts.map(([, y]) => y);
  const span = (xs) => [Math.min(...xs), Math.max(...xs)];
  const [w0, e0] = span(pts.map(([x]) => x));
  const [w1, e1] = span(pts.map(([x]) => (x < 0 ? x + 360 : x)));
  const [w, e] = e1 - w1 < e0 - w0 ? [w1 > 180 ? w1 - 360 : w1, e1 > 180 ? e1 - 360 : e1] : [w0, e0];
  return [round(w, Math.floor), round(Math.min(...lats), Math.floor), round(e, Math.ceil), round(Math.max(...lats), Math.ceil)];
};

/** A point inside the shape near the middle of its inside: the inside grid point closest to their mean. */
export const labelPoint = (polys, [w, s, e, n]) => {
  const width = w <= e ? e - w : e + 360 - w;
  const inside = [];
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 24; j++) {
      let x = w + ((i + 0.5) * width) / 24;
      if (x > 180) x -= 360;
      const y = s + ((j + 0.5) * (n - s)) / 24;
      if (pointInPolygons(polys, x, y)) inside.push([x, y]);
    }
  }
  if (!inside.length) {
    const [x, y] = polys[0][0][0];
    return [round(x, Math.round), round(y, Math.round)];
  }
  const mx = inside.reduce((a, p) => a + p[0], 0) / inside.length;
  const my = inside.reduce((a, p) => a + p[1], 0) / inside.length;
  const [x, y] = inside.reduce((b, p) => (Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(b[0] - mx, b[1] - my) ? p : b));
  return [round(x, Math.round), round(y, Math.round)];
};

const alts = (name, ...xs) => {
  const seen = new Set([name.toLowerCase()]);
  return xs.flatMap((x) => String(x ?? '').split('|')).map((x) => x.trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

/** One entry per feature: {name, alt, kind, country, bbox, label}. */
export const entriesOf = ({ admin0, admin1, regions }) => {
  const out = [];
  const add = (f, name, alt, kind, country, label) => {
    const polys = polygonsOf(f);
    const bbox = bboxOf(polys);
    out.push({ name, alt, kind, country, bbox, label: label ?? labelPoint(polys, bbox) });
  };
  for (const f of admin0.features) {
    const p = f.properties;
    add(f, p.NAME, alts(p.NAME, p.NAME_LONG, p.NAME_EN, p.NAME_PT), 'country', null, [round(p.LABEL_X, Math.round), round(p.LABEL_Y, Math.round)]);
  }
  for (const f of admin1.features) {
    const p = f.properties;
    if (!p.name) continue;
    add(f, p.name, alts(p.name, p.name_alt, p.name_en, p.name_pt), 'state', p.admin, [round(p.longitude, Math.round), round(p.latitude, Math.round)]);
  }
  for (const f of regions.features) {
    const p = f.properties;
    const name = p.NAME_EN || p.NAME;
    add(f, name, alts(name, p.NAME, p.NAMEALT, p.NAME_PT), 'region', null);
  }
  // Natural Earth splits some regions into several features under one name: keep the largest.
  const area = ([w, s, e, n]) => (w <= e ? e - w : e + 360 - w) * (n - s);
  const best = new Map();
  for (const e of out) {
    const key = `${e.kind}:${e.country}:${e.name}`;
    if (!best.has(key) || area(e.bbox) > area(best.get(key).bbox)) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.kind.localeCompare(b.kind));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a0, a1, r, out = 'pipeline/domain/ne-gazetteer.json'] = process.argv.slice(2);
  if (!r) {
    console.error('usage: node tools/derive-gazetteer.mjs <admin0.geojson> <admin1.geojson> <regions.geojson> [out]');
    process.exit(2);
  }
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const entries = entriesOf({ admin0: read(a0), admin1: read(a1), regions: read(r) });
  writeFileSync(out, `${JSON.stringify({ source: { id: 'ne10m', version: '5.1.2' }, entries })}\n`);
  console.log(`gazetteer: ${entries.length} entries -> ${out}`);
}
