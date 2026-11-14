// Line icons on a 24-unit grid, built with createElementNS (no markup strings). Each entry is a
// list of [tag, attributes]; the stroke comes from currentColor.
const NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
  moon: [['path', { d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' }]],
  monitor: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['path', { d: 'M8 20h8M12 16v4' }]],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 7.5v.5' }]],
  download: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  calendar: [['rect', { x: 4, y: 5, width: 16, height: 15, rx: 2 }], ['path', { d: 'M4 10h16M9 3v4M15 3v4' }]],
  area: [['rect', { x: 4, y: 6, width: 16, height: 12, rx: 1.5, 'stroke-dasharray': '3 2' }]],
  pencil: [['path', { d: 'M14 5l5 5L9 20H4v-5z' }]],
  chevron: [['path', { d: 'M6 9l6 6 6-6' }]],
  warning: [['path', { d: 'M12 3l9.5 17h-19z' }], ['path', { d: 'M12 10v4M12 17v.5' }]],
  arrow: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  table: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['path', { d: 'M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10' }]],
  calendarView: [['rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }]],
  sensors: [['path', { d: 'M3 17l5-6 4 3 4-7 5 5' }]],
  anomalies: [['path', { d: 'M4 12h16M7 12V6M12 12V9M17 12V4M9.5 12v5M14.5 12v7' }]],
  live: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4' }]],
  install: [['rect', { x: 7, y: 3, width: 10, height: 18, rx: 2 }], ['path', { d: 'M12 7v6M9.5 10.5L12 13l2.5-2.5' }]],
};

export const ICON_NAMES = Object.keys(ICONS);

/** An aria-hidden inline SVG icon; `cls` is added to the class list. */
export const icon = (name, cls = '') => {
  const parts = ICONS[name];
  if (!parts) throw new RangeError(`icon: unknown "${name}"`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${cls}`.trim());
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  }
  return svg;
};

/** The split flame mark as an image: blue half MODIS, orange half VIIRS, yellow core harmonized. */
export const mark = (cls = 'mark') => {
  const img = document.createElement('img');
  img.src = 'icons/mark.svg';
  img.alt = '';
  img.className = cls;
  img.setAttribute('aria-hidden', 'true');
  return img;
};

export const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  return el;
};
