/**
 * places.json: the place names the area field suggests (countries, states or provinces, geographic
 * regions), from pipeline/domain/ne-gazetteer.json, kept when the place's label point lies in the
 * data domain, so a suggestion never opens an area the data does not cover.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validatePlaces } from '../core/schema.js';

export const GAZETTEER = new URL('./domain/ne-gazetteer.json', import.meta.url);

/** True when (lon, lat) falls in an in-domain 0.1 deg cell of a domain mask {rows: {latIdx: [[c0, c1]]}}. */
export const inDomain = (domain, [lon, lat]) => {
  const runs = domain.rows[String(Math.min(1799, Math.floor((lat + 90) * 10)))];
  const c = Math.min(3599, Math.floor((lon + 180) * 10));
  return Boolean(runs?.some(([c0, c1]) => c >= c0 && c <= c1));
};

/** The places.json document: every gazetteer entry without a domain, else the ones whose label point is in it. */
export const buildPlaces = (gazetteer, domain = null) => ({
  schema: 1,
  source: gazetteer.source,
  entries: gazetteer.entries.filter((e) => !domain || inDomain(domain, e.label)).map(({ label, ...e }) => e),
});

/** Writes places.json into a build directory; returns the document. */
export const writePlaces = (dir, domain = null, gazetteer = JSON.parse(fs.readFileSync(GAZETTEER, 'utf8'))) => {
  const places = buildPlaces(gazetteer, domain);
  const errors = validatePlaces(places);
  if (errors.length) throw new Error(`places: ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`);
  fs.writeFileSync(path.join(dir, 'places.json'), `${JSON.stringify(places)}\n`);
  return places;
};
