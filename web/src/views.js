export const VIEWS = [
  { id: 'calendar', label: 'Calendar', enabled: true },
  // Sensors plots core's R, K and harmonized series, validated at gate V1.
  { id: 'sensors', label: 'Sensors', enabled: true },
  // Off with real data until their science gates pass; main.js viewsFor turns them on for synthetic data and ?preview=1.
  { id: 'anomalies', label: 'Anomalies', enabled: false },
  { id: 'live', label: 'Live', enabled: false },
];

export const enabledViews = (views = VIEWS) => views.filter((v) => v.enabled);

export const isEnabledView = (id, views = VIEWS) => enabledViews(views).some((v) => v.id === id);

export const DEFAULT_VIEW = 'calendar';

export const PREVIEW_VIEWS = ['anomalies', 'live'];

/**
 * Anomalies and Live run on placeholder numbers (preview-stubs.js) until core delivers them
 * and their science gates pass (gate V1 covered neither). They show with synthetic data, where no
 * number is real anyway, and with ?preview=1; with real data they stay hidden.
 */
export const viewsFor = ({ synthetic, previewParam }) => {
  const preview = Boolean(synthetic || previewParam);
  return { preview, views: preview ? VIEWS.map((v) => ({ ...v, enabled: true })) : VIEWS };
};
