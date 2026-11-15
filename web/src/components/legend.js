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

// Lower edge of each density class, printed under the stepped bar (Datawrapper style: one bar,
// ticks at the class edges).
export const RAMP_TICKS = ['0', '1', '4', '16', '64', '256', '1024+'];

/** The stepped color bar for the grid header; aria-hidden, the foot carries the words. */
export const ramp = (layer = 'counts') => {
  if (layer === 'anomaly') {
    const m = anomalyLegendModel();
    return h('div', { class: 'ramp ramp-div', 'aria-hidden': 'true' },
      h('div', { class: 'ramp-bar' }, m.bins.map((b) => h('i', { class: `div-${b.id}` }))),
      h('div', { class: 'ramp-ends' }, h('span', { text: 'Less fire' }), h('span', { text: 'Median' }), h('span', { text: 'More fire' })));
  }
  return h('div', { class: 'ramp', 'aria-hidden': 'true' },
    h('div', { class: 'ramp-bar' }, BINS.map((b) => h('i', { class: `bin-${b.id}` }))),
    h('div', { class: 'ramp-ticks' }, RAMP_TICKS.map((t) => h('span', { text: t }))));
};

const countsLegend = () => {
  const m = legendModel();
  const bins = h('ul', { class: 'legend-list legend-bins sr-only' }, m.bins.map((b) => h('li', { class: 'legend-item' }, h('span', { class: `swatch bin-${b.id}`, 'aria-hidden': 'true' }), h('span', { text: b.text }))));
  const extras = h('ul', { class: 'legend-list' },
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch nodata', 'aria-hidden': 'true' }), h('span', { text: 'No data' })),
    ...m.marks.map((k) => h('li', { class: 'legend-item' }, h('span', { class: `swatch mark-${k.id}`, 'aria-hidden': 'true' }), h('span', { text: k.label }))));
  return [bins, extras, h('p', { class: 'legend-unit legend-estimated-note', text: ESTIMATED_NOTE }), h('p', { class: 'legend-unit', text: m.unit })];
};

// The stepped bar in the card header carries the colors; the foot keeps the marks and, under
// the Calendar's anomaly layer, the unit sentence. The classes stay listed for screen readers.
const anomalyLegend = ({ marksOnly = false } = {}) => {
  const m = anomalyLegendModel();
  const list = h('ul', { class: 'legend-list sr-only' }, m.bins.map((b) => h('li', { text: b.text })));
  const extras = h('ul', { class: 'legend-list' },
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch mark-flagged', 'aria-hidden': 'true' }), h('span', { text: m.marks[0].label })),
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch div-norank', 'aria-hidden': 'true' }), h('span', { text: m.norank })),
    h('li', { class: 'legend-item' }, h('span', { class: 'swatch nodata', 'aria-hidden': 'true' }), h('span', { text: 'No data' })));
  return marksOnly ? [list, extras] : [list, extras, h('p', { class: 'legend-unit', text: m.unit })];
};

/** mount(container, {layer, marksOnly}). Returns {update({layer}), destroy()}. */
export const mount = (container, { layer = 'counts', marksOnly = false } = {}) => {
  const paint = (l) => container.replaceChildren(h('div', { class: 'legend', role: 'group', 'aria-label': 'Legend' }, l === 'anomaly' ? anomalyLegend({ marksOnly }) : countsLegend()));
  paint(layer);
  return { update: (next) => paint(next.layer), destroy: () => container.replaceChildren() };
};
