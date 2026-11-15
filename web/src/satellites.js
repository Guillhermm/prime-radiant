const FAMILIES = ['modis', 'viirs', 'noaa20'];
// manifest.satellites gives names per family; only Aqua starts after its family's coverage does.
const ERA_FROM = { Aqua: 'modis_aqua_from' };
export const INSTRUMENT = { modis: 'MODIS', viirs: 'VIIRS', noaa20: 'VIIRS' };

/**
 * One span per satellite, oldest family first: {family, name, from, to} as "YYYY-MM", read from
 * manifest.coverage, manifest.satellites and its eras (an era never starts before its coverage). A family with null coverage has none.
 */
export const satelliteSpans = (manifest) => FAMILIES.flatMap((family) => {
  const cov = manifest?.coverage?.[family];
  const names = manifest?.satellites?.[family];
  if (!Array.isArray(cov) || !Array.isArray(names)) return [];
  return names.map((name) => {
    const era = manifest.satellites.eras?.[ERA_FROM[name]]?.slice?.(0, 7);
    return { family, name, from: era > cov[0] ? era : cov[0], to: cov[1] };
  });
});
