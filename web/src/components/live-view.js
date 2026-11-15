import { formatCount, MONTH_ABBR, MONTH_NAMES, monthLabel } from '../format.js';
import { mount as mountTable, tableModel } from './data-table.js';
import { h } from './h.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';
import { liveStatus, mount as mountStates } from './states.js';

/**
 * Input contract (built by web/src/live-data.js from core/live.js; preview-stubs.js for synthetic data).
 *
 *   {
 *     fetched_at: string|null,          // ISO 8601 UTC of the last successful live fetch (manifest or tile)
 *     live: Series {                    // id 'live', comparable: false: never added to harmonized totals
 *       id: 'live', unit: 'fire-cell-days', comparable: false, method: { id, version },
 *       step?: 'month' | 'day',         // default 'month'
 *       start: 'YYYY-MM' | 'YYYY-MM-DD',// matches step
 *       values: (number|null)[],        // the current season so far; null = no data, 0 = none detected
 *     },
 *     band: {                           // historical band, index-aligned with live.values (same length)
 *       p25: (number|null)[], median: (number|null)[], p75: (number|null)[],
 *     },
 *     provisional?: boolean,            // default true: the last value is the current, still-open period
 *     preview?: boolean,                // default true: tags the statistics Preview (false once gate V3 passed)
 *     band may be null: the live line alone, with no comparison (outside the share region).
 *     disclaimer?: string,              // shown in the chart card, above the chart
 *     reason?: string,                  // instead of live and band: why there is no comparison
 *     title?, sub?: string, lowConfidence?: boolean, lowConfidenceReasons?: string[], notes?: string[],
 *   }
 * Percentiles of the same calendar month (or day) across the baseline years; computed by core.
 */

export const VIEW = { width: 640, height: 300, left: 52, right: 136, top: 16, bottom: 32 };
// Below this width the series labels leave the plot for a key under it. The viewBox is always the
// real pixel width, so the 0.75rem text is never scaled.
export const COMPACT_BELOW = 640;
const MIN_WIDTH = 280;
const MAX_WIDTH = 1400;

export const chartWidth = (px) => (px > 0 ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px))) : VIEW.width);
const GAP = 14;

const pad = (n) => String(n).padStart(2, '0');

/** Label of the i-th period from `start`: "March 2026" for months, "2026-03-07" for days. */
export const periodLabel = (start, step, i) => {
  if (step === 'day') {
    const [y, m, d] = start.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + i));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const idx = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + i;
  return monthLabel(Math.floor(idx / 12), (idx % 12) + 1);
};

export const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

/** Short x label: "Nov", "Jan 2026" (the year only on January), or the day for daily data. */
export const shortPeriod = (start, step, i) => {
  if (step === 'day') return periodLabel(start, step, i).slice(5);
  const idx = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + i;
  const m = idx % 12;
  return m === 0 ? `${MONTH_ABBR[0]} ${Math.floor(idx / 12)}` : MONTH_ABBR[m];
};

/** "Fetched 2 h ago · 14 Nov, 23:39 UTC": relative, then absolute in UTC. */
export const fetchedLabel = (fetchedAt, now = new Date()) => {
  const t = new Date(fetchedAt);
  const min = Math.max(0, Math.round((now - t) / 60000));
  let ago = 'just now';
  if (min >= 1 && min < 60) ago = `${min} min ago`;
  else if (min >= 60 && min < 48 * 60) ago = `${Math.round(min / 60)} h ago`;
  else if (min >= 48 * 60) ago = `${Math.round(min / 1440)} days ago`;
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `Fetched ${ago} · ${t.getUTCDate()} ${MONTH_ABBR[t.getUTCMonth()]}, ${hh}:${mm} UTC`;
};

