import { BINS } from '../bins.js';
import { DIV_CLASSES, CENTER_CLASS, divRange, ordinal } from './anomaly-layer.js';
import { h } from './h.js';

export const UNIT_SENTENCE = 'Color: fire-cell-days per 1,000 grid cells (density). Number: raw fire-cell-days.';

export const ESTIMATED_NOTE = 'All values in this range are estimated.';

export const legendModel = () => ({
  bins: BINS.map((b) => ({ id: b.id, label: b.label, text: b.id === 0 ? 'No detections (0)' : `${b.label} per 1,000 cells` })),
  nodata: 'No data (sensor not operating)',
  marks: [
    { id: 'estimated', label: 'Estimated value' },
    { id: 'partial', label: 'Partial month' },
  ],
  unit: UNIT_SENTENCE,
});

export const ANOMALY_UNIT_SENTENCE = 'Color: percentile rank of the month against the same calendar month in the baseline years. Center is the historical median. Number: percentile rank.';

export const anomalyLegendModel = () => ({
  bins: Array.from({ length: DIV_CLASSES }, (_, i) => {
    const [lo, hi] = divRange(i);
    const side = i < CENTER_CLASS ? 'below median' : i > CENTER_CLASS ? 'above median' : 'near median';
    return { id: i, text: `${ordinal(lo)} to ${ordinal(hi)} percentile, ${side}` };
  }),
  ends: { low: 'Below median (less fire)', center: 'Median', high: 'Above median (more fire)' },
  marks: [{ id: 'flagged', label: 'Flagged as unusual' }],
  norank: 'No rank (baseline too short)',
  nodata: 'No data (sensor not operating)',
  unit: ANOMALY_UNIT_SENTENCE,
});

const countsLegend = () => {
  const m = legendModel();
  const bins = m.bins.map((b) => h('li', { class: 'legend-item' }, h('span', { class: `swatch bin-${b.id}`, 'aria-hidden': 'true' }), h('span', { text: b.label, title: b.text })));
  const extras = [
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch nodata', 'aria-hidden': 'true' }), h('span', { text: 'No data' })),
    ...m.marks.map((k) => h('li', { class: 'legend-item' }, h('span', { class: `swatch mark-${k.id}`, 'aria-hidden': 'true' }), h('span', { text: k.label }))),
  ];
  return [h('ul', { class: 'legend-list' }, bins, extras), h('p', { class: 'legend-unit legend-estimated-note', text: ESTIMATED_NOTE }), h('p', { class: 'legend-unit', text: m.unit })];
};

const anomalyLegend = () => {
  const m = anomalyLegendModel();
  const ramp = h('ul', { class: 'legend-ramp' }, m.bins.map((b) => h('li', { class: `swatch div-${b.id}`, title: b.text, 'aria-label': b.text })));
  const ends = h('p', { class: 'legend-ends', 'aria-hidden': 'true' }, h('span', { text: m.ends.low }), h('span', { text: m.ends.center }), h('span', { text: m.ends.high }));
  const extras = h('ul', { class: 'legend-list' },
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch mark-flagged', 'aria-hidden': 'true' }), h('span', { text: m.marks[0].label })),
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch div-norank', 'aria-hidden': 'true' }), h('span', { text: m.norank })),
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch nodata', 'aria-hidden': 'true' }), h('span', { text: 'No data' })));
  return [ramp, ends, extras, h('p', { class: 'legend-unit', text: m.unit })];
};

/** mount(container, {layer}). Returns {update({layer}), destroy()}. */
export const mount = (container, { layer = 'counts' } = {}) => {
  const paint = (l) => container.replaceChildren(h('div', { class: 'legend', role: 'group', 'aria-label': 'Legend' }, l === 'anomaly' ? anomalyLegend() : countsLegend()));
  paint(layer);
  return { update: (next) => paint(next.layer), destroy: () => container.replaceChildren() };
};
