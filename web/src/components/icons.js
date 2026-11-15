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
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  calendar: [['rect', { x: 4, y: 5, width: 16, height: 15, rx: 2 }], ['path', { d: 'M4 10h16M9 3v4M15 3v4' }]],
  // A drawn polygon with its vertices: reads as "select an area" even at 1rem, where a dashed box looked like a broken image.
  crosshair: [['circle', { cx: 12, cy: 12, r: 6.5 }], ['circle', { cx: 12, cy: 12, r: 1.25, fill: 'currentColor', stroke: 'none' }], ['path', { d: 'M12 2v4M12 18v4M2 12h4M18 12h4' }]],
  pencil: [['path', { d: 'M14 5l5 5L9 20H4v-5z' }]],
  // A selected area: dashed rectangle. Round caps add a unit to each dash, so 2 on 4 reads as 4 on 2.
  areaDashed: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2, 'stroke-dasharray': '2 4' }]],
  // Rounded rectangle open at the lower right, where a pencil crosses the corner.
  drawArea: [['path', { d: 'M10 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3' }], ['path', { d: 'M20.4 10.9l2.2 2.2-7 7-3.6 1.4 1.4-3.6z' }], ['path', { d: 'M13.4 17.9l2.2 2.2' }]],
  chevron: [['path', { d: 'M6 9l6 6 6-6' }]],
  image: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['circle', { cx: 9, cy: 10, r: 1.5 }], ['path', { d: 'M4 17l5-4.5 3.5 3 3-2.5 4.5 4' }]],
  warning: [['path', { d: 'M12 3l9.5 17h-19z' }], ['path', { d: 'M12 10v4M12 17v.5' }]],
  arrow: [['path', { d: 'M5 12h14M13 6l6 6-6 6' }]],
  cloudOff: [['path', { d: 'M8 19h9a4 4 0 0 0 1.6-7.7M15.9 7.6A6 6 0 0 0 6.1 10 4.5 4.5 0 0 0 6 19' }], ['path', { d: 'M3 3l18 18' }]],
  share: [['path', { d: 'M12 3v12M8 7l4-4 4 4M8 11H6v9h12v-9h-2' }]],
  link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]],
  table: [['rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }], ['path', { d: 'M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10' }]],
  home: [['path', { d: 'M4 11l8-7 8 7M6 9.5V20h12V9.5' }], ['path', { d: 'M10 20v-5h4v5' }]],
  calendarView: [['rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }]],
  sensors: [['path', { d: 'M3 17l5-6 4 3 4-7 5 5' }]],
  anomalies: [['path', { d: 'M4 12h16M7 12V6M12 12V9M17 12V4M9.5 12v5M14.5 12v7' }]],
  live: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4' }]],
  // A map pin with a square in it: an area on the map.
  pin: [['path', { d: 'M12 2.5a7 7 0 0 1 7 7c0 5-7 12-7 12s-7-7-7-12a7 7 0 0 1 7-7z' }], ['rect', { x: 9.5, y: 7, width: 5, height: 5, rx: 1 }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }]],
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
