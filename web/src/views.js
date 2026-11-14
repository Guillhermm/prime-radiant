export const VIEWS = [
  { id: 'calendar', label: 'Calendar', enabled: true },
  { id: 'sensors', label: 'Sensors', enabled: true },
  { id: 'anomalies', label: 'Anomalies', enabled: false },
  { id: 'live', label: 'Live', enabled: false },
];

export const enabledViews = (views = VIEWS) => views.filter((v) => v.enabled);

export const isEnabledView = (id, views = VIEWS) => enabledViews(views).some((v) => v.id === id);

export const DEFAULT_VIEW = 'calendar';