/** Answer card texts: the latest period against its median (a Preview statistic). */
export const liveAnswer = ({ live, band, provisional = true }) => {
  const step = live.step ?? 'month';
  const last = live.values.length - 1;
  const v = live.values[last];
  const med = band?.median[last];
  const day = periodLabel(live.start, step, last);
  // Daily values are the month's running total, so the answer names the month and the last day.
  const when = step === 'day' ? `${monthLabel(Number(day.slice(0, 4)), Number(day.slice(5, 7)))} through day ${Number(day.slice(8))}` : day;
  const name = step === 'month' ? `${MONTH_NAMES[(Number(live.start.slice(5, 7)) - 1 + last) % 12]} median` : 'median of the same days in past years';
  const headline = typeof v === 'number' ? `${when}${provisional ? ' so far' : ''}: ${formatCount(v)} fire-cell-days` : `${when}: no data yet`;
  let delta = null;
  if (typeof v === 'number' && typeof med === 'number' && med > 0) {
    const pct = Math.round(((v - med) / med) * 100);
    delta = `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}% vs the ${name}`;
  }
  return { headline, delta };
};

/** Integer-only y ticks from 0 to the nice maximum: 0, half and max, dropping halves that are not whole. */
export const niceTicks = (max) => [0, max / 2, max].filter((v, i, a) => Number.isInteger(v) && a.indexOf(v) === i);

/** Runs of consecutive indices where every listed array has a number. */
export const runs = (n, ...arrays) => {
  const out = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    if (arrays.every((a) => typeof a[i] === 'number')) (cur ??= []).push(i);
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
};

/** Pushes labels apart so neighbors are at least `gap` apart, keeping order. */
export const spreadLabels = (labels, gap = GAP) => {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i - 1].y < gap) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + gap };
  return sorted;
};

const noBand = (n) => ({ p25: Array(n).fill(null), median: Array(n).fill(null), p75: Array(n).fill(null) });

const validate = ({ live, band }) => {
  if (!live || !Array.isArray(live.values) || !live.start) throw new TypeError('live-view: live must be a Series with start and values');
  if (live.id !== 'live' || live.comparable !== false) throw new RangeError('live-view: the live Series must have id "live" and comparable false');
  if (band === null) return;
  for (const k of ['p25', 'median', 'p75']) {
    if (!Array.isArray(band?.[k]) || band[k].length !== live.values.length) throw new RangeError(`live-view: band.${k} must have the same length as live.values`);
  }
};

/**
 * View model. When the data is missing or stale, returns {available: false, state} for
 * states.mount; otherwise geometry in SVG user units plus labels, points and texts.
 */
