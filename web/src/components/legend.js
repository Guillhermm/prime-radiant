import { BINS } from '../bins.js';
import { h } from './h.js';

export const UNIT_SENTENCE = 'Color: fire-cell-days per 1,000 grid cells (density). Number: raw fire-cell-days.';

export const legendModel = () => ({
  bins: BINS.map((b) => ({ id: b.id, label: b.label, text: b.id === 0 ? 'No detections (0)' : `${b.label} per 1,000 cells` })),
  nodata: 'No data (sensor not operating)',
  marks: [
    { id: 'estimated', label: 'Estimated value' },
    { id: 'partial', label: 'Partial month' },
  ],
  unit: UNIT_SENTENCE,
});

export const mount = (container) => {
  const m = legendModel();
  const bins = m.bins.map((b) => h('li', { class: 'legend-item' }, h('span', { class: `swatch bin-${b.id}`, 'aria-hidden': 'true' }), h('span', { text: b.label, title: b.text })));
  const extras = [
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch nodata', 'aria-hidden': 'true' }), h('span', { text: 'No data' })),
    ...m.marks.map((k) => h('li', { class: 'legend-item' }, h('span', { class: `swatch mark-${k.id}`, 'aria-hidden': 'true' }), h('span', { text: k.label }))),
  ];
  container.replaceChildren(h('div', { class: 'legend', role: 'group', 'aria-label': 'Legend' },
    h('ul', { class: 'legend-list' }, bins, extras),
    h('p', { class: 'legend-unit', text: m.unit })));
  return { destroy: () => container.replaceChildren() };
};
