export const VIEWS = [
  { id: 'calendar', label: 'Calendar', enabled: true },
  // Off with real data until the science gate passes; main.js viewsFor turns them on for synthetic data and ?preview=1.
  { id: 'sensors', label: 'Sensors', enabled: false },
  { id: 'anomalies', label: 'Anomalies', enabled: false },
  { id: 'live', label: 'Live', enabled: false },
];

export const enabledViews = (views = VIEWS) => views.filter((v) => v.enabled);

export const isEnabledView = (id, views = VIEWS) => enabledViews(views).some((v) => v.id === id);

export const DEFAULT_VIEW = 'calendar';

export const PREVIEW_VIEWS = ['sensors', 'anomalies', 'live'];

/**
 * Sensors, Anomalies and Live run on placeholder numbers (preview-stubs.js, sensors-model.js)
 * until core delivers and the science gate passes. They show with synthetic data, where no
 * number is real anyway, and with ?preview=1; with real data they stay hidden.
 */
export const viewsFor = ({ synthetic, previewParam }) => {
  const preview = Boolean(synthetic || previewParam);
  return { preview, views: preview ? VIEWS.map((v) => ({ ...v, enabled: true })) : VIEWS };
};
