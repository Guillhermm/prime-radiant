export const VIEWS = [
  { id: 'calendar', label: 'Calendar', enabled: true },
  // Sensors plots core's R, K and harmonized series, validated at gate V1.
  { id: 'sensors', label: 'Sensors', enabled: true },
  // Anomalies shows core's ranks and flags, validated at gate V2.
  { id: 'anomalies', label: 'Anomalies', enabled: true },
  // Live compares NOAA-20 x K over Brazil with the archive band, validated at gate V3 (re-check 2026-11-15).
  { id: 'live', label: 'Live', enabled: true },
];

export const enabledViews = (views = VIEWS) => views.filter((v) => v.enabled);

export const isEnabledView = (id, views = VIEWS) => enabledViews(views).some((v) => v.id === id);

export const DEFAULT_VIEW = 'calendar';

export const PREVIEW_VIEWS = ['live'];

/**
 * Every view is on. `preview` (synthetic data or ?preview=1) still matters to Live: on synthetic
 * data it draws placeholder numbers (preview-stubs.js), tagged Preview, since there is no live
 * record to compare with.
 */
export const viewsFor = ({ synthetic, previewParam }) => {
  const preview = Boolean(synthetic || previewParam);
  return { preview, views: preview ? VIEWS.map((v) => ({ ...v, enabled: true })) : VIEWS };
};