export const liveModel = ({ fetched_at: fetchedAt = null, live, band, provisional = true, reason = null, now = new Date(), width = VIEW.width } = {}) => {
  const status = liveStatus(fetchedAt, now);
  if (!status.available) return { available: false, status, state: { kind: 'live-unavailable', fetchedAt, now } };
  if (reason) return { available: false, status, state: { kind: 'live-unavailable', fetchedAt, now, reason } };
  validate({ live, band });
  const compared = band !== null;
  band = compared ? band : noBand(live.values.length);
  const step = live.step ?? 'month';
  const n = live.values.length;
  const { height, top, bottom } = VIEW;
  const compact = width < COMPACT_BELOW;
  const left = compact ? 44 : VIEW.left;
  const right = compact ? 12 : VIEW.right;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const all = [...live.values, ...band.p75, ...band.p25, ...band.median].filter((v) => typeof v === 'number');
  const yMax = niceMax(Math.max(0, ...all));
  const x = (i) => left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v) => top + innerH - (v / yMax) * innerH;
  const pt = (i, v) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  const poly = (idx, arr) => idx.map((i, k) => `${k ? 'L' : 'M'}${pt(i, arr[i])}`).join(' ');

  const last = n - 1;
  const closed = provisional ? live.values.map((v, i) => (i === last ? null : v)) : live.values;
  const linePath = runs(n, closed).map((r) => poly(r, closed)).join(' ');
  const hasTail = provisional && n > 1 && typeof live.values[last] === 'number' && typeof live.values[last - 1] === 'number';
  const tailPath = hasTail ? `M${pt(last - 1, live.values[last - 1])} L${pt(last, live.values[last])}` : '';
  const medianPath = runs(n, band.median).map((r) => poly(r, band.median)).join(' ');
  const bandPath = runs(n, band.p25, band.p75).map((r) => {
    const up = r.map((i, k) => `${k ? 'L' : 'M'}${pt(i, band.p75[i])}`).join(' ');
    const down = [...r].reverse().map((i) => `L${pt(i, band.p25[i])}`).join(' ');
    return `${up} ${down} Z`;
  }).join(' ');

  const points = [];
  live.values.forEach((v, i) => {
    if (typeof v !== 'number') return;
    const isProv = provisional && i === last;
    const when = periodLabel(live.start, step, i);
    const bits = [`${when}, ${formatCount(v)} fire-cell-days`];
    if (isProv) bits.push('provisional, the period is still open');
    if (typeof band.median[i] === 'number') bits.push(`historical median ${formatCount(band.median[i])}`);
    if (typeof band.p25[i] === 'number' && typeof band.p75[i] === 'number') bits.push(`middle half ${formatCount(band.p25[i])} to ${formatCount(band.p75[i])}`);
    points.push({ i, x: x(i), y: y(v), value: v, label: when, provisional: isProv, aria: bits.join(', ') });
  });

  const ticks = niceTicks(yMax).map((v) => ({ y: y(v), text: formatCount(v) }));
  const every = Math.max(1, Math.ceil(n / (compact ? 4 : 12)));
  const xticks = Array.from({ length: n }, (_, i) => i).filter((i) => i === last || (i % every === 0 && last - i >= every))
    .map((i) => ({ x: x(i), text: shortPeriod(live.start, step, i), anchor: compact && i === last ? 'end' : 'middle' }));

  const labelX = width - right + 8;
  const raw = [];
  const lv = live.values[last];
  const tail = (arr) => arr[last];
  if (typeof lv === 'number') raw.push({ text: compared ? 'Current season' : 'Running total', cls: 'live', y: y(lv) + 4 });
  if (typeof tail(band.median) === 'number') raw.push({ text: 'Historical median', cls: 'median', y: y(tail(band.median)) + 4 });
  // The band is named inside itself where it is widest; when it is too thin there, it gets a direct label.
  let widest = null;
  band.p25.forEach((lo, i) => {
    const hi = band.p75[i];
    if (typeof lo === 'number' && typeof hi === 'number' && (!widest || y(lo) - y(hi) > widest.h)) widest = { i, h: y(lo) - y(hi), top: y(hi) };
  });
  const bandLabel = !compact && widest && widest.h >= 36 ? { text: 'Middle half of past years', x: x(widest.i), y: widest.top + 16 } : null;
  if (!bandLabel && typeof tail(band.p75) === 'number') raw.push({ text: 'Middle half of past years', cls: 'band', y: y(tail(band.p75)) + 4 });
  const labels = compact ? [] : spreadLabels(raw, 16).map((l) => ({ ...l, x: labelX }));
  const key = compact ? raw.map(({ text, cls }) => ({ text, cls })) : [];

  const current = typeof lv === 'number'
    ? { label: periodLabel(live.start, step, last), value: lv, provisional, text: `${periodLabel(live.start, step, last)}: ${formatCount(lv)} fire-cell-days so far${provisional ? ', provisional' : ''}` }
    : null;

  return {
    available: true, compared, status, fetchedText: fetchedLabel(fetchedAt, now), step, current, bandLabel,
    badge: provisional ? 'Provisional' : null,
    note: 'Live detections are shown on their own. They are never added to the harmonized totals.',
    width, height, left, innerW, bottom: top + innerH, compact,
    linePath, tailPath, medianPath, bandPath, points, ticks, xticks, labels, key,
  };
};

/** Data-table alternative to the chart: one row per period, the live value next to the band. */
export const liveTableModel = ({ live, band, provisional = true, preview = true }, { synthetic = false } = {}) => {
  validate({ live, band });
  const step = live.step ?? 'month';
  const last = live.values.length - 1;
  const header = (i) => `${periodLabel(live.start, step, i)}${provisional && i === last ? ' (provisional)' : ''}`;
  if (band === null) {
    return tableModel({
      caption: `Running total of fire-cell-days, not compared with past years.${synthetic ? ' Synthetic data, not real fire detections.' : ''}`,
      corner: step === 'day' ? 'Day' : 'Month',
      columns: ['Running total'],
      rows: live.values.map((v, i) => ({ header: header(i), cells: [typeof v === 'number' ? formatCount(v) : 'No data'] })),
    });
  }
  // A null live value means no data; a null band value means too few past years to compute it.
  const cell = (v, missing) => (typeof v === 'number' ? formatCount(v) : missing);
  return tableModel({
    caption: `Current season fire-cell-days against past years.${synthetic ? ' Synthetic data, not real fire detections.' : ''}${preview ? ' Median and percentiles are a Preview.' : ''}`,
    corner: step === 'day' ? 'Day' : 'Month',
    columns: ['Current season', 'Historical median', '25th percentile', '75th percentile'],
    rows: live.values.map((v, i) => ({
      header: `${periodLabel(live.start, step, i)}${provisional && i === last ? ' (provisional)' : ''}`,
      cells: [cell(v, 'No data'), cell(band.median[i], 'Not available'), cell(band.p25[i], 'Not available'), cell(band.p75[i], 'Not available')],
    })),
  });
};

