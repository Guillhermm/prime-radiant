import { formatCount, monthLabel } from '../format.js';
import { mount as mountTable, tableModel } from './data-table.js';
import { h } from './h.js';
import { liveStatus, mount as mountStates } from './states.js';

/**
 * Input contract (expected from core/live.js and pipeline/live.js, M3; not built yet).
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
 *   }
 * Percentiles of the same calendar month (or day) across the baseline years; computed by core.
 */

export const VIEW = { width: 640, height: 320, left: 56, right: 152, top: 16, bottom: 40 };
// Below this width the series labels leave the plot for a key under it, and the viewBox is the
// real pixel width, so the 0.75rem text is not scaled down.
export const COMPACT_BELOW = 640;
const MIN_WIDTH = 280;

export const chartWidth = (px) => (px > 0 && px < COMPACT_BELOW ? Math.max(MIN_WIDTH, Math.round(px)) : VIEW.width);
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

const niceMax = (v) => {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};

/** Integer-only y ticks from 0 to the nice maximum: 0, half and max, dropping halves that are not whole. */
export const niceTicks = (max) => [0, max / 2, max].filter((v, i, a) => Number.isInteger(v) && a.indexOf(v) === i);

/** Runs of consecutive indices where every listed array has a number. */
const runs = (n, ...arrays) => {
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

const validate = ({ live, band }) => {
  if (!live || !Array.isArray(live.values) || !live.start) throw new TypeError('live-view: live must be a Series with start and values');
  if (live.id !== 'live' || live.comparable !== false) throw new RangeError('live-view: the live Series must have id "live" and comparable false');
  for (const k of ['p25', 'median', 'p75']) {
    if (!Array.isArray(band?.[k]) || band[k].length !== live.values.length) throw new RangeError(`live-view: band.${k} must have the same length as live.values`);
  }
};

/**
 * View model. When the data is missing or stale, returns {available: false, state} for
 * states.mount; otherwise geometry in SVG user units plus labels, points and texts.
 */
export const liveModel = ({ fetched_at: fetchedAt = null, live, band, provisional = true, now = new Date(), width = VIEW.width } = {}) => {
  const status = liveStatus(fetchedAt, now);
  if (!status.available) return { available: false, status, state: { kind: 'live-unavailable', fetchedAt, now } };
  validate({ live, band });
  const step = live.step ?? 'month';
  const n = live.values.length;
  const { height, left, top, bottom } = VIEW;
  const compact = width < COMPACT_BELOW;
  const right = compact ? 16 : VIEW.right;
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
  const every = Math.max(1, Math.ceil(n / (compact ? 3 : 6)));
  const xticks = Array.from({ length: n }, (_, i) => i).filter((i) => i === last || (i % every === 0 && last - i > every + 1))
    .map((i) => ({ x: x(i), text: periodLabel(live.start, step, i), anchor: i === last && last % every !== 0 ? 'end' : 'middle' }));

  const labelX = width - right + 8;
  const raw = [];
  const lv = live.values[last];
  const tail = (arr) => arr[last];
  if (typeof lv === 'number') raw.push({ text: 'Current season', cls: 'live', y: y(lv) + 4 });
  if (typeof tail(band.median) === 'number') raw.push({ text: 'Historical median', cls: 'median', y: y(tail(band.median)) + 4 });
  if (typeof tail(band.p75) === 'number') raw.push({ text: 'Middle half of past years', cls: 'band', y: y(tail(band.p75)) + 4 });
  const labels = compact ? [] : spreadLabels(raw).map((l) => ({ ...l, x: labelX }));
  const key = compact ? raw.map(({ text, cls }) => ({ text, cls })) : [];

  const current = typeof lv === 'number'
    ? { label: periodLabel(live.start, step, last), value: lv, provisional, text: `${periodLabel(live.start, step, last)}: ${formatCount(lv)} fire-cell-days so far${provisional ? ', provisional' : ''}` }
    : null;

  return {
    available: true, status, fetchedText: `Fetched ${fetchedAt}`, step, current,
    badge: provisional ? 'Provisional' : null,
    note: 'Live detections are shown on their own. They are never added to the harmonized totals.',
    width, height, left, innerW, bottom: top + innerH,
    linePath, tailPath, medianPath, bandPath, points, ticks, xticks, labels, key,
  };
};

/** Data-table alternative to the chart: one row per period, the live value next to the band. */
export const liveTableModel = ({ live, band, provisional = true }) => {
  validate({ live, band });
  const step = live.step ?? 'month';
  const last = live.values.length - 1;
  // A null live value means no data; a null band value means too few past years to compute it.
  const cell = (v, missing) => (typeof v === 'number' ? formatCount(v) : missing);
  return tableModel({
    caption: 'Current season fire-cell-days against past years',
    corner: step === 'day' ? 'Day' : 'Month',
    columns: ['Current season', 'Historical median', '25th percentile', '75th percentile'],
    rows: live.values.map((v, i) => ({
      header: `${periodLabel(live.start, step, i)}${provisional && i === last ? ' (provisional)' : ''}`,
      cells: [cell(v, 'No data'), cell(band.median[i], 'Not available'), cell(band.p25[i], 'Not available'), cell(band.p75[i], 'Not available')],
    })),
    notes: ['Live detections are never added to the harmonized totals.'],
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

/**
 * mount(container, {input, now}). `input` is the contract above; update(next) takes a new input
 * (same shape, optional `now`). Returns {update, destroy}.
 */
export const mount = (container, deps = {}) => {
  let tableOn = false;
  let width = chartWidth(container.clientWidth);
  const paint = ({ input, now }) => {
    const m = liveModel({ ...input, now, width });
    if (!m.available) {
      const box = h('div', { class: 'live-view' });
      container.replaceChildren(box);
      mountStates(box, {}).show(m.state);
      return;
    }
    const readout = h('p', { class: 'live-readout', 'aria-hidden': 'true' });
    const circles = m.points.map((p, k) => s('circle', {
      class: `live-point${p.provisional ? ' is-provisional' : ''}`, cx: p.x, cy: p.y, r: 5, tabindex: k === m.points.length - 1 ? 0 : -1,
      role: 'img', 'aria-label': p.aria, 'data-k': k,
    }));
    const svg = s('svg', { class: 'live-chart', viewBox: `0 0 ${m.width} ${m.height}`, role: 'group', 'aria-label': 'Current season against the historical band' },
      text('Current season fire-cell-days against the 25th to 75th percentile band and median of past years', {}, 'title'),
      m.ticks.map((t) => s('g', {}, s('line', { class: 'live-grid', x1: m.left, x2: m.left + m.innerW, y1: t.y, y2: t.y }), text(t.text, { class: 'live-tick', x: m.left - 6, y: t.y + 4, 'text-anchor': 'end' }))),
      m.xticks.map((t) => text(t.text, { class: 'live-tick', x: t.x, y: m.bottom + 18, 'text-anchor': t.anchor })),
      s('path', { class: 'live-band', d: m.bandPath }),
      s('path', { class: 'live-median', d: m.medianPath }),
      s('path', { class: 'live-line', d: m.linePath }),
      s('path', { class: 'live-tail', d: m.tailPath }),
      circles,
      m.labels.map((l) => text(l.text, { class: `live-label live-label-${l.cls}`, x: l.x, y: l.y })));
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
    const chartBox = h('div', { hidden: tableOn }, svg, readout);
    const tableHost = h('div', { class: 'live-table', hidden: !tableOn });
    mountTable(tableHost, { model: liveTableModel(input) });
    const toggle = h('button', { type: 'button', class: 'cal-toggle', 'aria-pressed': String(tableOn), text: tableOn ? 'Chart view' : 'Table view' });
    toggle.addEventListener('click', () => {
      tableOn = !tableOn;
      toggle.setAttribute('aria-pressed', String(tableOn));
      toggle.textContent = tableOn ? 'Chart view' : 'Table view';
      chartBox.hidden = tableOn;
      tableHost.hidden = !tableOn;
    });
    container.replaceChildren(h('div', { class: 'live-view' },
      h('div', { class: 'live-head' }, m.badge && h('span', { class: 'badge', text: m.badge }), h('span', { class: 'live-fetched', text: m.fetchedText }), toggle),
      chartBox,
      m.key.length ? h('ul', { class: 'live-key' }, m.key.map((k) => h('li', { class: `live-key-${k.cls}`, text: k.text }))) : null,
      tableHost, h('p', { class: 'hint', text: m.note })));
  };
  let current = { input: deps.input, now: deps.now ?? new Date() };
  paint(current);
  // The view is hidden at mount time (zero width) and the window can resize: repaint when the chart width changes.
  const watcher = globalThis.ResizeObserver ? new ResizeObserver(() => {
    const next = chartWidth(container.clientWidth);
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
