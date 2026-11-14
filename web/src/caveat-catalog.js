// TEMPORARY. core/caveats.js (owner: Kaue) will replace this file; until then the texts are
// copied from docs/method.md section 7 and docs/ux.md. Swap the import in the caveat strip,
// the cell detail and the method drawer, then delete this module.
export const PRELIMINARY = true;

export const CAVEATS = [
  { id: 'C1', text: 'Counts are days with fire in a 0.1 deg cell, not fires, not burned area.', status: 'assumption' },
  { id: 'C2', text: 'Before 2012-02 and after 2026-11-02 the harmonized line is MODIS scaled by R, marked estimated.', status: 'assumption' },
  { id: 'C3', text: 'R assumes the MODIS to VIIRS relationship did not change over time.', status: 'assumption' },
  { id: 'C4', text: 'MODIS Terra orbit drift and end of mission may change MODIS counts after 2020.', status: 'unverified' },
  { id: 'C5', text: 'Totals from AOIs at different latitudes are not comparable per unit area.', status: 'supported' },
  { id: 'C6', text: 'Sparse areas: few fire-cell-days make R and anomaly flags unstable; R from a parent region is marked low confidence.', status: 'assumption' },
  { id: 'C7', text: 'Near-real-time data has no type field and is not harmonized.', status: 'supported' },
  { id: 'C8', text: 'No confidence filter is applied.', status: 'assumption' },
];

export const STRIP_TEXT = 'Hotspot counts, not burned area. MODIS to VIIRS values are estimated.';

export const caveatById = (id) => CAVEATS.find((c) => c.id === id) ?? null;

/** Caveats that bear on one calendar cell. No thresholds: only facts the cell itself carries. */
export const caveatsForCell = (cell) => {
  const ids = ['C1'];
  if (cell.estimated) ids.push('C2', 'C3');
  if (cell.year >= 2020) ids.push('C4');
  ids.push('C8');
  return ids.map(caveatById);
};