/** Index of the point to focus after a key, or null when the key does not move. */
export const nextPoint = (key, index, count) => {
  if (count <= 0) return null;
  if (key === 'ArrowRight') return Math.min(count - 1, index + 1);
  if (key === 'ArrowLeft') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
};

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
};
const text = (t, attrs, tag = 'text') => { const el = s(tag, attrs); el.textContent = t; return el; };

const tagEl = (t, cls = '') => h('span', { class: `tag ${cls}`.trim(), text: t });

/**
 * mount(container, {input, now, synthetic}). `input` is the contract above; update(next) takes a
 * new input (same shape, optional `now`). Renders an answer card and the chart card. Returns
 * {update, destroy}.
 */
export const mount = (container, deps = {}) => {
  let tableOn = false;
  // The chart sits in a card: its padding and border come off the slot's width.
  const plotWidth = () => chartWidth(container.clientWidth - 46);
  let width = plotWidth();
  const synthetic = deps.synthetic === true;
  const paint = ({ input, now }) => {
    const m = liveModel({ ...input, now, width });
    if (!m.available) {
      const box = h('div', { class: 'live-view' });
      container.replaceChildren(box);
      mountStates(box, {}).show(m.state);
      return;
    }
    const a = liveAnswer(input);
    const preview = input.preview !== false;
    const low = input.lowConfidence === true;
    const answer = h('section', { class: 'card answer-card live-answer', 'aria-label': m.compared ? 'This season so far' : 'This month so far' },
      h('p', { class: 'eyebrow answer-eyebrow' }, h('span', { text: m.compared ? 'This fire season' : 'This month, not compared' }), synthetic ? tagEl('Synthetic', 'tag-synth') : null,
        m.badge ? tagEl(m.badge, 'tag-fire') : null, low ? tagEl('Low confidence') : null),
      h('p', { class: 'answer-big live-headline', text: a.headline }),
      a.delta ? h('p', { class: 'answer-lead' }, a.delta, preview ? ' ' : null, preview ? tagEl('Preview') : null) : null,
      low && input.lowConfidenceReasons?.length ? h('p', { class: 'hint', text: `Low confidence: ${input.lowConfidenceReasons.join('; ')}.` }) : null,
      h('p', { class: 'hint', text: m.fetchedText }));

    const readout = h('p', { class: 'live-readout', 'aria-hidden': 'true' });
    const circles = m.points.map((p, k) => s('circle', {
      class: `live-point${p.provisional ? ' is-provisional' : ''}`, cx: p.x, cy: p.y, r: 5, tabindex: k === m.points.length - 1 ? 0 : -1,
      role: 'img', 'aria-label': p.aria, 'data-k': k,
    }));
    const prefix = synthetic ? 'Synthetic data. ' : '';
    const svg = s('svg', { class: 'live-chart', viewBox: `0 0 ${m.width} ${m.height}`, role: 'group', 'aria-label': m.compared ? `${prefix}Current season against the historical band, a Preview` : `${prefix}Running total of this month, not compared with past years` },
      text(m.compared ? `${prefix}Current season fire-cell-days against the 25th to 75th percentile band and median of past years` : `${prefix}Running total of fire-cell-days this month`, {}, 'title'),
      m.ticks.map((t) => s('g', {}, s('line', { class: 'live-grid', x1: m.left, x2: m.left + m.innerW, y1: t.y, y2: t.y }), text(t.text, { class: 'live-tick', x: m.left - 6, y: t.y + 4, 'text-anchor': 'end' }))),
      m.xticks.map((t) => text(t.text, { class: 'live-tick', x: t.x, y: m.bottom + 18, 'text-anchor': t.anchor })),
      m.bandPath ? s('path', { class: 'live-band', d: m.bandPath }) : null,
      m.bandLabel ? text(m.bandLabel.text, { class: 'live-band-label', x: m.bandLabel.x, y: m.bandLabel.y, 'text-anchor': 'middle' }) : null,
      m.medianPath ? s('path', { class: 'live-median', d: m.medianPath }) : null,
      s('path', { class: 'live-line', d: m.linePath }),
      s('path', { class: 'live-tail', d: m.tailPath }),
      circles,
      m.labels.map((l) => text(l.text, { class: `live-label live-label-${l.cls}`, x: l.x, y: l.y })),
      synthetic ? text('SYNTHETIC DATA', { class: 'chart-stamp', x: m.compact ? m.left + 8 : m.left + m.innerW - 8, y: 30, 'text-anchor': m.compact ? 'start' : 'end' }) : null);
    let at = circles.length - 1;
    const go = (k) => {
      if (k === null || k === at) return;
      circles[at].setAttribute('tabindex', '-1');
      at = k;
      circles[at].setAttribute('tabindex', '0');
      circles[at].focus();
    };
    svg.addEventListener('keydown', (ev) => {
      const next = nextPoint(ev.key, at, circles.length);
      if (next === null) return;
      ev.preventDefault();
      go(next);
    });
    svg.addEventListener('focusin', (ev) => {
      const k = Number(ev.target.dataset?.k);
      if (Number.isNaN(k)) return;
      at = k;
      readout.textContent = m.points[k].aria;
    });
    svg.addEventListener('focusout', () => { readout.textContent = m.current?.text ?? ''; });
    readout.textContent = m.current?.text ?? '';
    // The key explains the chart's lines, so it goes with the chart.
    const key = m.key.length ? h('ul', { class: 'live-key' }, m.key.map((k) => h('li', { class: `live-key-${k.cls}`, text: k.text }))) : null;
    const chartBox = h('div', { hidden: tableOn }, svg, readout, key);
    const tableHost = h('div', { class: 'live-table', hidden: !tableOn });
    mountTable(tableHost, { model: liveTableModel(input, { synthetic }) });
    const display = segmented('Display', [{ id: 'chart', label: 'Chart', on: !tableOn }, { id: 'table', label: 'Table', on: tableOn }], (id) => {
      tableOn = id === 'table';
      chartBox.hidden = tableOn;
      tableHost.hidden = !tableOn;
    });
    const card = h('section', { class: 'card live-card', 'aria-labelledby': 'live-title' },
      h('div', { class: 'cal-head' },
        h('div', { class: 'cal-head-text' },
          h('h2', { id: 'live-title' }, `${input.title ?? 'Current season against past years'} `, preview ? tagEl('Preview') : null),
          h('p', { class: 'sub', text: input.sub ?? 'The last 12 months. The band and the median come from earlier years of this area.' })),
        display.el),
      input.disclaimer ? h('p', { class: 'live-disclaimer' }, icon('info'), h('span', { text: input.disclaimer })) : null,
      chartBox,
      tableHost, (input.notes ?? []).map((t) => h('p', { class: 'hint', text: t })), h('p', { class: 'hint', text: m.note }));
    container.replaceChildren(h('div', { class: 'live-view' }, answer, card));
  };
  let current = { input: deps.input, now: deps.now ?? new Date() };
  paint(current);
  // The view is hidden at mount time (zero width) and the window can resize: repaint when the chart width changes.
  const watcher = globalThis.ResizeObserver ? new ResizeObserver(() => {
    const next = plotWidth();
    if (next === width || !container.clientWidth) return;
    width = next;
    paint(current);
  }) : null;
  watcher?.observe(container);
  return {
    update: (next) => { current = { input: next.input ?? current.input, now: next.now ?? new Date() }; paint(current); },
    destroy: () => { watcher?.disconnect(); container.replaceChildren(); },
  };
};
