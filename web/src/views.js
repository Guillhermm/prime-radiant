export const VIEWS = [
  { id: 'calendar', label: 'Calendar', enabled: true },
  // Sensors plots core's R, K and harmonized series, validated at gate V1.
  { id: 'sensors', label: 'Sensors', enabled: true },
  // Anomalies shows core's ranks and flags, validated at gate V2.
  { id: 'anomalies', label: 'Anomalies', enabled: true },
  // Off with real data until gate V3 passes; viewsFor turns it on for synthetic data and ?preview=1.
  { id: 'live', label: 'Live', enabled: false },
];

export const enabledViews = (views = VIEWS) => views.filter((v) => v.enabled);

export const isEnabledView = (id, views = VIEWS) => enabledViews(views).some((v) => v.id === id);

export const DEFAULT_VIEW = 'calendar';

export const PREVIEW_VIEWS = ['live'];

/**
 * Live runs on placeholder numbers (preview-stubs.js) until its science gate (V3) passes. It shows
 * with synthetic data, where no number is real anyway, and with ?preview=1; with real data it
 * stays hidden.
 */
export const viewsFor = ({ synthetic, previewParam }) => {
  const preview = Boolean(synthetic || previewParam);
  return { preview, views: preview ? VIEWS.map((v) => ({ ...v, enabled: true })) : VIEWS };
};
