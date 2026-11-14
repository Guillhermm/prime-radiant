const STUB = { id: 'stub', version: '0' };

/**
 * STUB. Not science: takes MODIS where it has data and VIIRS elsewhere, with no scaling.
 * The real method (ratio R, fallback, confidence interval) lands in M1.
 * @param {{modis: object, viirs: object}} sensors Series from `seriesForAoi`
 * @returns {object} Series with id "harmonized", `comparable: false`
 */
export const harmonize = ({ modis, viirs }) => ({
  id: 'harmonized',
  unit: 'fire-cell-days',
  start: modis.start,
  values: modis.values.map((v, i) => v ?? viirs.values[i] ?? null),
  method: STUB,
  comparable: false,
});
