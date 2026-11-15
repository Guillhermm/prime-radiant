import { abbreviateCount, formatCount, MONTH_ABBR } from '../format.js';
import { sensorPoints, sensorsSummary } from '../sensors-model.js';
import { mount as mountTable, tableModel } from './data-table.js';
import { h } from './h.js';
import { svgEl } from './icons.js';
import { spreadLabels } from './live-view.js';
import { segmented } from './segmented.js';

/**
 * Sensors view: an answer card with R, a card on how a harmonized month is built, and a chart of
 * MODIS, VIIRS and the harmonized preview by year or by month, with the satellites under it.
 * Input: the two per-sensor Series of the range (core seriesForAoi, sliced), where null means
 * the sensor was not operating and 0 means nothing was detected, and core's harmonized Series of
 * the same range, which is what the harmonized line plots.
 */

export const SERIES = [
  { id: 'modis', label: 'MODIS' },
  { id: 'viirs', label: 'VIIRS' },
  { id: 'harmonized', label: 'Harmonized' },
];
export const COMPACT_BELOW = 640;
const MAX_WIDTH = 1400;
// The viewBox follows the box's pixel width so the axis text is never scaled.
export const sensorsWidth = (px) => (px > 0 ? Math.min(MAX_WIDTH, Math.max(280, Math.round(px))) : 960);

const idxOf = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const keyIdx = (key) => (key.length === 4 ? Number(key) * 12 : idxOf(key));
const num = (v) => typeof v === 'number';
const count = (v) => (num(v) ? formatCount(Math.round(v)) : '');
export const formatR = (r) => `${r.toFixed(1)}×`;
export const monthName = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const keyLabel = (key) => (key.length === 4 ? key : monthName(key));

/** The answer card's texts for each state. */
export const answerModel = (summary, { viirsFrom, span }) => {
  const { ratio, state } = summary;
  if (state === 'no-overlap') {
    return {
      eyebrow: 'Where both sensors flew', big: null,
      lead: `No overlap in this range. R comes from ${viirsFrom.slice(0, 4)} on; widen the period to see it.`,
      widen: span ? `Show ${span.from.slice(0, 4)}–${span.to.slice(0, 4)}` : null,
    };
  }
  const eyebrow = `Where both sensors flew · ${ratio.from.slice(0, 4)}–${ratio.to.slice(0, 4)}`;
  if (state === 'no-fire') {
    return {
      eyebrow, big: null,
      lead: ratio.viirsSum > 0
        ? 'MODIS saw no fire here while both sensors flew, so R cannot be computed for this area.'
        : 'Both sensors flew but neither saw fire here, so R cannot be computed for this area.',
    };
  }
  return {
    eyebrow, big: formatR(ratio.r), unit: 'VIIRS ÷ MODIS',
    lead: `VIIRS counted ${ratio.r.toFixed(1)} fire-cell-days for every one MODIS counted in this area.`,
    note: `R from ${ratio.withFire} overlap ${ratio.withFire === 1 ? 'month' : 'months'} with detections. Not yet reviewed by the science team.`,
  };
};

/**
 * The three steps, on the busiest month MODIS saw alone: its count, what R would make of it
 * (planned, a Preview), and what the Calendar shows for it today (core's harmonized value).
 */
export const stepsModel = (summary, { viirsFrom }) => {
  const y = viirsFrom.slice(0, 4);
  const ex = summary.example;
  const r = summary.ratio.r;
  const unscaled = !ex || ex.core === ex.modis;
  return [
    { id: 'modis', title: `Before ${y}`, text: ex ? `Only MODIS flew. ${monthName(ex.month)}, MODIS:` : 'Only MODIS flew. No such month in this range.', value: ex ? count(ex.modis) : null },
    {
      id: 'scale', title: r === null ? '× R, planned' : `× R = ${r.toFixed(1)}, planned`, text: 'Would put it on the VIIRS scale, marked estimated:',
      value: ex && num(ex.scaled) ? count(ex.scaled) : '–', preview: true,
    },
    {
      id: 'harmonized', title: 'In the Calendar today',
      text: unscaled
        ? 'R is not applied yet: the calendar shows MODIS as counted until the science team validates R.'
        : `Core's harmonized value for ${monthName(ex.month)}:`,
      value: ex && num(ex.core) ? count(ex.core) : null,
    },
  ];
};

