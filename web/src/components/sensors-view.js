import { abbreviateCount, formatCount, MONTH_ABBR, MONTH_NAMES } from '../format.js';
import { sensorPoints, sensorsSummary } from '../sensors-model.js';
import { mount as mountTable, tableModel } from './data-table.js';
import { h } from './h.js';
import { svgEl } from './icons.js';
import { spreadLabels } from './live-view.js';
import { segmented } from './segmented.js';
import { satelliteSpans } from '../satellites.js';
import { LEVEL_TEXT } from './cell-detail.js';

/**
 * Sensors view: an answer card with core's R and K, a card on how a harmonized month is built,
 * and a chart of MODIS, S-NPP, NOAA-20 and the harmonized series by year or by month, with the
 * satellites under it. Input: the per-sensor Series of the range (core seriesForAoi, sliced),
 * where null means the sensor was not operating and 0 means nothing was detected, and core's
 * harmonize result with its series cut to the same range, which is what the harmonized line plots.
 */

export const SERIES = [
  { id: 'modis', label: 'MODIS' },
  { id: 'viirs', label: 'S-NPP' },
  { id: 'noaa20', label: 'NOAA-20' },
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
export const formatRatio = (r) => r.toFixed(2);
export const monthName = (ym) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const keyLabel = (key) => (key.length === 4 ? key : monthName(key));
const monthOf = (ym) => MONTH_NAMES[Number(ym.slice(5, 7)) - 1];
const ownRatio = (r, ym) => (r?.perMonth && ym ? r.perMonth[Number(ym.slice(5, 7)) - 1] : null);

/**
 * "95% interval 2.46–2.58, all months · 10 years · September uses its own R, 1.81 · fit on this
 * area", plus the low-confidence chip. With per-month ratios core applies each month's own value,
 * so the note names the one the steps card uses (`month`, "YYYY-MM").
 */
export const ratioNote = (r, { month = null, name = 'R' } = {}) => {
  if (!r || !num(r.value)) return null;
  const parts = [];
  if (r.ci) parts.push(`95% interval ${formatRatio(r.ci[0])}–${formatRatio(r.ci[1])}${r.perMonth ? ', all months' : ''}`);
  parts.push(`${r.nYears} ${r.nYears === 1 ? 'year' : 'years'}`);
  const own = ownRatio(r, month);
  if (own && num(own.value)) parts.push(`${monthOf(month)} uses its own ${name}, ${formatRatio(own.value)}${own.ci ? ` (${formatRatio(own.ci[0])}–${formatRatio(own.ci[1])})` : ''}`);
  else parts.push(r.perMonth ? 'one value per calendar month' : 'one value for the year');
  parts.push(`fit on ${LEVEL_TEXT[r.level] ?? r.level}`);
  return { text: parts.join(' · '), lowConfidence: r.usable === false, borrowed: r.level !== 'aoi' };
};

/**
 * The answer card: core's R (MODIS to VIIRS-equivalent) and K (NOAA-20 to S-NPP). The eyebrow
 * names the months R was fitted on (summary.fit), not core's nominal window, which starts with
 * Aqua years before S-NPP flew.
 */
export const answerModel = (summary) => {
  const { R, K, fit } = summary;
  const eyebrow = fit ? `R fitted on ${fit.from} to ${fit.to}` : 'Where MODIS and S-NPP both flew';
  const k = K && num(K.value) ? { text: `K = ${formatRatio(K.value)}: S-NPP ÷ NOAA-20, used after S-NPP ends.`, note: ratioNote(K, { month: summary.kExample?.month, name: 'K' }) } : null;
  if (summary.state === 'no-r') {
    return { eyebrow, big: null, lead: 'MODIS saw no fire here in the months both sensors flew, at any fallback level, so R cannot be computed.', note: null, k };
  }
  return {
    eyebrow, big: `${formatRatio(R.value)}×`, unit: R.perMonth ? 'VIIRS ÷ MODIS, all months' : 'VIIRS ÷ MODIS',
    lead: `VIIRS counts ${R.value.toFixed(1)} fire-cell-days for every one MODIS counts here, so MODIS × R is VIIRS-equivalent.`,
    note: ratioNote(R, { month: summary.example?.month }),
    k,
  };
};

/**
 * Three steps on real months of the range: the busiest month MODIS supplied, core's value for
 * it (MODIS × R), and the busiest month NOAA-20 supplied after S-NPP (NOAA-20 × K), when any.
 */
export const stepsModel = (summary, { viirsFrom, viirsTo }) => {
  const ex = summary.example;
  const kx = summary.kExample;
  const f = (x) => (x?.factor && num(x.factor.value) ? formatRatio(x.factor.value) : null);
  // With per-month ratios the factor is that month's own R, not the headline one.
  const rFor = summary.R?.perMonth && ex ? ` for ${monthOf(ex.month)}` : '';
  const kFor = summary.K?.perMonth && kx ? ` for ${monthOf(kx.month)}` : '';
  return [
    { id: 'modis', title: `Before ${viirsFrom.slice(0, 4)}`, text: ex ? `Only MODIS flew. ${monthName(ex.month)}, MODIS:` : 'No month in this range was scaled from MODIS.', value: ex ? count(ex.count) : null },
    {
      id: 'scale', title: f(ex) ? `× R${rFor} = ${f(ex)}` : '× R', text: ex ? `VIIRS-equivalent, marked estimated, as the Calendar shows it:` : 'MODIS × R fills the months before VIIRS, marked estimated.',
      value: ex ? count(ex.core) : null,
    },
    {
      id: 'noaa20', title: viirsTo ? `After ${monthName(viirsTo)}` : 'After S-NPP',
      text: kx ? `NOAA-20 × K${kFor} = ${f(kx)} continues S-NPP. ${monthName(kx.month)}:` : 'NOAA-20 × K continues S-NPP once its archive runs past S-NPP. No month in this range needs it yet.',
      value: kx ? count(kx.core) : null,
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

/**
 * Chart key in words; the dotted center line is named only when core marks a month estimated,
 * the hollow points only when a year in `points` is partial.
 */
export const sensorsFoot = (summary, points = []) => {
  const dotted = summary.months.some((m) => m.estimated) ? ', dotted where estimated' : '';
  const shade = summary.fit ? 'Shaded: months used for R. ' : '';
  const hollow = points.some((p) => p.partial.length) ? ' Hollow: partial years, off the lines.' : '';
  const parts = [`${shade}Dashed: S-NPP. Dotted: NOAA-20. Band: harmonized${dotted}.${hollow}`];
  if (!summary.overlap.from) parts.unshift('No month in this range where MODIS and S-NPP both flew.');
  return parts.join(' ');
};

// Direct labels sit at least this far apart (SVG units are CSS pixels here, see sensorsWidth).
export const LABEL_GAP = 16;

/** Chart geometry in SVG user units: series paths, overlap shading, satellites, ticks, labels. */
export const chartModel = (points, { width = 960, step = 'year', visible = SERIES.map((s) => s.id), fit = null, satellites = [], synthetic = false } = {}) => {
  const compact = width < COMPACT_BELOW;
  const height = 300;
  const left = compact ? 44 : 60;
  const right = compact ? 12 : 152;
  const top = 24;
  const plotH = height - top - 28;
  const sats = satellites.map((s) => ({ ...s, sensor: s.family }));
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
  // A partial year's sum is not comparable with a full one: it stays off the line, drawn hollow.
  const whole = (id) => (i) => !points[i].partial?.includes(id);
  const lines = Object.fromEntries(SERIES.map((s) => [s.id, visible.includes(s.id) ? path(s.id, whole(s.id)) : '']));
  const hollow = SERIES.filter((s) => visible.includes(s.id)).flatMap((s) => points
    .map((p, i) => (p.partial?.includes(s.id) && num(p[s.id]) ? { id: s.id, i, x: xs[i], y: y(p[s.id]) } : null)).filter(Boolean));
  // One label per partial year, above its highest hollow point: "2002, Jul–Dec".
  const spans = [...new Set(hollow.map((p) => p.i))].map((i) => {
    const top = Math.min(...hollow.filter((p) => p.i === i).map((p) => p.y));
    const edge = xs[i] < left + 40 ? 'start' : xs[i] > left + innerW - 40 ? 'end' : 'middle';
    return { text: `${points[i].key}, ${points[i].span}`, x: xs[i], y: Math.max(top - 8, 12), anchor: edge };
  });
  // The dotted center line marks estimated stretches; each run reaches one point further so it meets the observed line.
  const estimated = lines.harmonized ? path('harmonized', (i) => whole('harmonized')(i) && (points[i].estimated || Boolean(points[i - 1]?.estimated))) : '';
  const ticks = Array.from({ length: Math.round(max / tickStep) + 1 }, (_, k) => ({ y: y(k * tickStep), text: k ? abbreviateCount(k * tickStep) : '0' }));
  const y0 = Math.ceil(t0 / 12);
  const y1 = Math.floor(t1 / 12);
  const yearStep = Math.max(1, Math.ceil((y1 - y0) / (compact ? 3 : 6)));
  const xticks = [];
  for (let yr = y0; yr < y1; yr += yearStep) if ((y1 - yr) * 2 >= yearStep) xticks.push({ x: x(yr * 12), text: String(yr) });
  // The last year ends the axis under the direct labels: right-aligned, it never runs into them.
  if (y1 * 12 >= t0) xticks.push({ x: x(y1 * 12), text: String(y1), anchor: 'end' });
  const f0 = fit ? idxOf(fit.from) : null;
  const f1 = fit ? idxOf(fit.to) : null;
  const overlap = fit && f0 <= t1 && f1 >= t0 ? { x: x(f0), w: x(f1) - x(f0), label: 'Months used for R' } : null;
  const timeline = sats.filter((s) => idxOf(s.from) <= t1).map((s, k) => ({
    name: compact ? s.name.replace('S-NPP', 'SNPP').replace('NOAA-20', 'N20') : s.name, sensor: s.sensor,
    y: timelineTop + k * rowH, x1: x(idxOf(s.from)), x2: x(Math.min(t1, idxOf(s.to))),
  }));
  const last = points.length - 1;
  // Each label sits at its line's end, the last whole point. Series that end on the same value
  // share one label ("MODIS = harmonized"), so two never stack on one line.
  const ends = [];
  for (const s of SERIES.filter((x) => visible.includes(x.id))) {
    const i = points.findLastIndex((p, k) => num(p[s.id]) && whole(s.id)(k));
    if (i < 0) continue;
    const v = points[i][s.id];
    const same = ends.find((e) => e.value === v);
    if (same) same.text += ` = ${s.label.toLowerCase()}`;
    else ends.push({ id: s.id, text: s.label, value: v, y: y(v) + 4 });
  }
  let spread = spreadLabels(ends, LABEL_GAP);
  // Keep the lowest label above the x axis text: shift the stack up, never closer together.
  const floor = top + plotH;
  const over = spread.length ? spread.at(-1).y - floor : 0;
  if (over > 0) spread = spread.map((l) => ({ ...l, y: l.y - over }));
  const labels = compact ? [] : spread.map(({ value, ...l }) => ({ ...l, x: width - right + 10 }));
  return {
    width, height: timelineTop + timeline.length * rowH, left, right, top, innerW, bottom: top + plotH, compact, xs, ticks, xticks, lines, estimated, hollow, spans, overlap, timeline, labels,
    stamp: synthetic ? { text: 'SYNTHETIC DATA', x: compact ? left + 8 : width - right - 8, anchor: compact ? 'start' : 'end', y: top + 14 } : null,
    aria: `${synthetic ? 'Synthetic data. ' : ''}Fire-cell-days per ${step} by sensor, ${points[0].key.slice(0, 4)} to ${points[last].key.slice(0, 4)}. Arrow keys read each ${step}.`,
  };
};

/** Tooltip lines for one point: the period, the harmonized value, then the two sensors. */
export const pointLines = (p) => [
  keyLabel(p.key),
  num(p.harmonized) ? `Harmonized ${count(p.harmonized)}${p.estimated ? ', estimated' : ''}` : 'Harmonized: no value',
  [num(p.viirs) ? `S-NPP ${count(p.viirs)}` : 'S-NPP not operating', num(p.noaa20) ? `NOAA-20 ${count(p.noaa20)}` : 'NOAA-20 not operating', num(p.modis) ? `MODIS ${count(p.modis)}` : 'MODIS not operating'].join(' · '),
];

const sourceText = (p) => {
  if (!num(p.harmonized)) return 'No value';
  return `${p.sources.join(' and ')}${p.estimated ? ', estimated' : ''}`;
};

export const sensorsTable = (points, { step, r, synthetic }) => tableModel({
  caption: `Fire-cell-days per ${step}, by sensor.${num(r) ? ` R = ${formatRatio(r)}.` : ''}${synthetic ? ' Synthetic data, not real fire detections.' : ''}`,
  corner: step === 'year' ? 'Year' : 'Month',
  columns: ['MODIS', 'S-NPP', 'NOAA-20', 'Harmonized', 'Source'],
  rows: [...points].reverse().map((p) => ({
    header: keyLabel(p.key),
    cells: [...['modis', 'viirs', 'noaa20'].map((id) => (num(p[id]) ? count(p[id]) : 'Not operating')), num(p.harmonized) ? count(p.harmonized) : 'No value', sourceText(p)],
  })),
  notes: ['Not operating: the sensor has no record then. 0 means it flew and detected nothing.'],
});

const tag = (text, cls = '') => h('span', { class: `tag ${cls}`.trim(), text });
const svgText = (t, attrs) => { const el = svgEl('text', attrs); el.textContent = t; return el; };

const noteEl = (n) => n && h('p', { class: 'hint' }, n.text, n.lowConfidence ? ' ' : null, n.lowConfidence ? tag('Low confidence') : null);

const answerCard = (a, { synthetic }) => h('section', { class: 'card answer-card sensors-answer', 'aria-label': 'Sensor ratios' },
  h('p', { class: 'eyebrow answer-eyebrow' }, h('span', { text: a.eyebrow }), synthetic ? tag('Synthetic', 'tag-synth') : null),
  a.big ? h('p', { class: 'answer-big' }, h('span', { class: 'answer-num', text: a.big }), h('span', { class: 'answer-unit', text: a.unit })) : null,
  h('p', { class: 'answer-lead', text: a.lead }),
  noteEl(a.note),
  a.k ? h('p', { class: 'answer-ratio', text: a.k.text }) : null,
  a.k ? noteEl(a.k.note) : null);

const stepsCard = (steps) => h('section', { class: 'card sensors-steps', 'aria-labelledby': 'sensors-steps-title' },
  h('h2', { id: 'sensors-steps-title', class: 'eyebrow', text: 'How a harmonized month is built' }),
  h('ol', { class: 'build-steps' }, steps.map((s) => h('li', { class: `build-step step-${s.id}` },
    h('strong', {}, s.id === 'scale' ? null : h('span', { class: `dot dot-${s.id}`, 'aria-hidden': 'true' }), s.title),
    h('span', { text: s.text }),
    s.value ? h('span', { class: 'step-val', text: s.value }) : null))));

/**
 * mount(container, {sensors, harmonized, manifest, synthetic}); update(next)
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
    const summary = sensorsSummary(d.sensors, d.harmonized, d.manifest);
    const cov = d.manifest?.coverage?.viirs;
    top.replaceChildren(answerCard(answerModel(summary), d), stepsCard(stepsModel(summary, { viirsFrom: cov?.[0] ?? '2012-01', viirsTo: cov?.[1] ?? null })));
    points = sensorPoints(d.sensors, summary.months, step);
    // On phone the month view is a table: 300 points do not fit 300 units.
    const asTable = tableOn || (width < COMPACT_BELOW && step === 'month');
    viewSeg.set(asTable ? 'table' : 'chart');
    title.textContent = `Fire-cell-days per ${step}, by sensor`;
    chipRow.hidden = asTable;
    foot.textContent = sensorsFoot(summary, points);
    mountTable(tableHost, { model: sensorsTable(points, { step, r: summary.R?.value, synthetic: d.synthetic }) });
    tableHost.hidden = !asTable;
    chartHost.hidden = asTable;
    if (asTable || !points.length) { hide(); model = null; chartHost.replaceChildren(); return; }
    model = chartModel(points, { width, step, visible, fit: summary.fit, satellites: satelliteSpans(d.manifest), synthetic: d.synthetic });
    const m = model;
    const svg = svgEl('svg', { class: 'sensors-chart', viewBox: `0 0 ${m.width} ${m.height}`, tabindex: '0', role: 'img', 'aria-label': m.aria, 'aria-describedby': 'sensors-readout' });
    if (m.overlap) svg.append(svgEl('rect', { class: 'sensors-overlap', x: m.overlap.x, y: m.top, width: m.overlap.w, height: m.bottom - m.top }), svgText(m.overlap.label, { class: 'sensors-overlap-label', x: m.overlap.x + 6, y: m.top + 14 }));
    m.ticks.forEach((t) => svg.append(svgEl('line', { class: 'sensors-grid', x1: m.left, x2: m.left + m.innerW, y1: t.y, y2: t.y }), svgText(t.text, { class: 'sensors-tick', x: m.left - 6, y: t.y + 4, 'text-anchor': 'end' })));
    m.xticks.forEach((t) => svg.append(svgText(t.text, { class: 'sensors-tick', x: t.x, y: m.bottom + 16, 'text-anchor': t.anchor ?? 'middle' })));
    if (m.lines.harmonized) svg.append(svgEl('path', { class: 'sensors-line line-harmonized', d: m.lines.harmonized }));
    if (m.estimated) svg.append(svgEl('path', { class: 'sensors-line line-estimated', d: m.estimated }));
    if (m.lines.modis) svg.append(svgEl('path', { class: 'sensors-line line-modis', d: m.lines.modis }));
    if (m.lines.viirs) svg.append(svgEl('path', { class: 'sensors-line line-viirs', d: m.lines.viirs }));
    if (m.lines.noaa20) svg.append(svgEl('path', { class: 'sensors-line line-noaa20', d: m.lines.noaa20 }));
    m.hollow.forEach((p) => svg.append(svgEl('circle', { class: `sensors-hollow hollow-${p.id}`, cx: p.x, cy: p.y, r: 3.5 })));
    m.spans.forEach((t) => svg.append(svgText(t.text, { class: 'sensors-span', x: t.x, y: t.y, 'text-anchor': t.anchor })));
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