/** A round tick step (1, 2 or 5 times a power of ten) giving three to five gridlines, and the top it reaches. */
export const axisScale = (v) => {
  if (!(v > 0)) return { max: 1, step: 1 };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw);
  return { max: Math.ceil(v / step) * step, step };
};

/** Chart key in words; the dotted line is named only when core marks a month estimated. */
export const sensorsFoot = (summary) => {
  if (!summary.ratio.from) return 'MODIS only in this range: no months where both sensors flew.';
  const dotted = summary.harmonized.some((m) => m.estimated) ? '; dotted where it is estimated' : '';
  return `Shaded: both sensors flying, the months used for R. Dashed: VIIRS. Wide band: harmonized, the same series as the Calendar${dotted}.`;
};

/** Chart geometry in SVG user units: series paths, overlap shading, satellites, ticks, labels. */
export const chartModel = (points, { width = 960, step = 'year', visible = SERIES.map((s) => s.id), overlapFrom = null, satellites = {}, synthetic = false } = {}) => {
  const compact = width < COMPACT_BELOW;
  const height = 300;
  const left = compact ? 44 : 60;
  const right = compact ? 12 : 152;
  const top = 24;
  const plotH = height - top - 28;
  const sats = [...(satellites.modis ?? []).map((s) => ({ ...s, sensor: 'modis' })), ...(satellites.viirs ?? []).map((s) => ({ ...s, sensor: 'viirs' }))];
  const rowH = 15;
  const timelineTop = top + plotH + 32;
  const innerW = width - left - right;
  const t0 = keyIdx(points[0].key);
  const t1 = keyIdx(points.at(-1).key);
  const x = (t) => left + (t1 === t0 ? innerW / 2 : ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * innerW);
  const { max, step: tickStep } = axisScale(Math.max(0, ...points.flatMap((p) => visible.map((id) => (num(p[id]) ? p[id] : 0)))));
  const y = (v) => top + plotH - (v / max) * plotH;
  const xs = points.map((p) => x(keyIdx(p.key)));
  const path = (id, keep = () => true) => {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (!num(p[id]) || !keep(i)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${y(p[id]).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };
  const lines = Object.fromEntries(SERIES.map((s) => [s.id, visible.includes(s.id) ? path(s.id) : '']));
  // The dotted center line marks estimated stretches; each run reaches one point further so it meets the observed line.
  const estimated = lines.harmonized ? path('harmonized', (i) => points[i].estimated || Boolean(points[i - 1]?.estimated)) : '';
  const ticks = Array.from({ length: Math.round(max / tickStep) + 1 }, (_, k) => ({ y: y(k * tickStep), text: k ? abbreviateCount(k * tickStep) : '0' }));
  const y0 = Math.ceil(t0 / 12);
  const y1 = Math.floor(t1 / 12);
  const yearStep = Math.max(1, Math.ceil((y1 - y0) / (compact ? 3 : 6)));
  const xticks = [];
  for (let yr = y0; yr < y1; yr += yearStep) if ((y1 - yr) * 2 >= yearStep) xticks.push({ x: x(yr * 12), text: String(yr) });
  if (y1 * 12 >= t0) xticks.push({ x: x(y1 * 12), text: String(y1), anchor: compact ? 'end' : 'middle' });
  const ov = overlapFrom ? idxOf(overlapFrom) : null;
  const overlap = ov !== null && ov <= t1 ? { x: x(ov), w: x(t1) - x(ov), label: compact ? 'Overlap' : 'Both sensors fly' } : null;
  const timeline = sats.filter((s) => idxOf(s.from) <= t1).map((s, k) => ({
    name: compact ? s.name.replace('S-NPP', 'SNPP').replace('NOAA-20', 'N20') : s.name, sensor: s.sensor,
    y: timelineTop + k * rowH, x1: x(idxOf(s.from)), x2: x(t1),
  }));
  const last = points.length - 1;
  // Series that end on the same value share one label ("MODIS = harmonized"), so two never stack on one line.
  const ends = [];
  for (const s of SERIES.filter((x) => visible.includes(x.id) && num(points[last][x.id]))) {
    const v = points[last][s.id];
    const same = ends.find((e) => e.value === v);
    if (same) same.text += ` = ${s.label.toLowerCase()}`;
    else ends.push({ id: s.id, text: s.label, value: v, y: y(v) + 4 });
  }
  const labels = compact ? [] : spreadLabels(ends, 16).map(({ value, ...l }) => ({ ...l, x: width - right + 10 }));
  return {
    width, height: timelineTop + timeline.length * rowH, left, right, top, innerW, bottom: top + plotH, compact, xs, ticks, xticks, lines, estimated, overlap, timeline, labels,
    stamp: synthetic ? { text: 'SYNTHETIC DATA', x: compact ? left + 8 : width - right - 8, anchor: compact ? 'start' : 'end', y: top + 14 } : null,
    aria: `${synthetic ? 'Synthetic data. ' : ''}Fire-cell-days per ${step} by sensor, ${points[0].key.slice(0, 4)} to ${points[last].key.slice(0, 4)}. The harmonized line is a Preview. Arrow keys read each ${step}.`,
  };
};

/** Tooltip lines for one point: the period, the harmonized value, then the two sensors. */
export const pointLines = (p) => [
  keyLabel(p.key),
  num(p.harmonized) ? `Harmonized ${count(p.harmonized)}${p.estimated ? ', estimated' : ''}` : 'Harmonized: no value',
  [num(p.viirs) ? `VIIRS ${count(p.viirs)}` : 'VIIRS not operating', num(p.modis) ? `MODIS ${count(p.modis)}` : 'MODIS not operating'].join(' · '),
];

const sourceText = (p) => {
  if (!num(p.harmonized)) return 'No value';
  return `${p.sources.join(' and ')}${p.estimated ? ', estimated' : ''}`;
};

export const sensorsTable = (points, { step, r, synthetic }) => tableModel({
  caption: `Fire-cell-days per ${step}, by sensor.${r === null ? '' : ` R = ${r.toFixed(1)} (Preview).`}${synthetic ? ' Synthetic data, not real fire detections.' : ''}`,
  corner: step === 'year' ? 'Year' : 'Month',
  columns: ['MODIS', 'VIIRS', 'Harmonized', 'Source'],
  rows: [...points].reverse().map((p) => ({
    header: keyLabel(p.key),
    cells: [num(p.modis) ? count(p.modis) : 'Not operating', num(p.viirs) ? count(p.viirs) : 'Not operating', num(p.harmonized) ? count(p.harmonized) : 'No value', sourceText(p)],
  })),
  notes: ['Not operating: the sensor has no record then. 0 means it flew and detected nothing.'],
});

const tag = (text, cls = '') => h('span', { class: `tag ${cls}`.trim(), text });
const svgText = (t, attrs) => { const el = svgEl('text', attrs); el.textContent = t; return el; };

const answerCard = (a, { synthetic, onWiden }) => h('section', { class: 'card answer-card sensors-answer', 'aria-label': 'Sensor ratio' },
  h('p', { class: 'eyebrow answer-eyebrow' }, h('span', { text: a.eyebrow }), synthetic ? tag('Synthetic', 'tag-synth') : null),
  a.big ? h('p', { class: 'answer-big' }, h('span', { class: 'answer-num', text: a.big }), h('span', { class: 'answer-unit', text: a.unit })) : null,
  h('p', { class: 'answer-lead' }, a.lead, a.big ? ' ' : null, a.big ? tag('Preview') : null),
  a.note ? h('p', { class: 'hint', text: a.note }) : null,
  a.widen ? h('button', { type: 'button', class: 'btn answer-widen', text: a.widen, onclick: onWiden }) : null);

const stepsCard = (steps) => h('section', { class: 'card sensors-steps', 'aria-labelledby': 'sensors-steps-title' },
  h('h2', { id: 'sensors-steps-title', class: 'eyebrow', text: 'How a harmonized month is built' }),
  h('ol', { class: 'build-steps' }, steps.map((s) => h('li', { class: `build-step step-${s.id}` },
    h('strong', {}, s.id === 'scale' ? null : h('span', { class: `dot dot-${s.id}`, 'aria-hidden': 'true' }), s.title),
    h('span', { text: s.text }),
    s.value ? h('span', { class: 'step-val', text: s.value }) : null,
    s.preview ? tag('Preview') : null))));

/**
 * mount(container, {sensors, harmonized, satellites, viirsFrom, span, synthetic, onWiden}); update(next)
 * merges new deps and repaints. Returns {update, destroy}.
 */
export const mount = (container, deps) => {
  let d = deps;
  let step = 'year';
  let tableOn = false;
  let visible = SERIES.map((s) => s.id);
  let at = null;
  let width = sensorsWidth(container.clientWidth);

  const top = h('div', { class: 'sensors-top' });
  const title = h('h2', { id: 'sensors-chart-title' });
  const chartHost = h('div', { class: 'sensors-plot' });
  const tableHost = h('div', { class: 'sensors-table' });
  const tip = h('div', { class: 'sensors-tip', hidden: true, 'aria-hidden': 'true' });
  const live = h('p', { class: 'sr-only', id: 'sensors-readout', 'aria-live': 'polite' });
  let paint = () => {};
  const stepSeg = segmented('Period', [{ id: 'year', label: 'By year', on: true }, { id: 'month', label: 'By month', on: false }], (id) => { step = id; at = null; paint(); });
  const viewSeg = segmented('Display', [{ id: 'chart', label: 'Chart', on: true }, { id: 'table', label: 'Table', on: false }], (id) => { tableOn = id === 'table'; paint(); });
  const chips = SERIES.map((s) => h('button', { type: 'button', class: `series-chip chip-${s.id}`, 'aria-pressed': 'true', 'data-id': s.id },
    h('span', { class: `dot dot-${s.id}`, 'aria-hidden': 'true' }), s.label));
  chips.forEach((c) => c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    // At least one series stays on, or the chart would be empty.
    if (!on && visible.length === 1) return;
    c.setAttribute('aria-pressed', String(on));
    visible = SERIES.map((s) => s.id).filter((id) => (id === c.dataset.id ? on : visible.includes(id)));
    paint();
  }));
  const chipRow = h('div', { class: 'series-chips', role: 'group', 'aria-label': 'Series' }, chips);
  const foot = h('p', { class: 'hint sensors-foot' });
  const chartCard = h('section', { class: 'card sensors-card', 'aria-labelledby': 'sensors-chart-title' },
    h('div', { class: 'sensors-head' }, title, stepSeg.el, chipRow, viewSeg.el),
    h('div', { class: 'sensors-chart-box' }, chartHost, tip), tableHost, live, foot);
  container.replaceChildren(h('div', { class: 'sensors-view' }, top, chartCard));

  let model = null;
  let points = [];
  const hide = () => { tip.hidden = true; chartHost.querySelector('.sensors-guide')?.setAttribute('visibility', 'hidden'); };
  const show = (k) => {
    if (!model || !points.length) return;
    at = Math.max(0, Math.min(points.length - 1, k));
    const lines = pointLines(points[at]);
    tip.replaceChildren(...lines.map((t, i) => h('span', { class: `tip-line tip-${i}`, text: t })));
    tip.hidden = false;
    const boxW = chartHost.clientWidth || model.width;
    const px = (model.xs[at] / model.width) * boxW;
    tip.style.setProperty('--tip-x', `${Math.round(px)}px`);
    tip.dataset.side = px > boxW / 2 ? 'left' : 'right';
    const guide = chartHost.querySelector('.sensors-guide');
    guide?.setAttribute('x1', model.xs[at]);
    guide?.setAttribute('x2', model.xs[at]);
    guide?.setAttribute('visibility', 'visible');
    live.textContent = lines.join('. ');
  };

  paint = () => {
    const summary = sensorsSummary(d.sensors, d.harmonized);
    const viirsFrom = d.viirsFrom ?? '2012-01';
    top.replaceChildren(answerCard(answerModel(summary, { viirsFrom, span: d.span }), d), stepsCard(stepsModel(summary, { viirsFrom })));
    points = sensorPoints(d.sensors, summary.harmonized, step);
    // On phone the month view is a table: 300 points do not fit 300 units.
    const asTable = tableOn || (width < COMPACT_BELOW && step === 'month');
    viewSeg.set(asTable ? 'table' : 'chart');
    title.textContent = `Fire-cell-days per ${step}, by sensor`;
    chipRow.hidden = asTable;
    foot.textContent = sensorsFoot(summary);
    mountTable(tableHost, { model: sensorsTable(points, { step, r: summary.ratio.r, synthetic: d.synthetic }) });
    tableHost.hidden = !asTable;
    chartHost.hidden = asTable;
    if (asTable || !points.length) { hide(); model = null; chartHost.replaceChildren(); return; }
    model = chartModel(points, { width, step, visible, overlapFrom: summary.ratio.from, satellites: d.satellites, synthetic: d.synthetic });
    const m = model;
    const svg = svgEl('svg', { class: 'sensors-chart', viewBox: `0 0 ${m.width} ${m.height}`, tabindex: '0', role: 'img', 'aria-label': m.aria, 'aria-describedby': 'sensors-readout' });
    if (m.overlap) svg.append(svgEl('rect', { class: 'sensors-overlap', x: m.overlap.x, y: m.top, width: m.overlap.w, height: m.bottom - m.top }), svgText(m.overlap.label, { class: 'sensors-overlap-label', x: m.overlap.x + 6, y: m.top + 14 }));
    m.ticks.forEach((t) => svg.append(svgEl('line', { class: 'sensors-grid', x1: m.left, x2: m.left + m.innerW, y1: t.y, y2: t.y }), svgText(t.text, { class: 'sensors-tick', x: m.left - 6, y: t.y + 4, 'text-anchor': 'end' })));
    m.xticks.forEach((t) => svg.append(svgText(t.text, { class: 'sensors-tick', x: t.x, y: m.bottom + 16, 'text-anchor': t.anchor ?? 'middle' })));
    if (m.lines.harmonized) svg.append(svgEl('path', { class: 'sensors-line line-harmonized', d: m.lines.harmonized }));
    if (m.estimated) svg.append(svgEl('path', { class: 'sensors-line line-estimated', d: m.estimated }));
    if (m.lines.modis) svg.append(svgEl('path', { class: 'sensors-line line-modis', d: m.lines.modis }));
    if (m.lines.viirs) svg.append(svgEl('path', { class: 'sensors-line line-viirs', d: m.lines.viirs }));
    m.labels.forEach((l) => svg.append(svgText(l.text, { class: `sensors-label label-${l.id}`, x: l.x, y: l.y })));
    if (m.stamp) svg.append(svgText(m.stamp.text, { class: 'sensors-stamp', x: m.stamp.x, y: m.stamp.y, 'text-anchor': m.stamp.anchor }));
    m.timeline.forEach((s) => svg.append(
      svgText(s.name, { class: 'sensors-sat', x: m.left - 6, y: s.y + 4, 'text-anchor': 'end' }),
      svgEl('line', { class: `sensors-sat-bar bar-${s.sensor}`, x1: s.x1, x2: s.x2, y1: s.y, y2: s.y })));
    svg.append(svgEl('line', { class: 'sensors-guide', x1: 0, x2: 0, y1: m.top, y2: m.bottom, visibility: 'hidden' }));
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const ux = ((clientX - r.left) / r.width) * m.width;
      let best = 0;
      m.xs.forEach((xv, i) => { if (Math.abs(xv - ux) < Math.abs(m.xs[best] - ux)) best = i; });
      return best;
    };
    svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
    svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
    svg.addEventListener('focus', () => show(at ?? points.length - 1));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) { e.preventDefault(); show((at ?? points.length - 1) + k); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); show(e.key === 'Home' ? 0 : points.length - 1); }
      if (e.key === 'Escape') hide();
    });
    chartHost.replaceChildren(svg);
  };
  paint();
  const watcher = globalThis.ResizeObserver ? new ResizeObserver(() => {
    const next = sensorsWidth(chartHost.clientWidth || container.clientWidth);
    if (next === width || !container.clientWidth) return;
    width = next;
    paint();
  }) : null;
  watcher?.observe(container);
  return {
    update: (next) => { d = { ...d, ...next }; at = null; paint(); },
    destroy: () => { watcher?.disconnect(); container.replaceChildren(); },
  };
};
