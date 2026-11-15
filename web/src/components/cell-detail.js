import { binClass, density, NODATA } from '../bins.js';
import { caveat } from '../../../core/caveats.js';
import { INSTRUMENT, satelliteSpans } from '../satellites.js';
import { SOURCE_TEXT } from './calendar-grid.js';
import { MONTH_ABBR, MONTH_NAMES, formatCount, formatDensity, monthLabel } from '../format.js';
import { compareToMedian, rankSentence, sameMonth, yearsSpan, ymOf } from '../stats.js';
import { divClass, rankText } from './anomaly-layer.js';
import { isSyntheticManifest } from '../view-data.js';
import { h } from './h.js';
import { icon, mark, svgEl } from './icons.js';
import { trapTab } from './focus-trap.js';
import * as toast from './toast.js';

export const NOT_AVAILABLE = 'not available yet';
export const NO_MEDIAN = 'Not enough history for a median';

// Gate V1 fix F4: estimated values read "scaled to VIIRS-equivalent", not "harmonized".
export const provenanceText = (cell) => {
  if (cell.value === null) return 'No data';
  const base = cell.estimated ? `Estimated, ${SOURCE_TEXT[cell.source?.id] ?? 'scaled to VIIRS-equivalent'}` : 'VIIRS S-NPP, observed';
  return cell.status === 'partial' ? `${base}, partial month` : base;
};

export const LEVEL_TEXT = { aoi: 'this area', tiles: 'the 10° tiles around this area', ring: 'the tiles around this area and the ring beyond', global: 'all the data (Brazil)' };

/** "MODIS × R, R = 2.52 for September": the factor core applied, where it was fit, and its confidence. */
export const estimationText = (cell, ratios = {}) => {
  const f = cell.source?.factor;
  if (!cell.estimated || !f || typeof f.value !== 'number') return cell.estimated ? 'Estimated: scaled to VIIRS-equivalent.' : null;
  const r = ratios[f.name];
  const what = f.name === 'R' ? 'MODIS × R' : 'NOAA-20 × K';
  const parts = [`Estimated: ${what}, ${f.name} = ${f.value.toFixed(2)}${r?.perMonth ? ` for ${MONTH_NAMES[cell.month - 1]}` : ''}.`];
  if (r?.level && r.level !== 'aoi') parts.push(`${f.name} comes from ${LEVEL_TEXT[r.level]}: this area has too few detections.`);
  if (r && r.usable === false) parts.push(`${f.name} failed the usability rule at every level: low confidence.`);
  return parts.join(' ');
};

/** Why a month has no value: core's flag, else the sensors were off. */
export const noDataNote = (cell, { manifest = null, ratios = {} } = {}) => {
  const flags = cell.flags ?? [];
  if (flags.includes('outside-domain')) return 'This area lies outside the data domain (Brazil). There is no data here, not zero.';
  if (flags.includes('terra-only')) return 'Only MODIS Terra flew before July 2002. Its counts are not scaled, so there is no value. This is not zero.';
  const ym = ymOf(cell.year, cell.month);
  const inside = (c) => Array.isArray(c) && ym >= c[0] && ym <= c[1];
  if (inside(manifest?.coverage?.modis) && !inside(manifest?.coverage?.viirs) && typeof ratios.R?.value !== 'number') {
    return 'Only MODIS flew, and MODIS saw no fire here in the months both sensors flew, so R cannot scale it. This is not zero.';
  }
  return 'The sensors were not operating this month. This is not zero.';
};

export const PARTIAL_NOTE = 'Partial month: a satellite missed days (outage), so this count is low. It is not filled from the other satellite.';

/** Core caveats for one cell: an item per flag the cell carries, then the area-wide caveats. */
export const cellCaveats = (cell, areaCaveats = []) => {
  const flags = [...(cell.estimated ? ['estimated'] : []), ...(cell.flags ?? [])];
  const items = flags.map((id) => { try { return caveat(id); } catch { return null; } }).filter(Boolean);
  return [...items, ...areaCaveats.filter((c) => c.kind === 'caveat')];
};

const ym = (s) => `${MONTH_ABBR[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

/** Satellites flying in month `when` ("YYYY-MM"), per family, from the manifest; nothing invented. */
export const satellitesInOrbit = (manifest, when) => {
  const out = [];
  for (const s of satelliteSpans(manifest).filter((x) => x.from <= when && when <= x.to)) {
    const family = s.family === 'noaa20' ? 'viirs' : s.family;
    const row = out.find((r) => r.family === family) ?? out[out.push({ family, label: INSTRUMENT[family], names: [] }) - 1];
    row.names.push(`${s.name} since ${ym(s.from)}`);
  }
  return out.map(({ names, ...r }) => ({ ...r, text: names.join(', ') }));
};

export const STRIP = { width: 360, height: 112, top: 18 };

/**
 * Bars for the same month in every year of the range, oldest first, the selected year marked and
 * the cell's median as a dashed line. Missing years get no bar.
 */
export const barStripModel = (list, cell, median) => {
  const { width: W, height: H, top } = STRIP;
  const values = list.map((c) => c.value).filter((v) => v !== null);
  const max = Math.max(1, ...values, typeof median === 'number' ? median : 0);
  const bw = list.length ? W / list.length : W;
  const y = (v) => H - (v / max) * (H - top);
  const bars = list.map((c, i) => ({
    year: c.year, value: c.value, rank: c.rank ?? null, selected: c.year === cell.year,
    x: i * bw + 1.5, w: Math.max(1, bw - 3), y: c.value === null ? H : y(c.value), h: c.value === null ? 0 : H - y(c.value),
  }));
  const years = list.map((c) => c.year);
  const ticks = bars.filter((b, i) => i === 0 || i === bars.length - 1 || (b.year % 10 === 0 && b.year - years[0] > 2 && years[years.length - 1] - b.year > 2))
    .map((b) => ({ year: b.year, x: b.x + b.w / 2 }));
  const med = typeof median === 'number' ? { value: median, y: y(median) } : null;
  const sel = bars.find((b) => b.selected && b.value !== null);
  const value = sel ? valueLabel(sel, med?.y ?? null, W) : null;
  // The median's own label goes to the side away from the selected value, so the two never overlap.
  if (med) Object.assign(med, value && value.x < W / 2 ? { labelX: W - 2, anchor: 'end' } : { labelX: 2, anchor: 'start' }, { labelY: Math.max(9, med.y - 5) });
  return { width: W, height: H, bars, ticks, median: med, value };
};

// Viewbox units render at about 1px: 4 = 0.25rem gap, 6 = 0.375rem clearance from the median line.
const LABEL = { gap: 4, clear: 6, ascent: 8, descent: 2, minY: 10 };

/**
 * Baseline of the selected bar's value: 0.25rem above the higher of the bar top and the median
 * line, never within 0.375rem of the line; below the line when there is no room above.
 */
export const valueLabelY = (barY, medianY, l = LABEL) => {
  if (medianY === null) return Math.max(l.minY, barY - l.gap);
  const above = Math.min(barY - l.gap, medianY - l.clear - l.descent);
  return above >= l.minY ? above : medianY + l.clear + l.ascent;
};

/**
 * Where the selected bar's value goes: centered above when there is room, centered between the
 * line and the bar when that gap fits it, otherwise beside the bar (toward the wider side) just
 * under the line, so it never sits on the bar or the line. {x, y, anchor}.
 */
export const valueLabel = (bar, medianY, width, l = LABEL) => {
  const center = bar.x + bar.w / 2;
  const y = valueLabelY(bar.y, medianY, l);
  if (medianY === null || y < medianY || y + l.descent + l.gap <= bar.y) return { x: center, y, anchor: 'middle' };
  const right = center < width / 2;
  return { x: right ? bar.x + bar.w + l.gap : bar.x - l.gap, y, anchor: right ? 'start' : 'end' };
};

/** "vs the median of the 23 earlier Septembers (2001–2023)": names the years, so two medians on one screen read apart. */
export const medianLead = (name, w) => {
  if (!w) return `vs the median of earlier ${name}s`;
  if (w.count === 1) return `vs the only earlier ${name} (${w.from})`;
  return `vs the median of the ${w.count} earlier ${name}s (${w.from}–${w.to})`;
};

const stripLabel = (cell, strip, rank) => {
  const name = MONTH_NAMES[cell.month - 1];
  const first = strip.bars[0]?.year;
  const last = strip.bars[strip.bars.length - 1]?.year;
  const parts = [`${name} in every year, ${first} to ${last}.`, `${cell.year}: ${cell.value === null ? 'no data' : formatCount(cell.value)}.`];
  if (strip.median) parts.push(`Median of earlier years ${formatCount(strip.median.value)}.`);
  if (rank) parts.push(`${rank}.`);
  return parts.join(' ');
};

/**
 * View model of the selection panel. `cells` is the range on screen (for the per-month bars and the
 * rank), `allCells` the whole record (for the years behind core's median). Optional cell fields
 * (`median`, `r`) are shown only when present: nothing is computed or guessed here.
 */
// The sheet covers the top bar on phone, so the panel carries the synthetic label itself.
export const panelEyebrow = (manifest) => (isSyntheticManifest(manifest) ? 'Selected month · Synthetic data' : 'Selected month');

export const detailModel = (cell, { aoiCells, layer = 'counts', cells = [cell], manifest = null, caveats = [], ratios = {} }) => {
  const title = monthLabel(cell.year, cell.month);
  const list = cellCaveats(cell, caveats);
  const satellites = satellitesInOrbit(manifest, ymOf(cell.year, cell.month));
  const eyebrow = panelEyebrow(manifest);
  if (cell.value === null) {
    return { title, eyebrow, noData: true, value: 'No data', note: noDataNote(cell, { manifest, ratios }), bin: NODATA, provenance: 'No data', compare: null, strip: null, rank: null, satellites, estimation: null, partial: null, extra: [], caveats: list };
  }
  const d = density(cell.value, aoiCells);
  const same = sameMonth(cells, cell);
  const rank = rankSentence(same, cell.month);
  const name = MONTH_NAMES[cell.month - 1];
  const cmp = compareToMedian(cell.value, cell.median);
  const compare = cmp && {
    ...cmp,
    lead: medianLead(name, yearsSpan(cell.medianYears)),
    median: formatCount(cell.median),
  };
  const estimation = estimationText(cell, ratios);
  const extra = [];
  if (layer === 'anomaly') {
    const ranked = typeof cell.rank === 'number';
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    extra.push({ label: 'Percentile rank', value: cap(rankText(cell.rank)) }, { label: 'Flagged', value: ranked ? (cell.flagged ? 'Yes, unusual for this month' : 'No') : NOT_AVAILABLE });
  }
  const strip = barStripModel(same.list, cell, cell.median);
  const next = same.order.find((c) => c.year !== cell.year);
  let rankNote = rank ? `${rank}.` : null;
  if (rank && next) rankNote += same.rank === 1 ? ` Next: ${next.year} with ${formatCount(next.value)}.` : ` Busiest: ${same.order[0].year} with ${formatCount(same.order[0].value)}.`;
  return {
    title,
    eyebrow,
    noData: false,
    value: formatCount(cell.value),
    unit: 'fire-cell-days',
    bin: binClass(cell.value, aoiCells),
    density: d === null ? null : `${formatDensity(d)} per 1,000 cells`,
    provenance: provenanceText(cell),
    compare,
    noMedian: compare ? null : NO_MEDIAN,
    layer,
    stripTitle: `Every ${name}, ${strip.bars[0]?.year}–${strip.bars[strip.bars.length - 1]?.year}`,
    strip,
    stripLabel: stripLabel(cell, strip, rank),
    rank: rankNote,
    satellites,
    estimation,
    partial: cell.status === 'partial' ? PARTIAL_NOTE : null,
    extra,
    caveats: list,
  };
};

const SHEET_GAP = 16;

/**
 * Pixels to scroll the page so the tapped cell ends above a bottom sheet (WCAG 2.4.11, focus not
 * obscured). Positive scrolls down. A cell taller than the free space keeps its top on screen.
 */
export const scrollForSheet = ({ cellTop, cellBottom, sheetTop }, gap = SHEET_GAP) => {
  const over = cellBottom - (sheetTop - gap);
  if (over <= 0) return 0;
  return Math.min(over, Math.max(0, cellTop - gap));
};

const STEP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'];

const f1 = (n) => Number(n.toFixed(1));
const stripSvg = (m) => {
  const s = m.strip;
  const svg = svgEl('svg', { class: 'bar-strip', viewBox: `0 0 ${s.width} ${s.height + 18}`, role: 'img', 'aria-label': m.stripLabel });
  for (const b of s.bars) {
    if (b.value === null) continue;
    // On the anomaly layer each bar takes its month's diverging class, as in the grid.
    const div = m.layer === 'anomaly' && typeof b.rank === 'number' ? ` bs-div rd-${divClass(b.rank)}` : '';
    svg.append(svgEl('rect', { x: f1(b.x), y: f1(b.y), width: f1(b.w), height: f1(Math.max(b.h, 1)), rx: 2, class: `bs-bar${div}${b.selected ? ' is-sel' : ''}` }));
    if (b.selected) {
      const t = svgEl('text', { x: f1(s.value.x), y: f1(s.value.y), 'text-anchor': s.value.anchor, class: 'bs-value' });
      t.textContent = formatCount(b.value);
      svg.append(t);
    }
  }
  for (const tk of s.ticks) {
    const t = svgEl('text', { x: f1(tk.x), y: s.height + 14, 'text-anchor': 'middle', class: 'bs-tick' });
    t.textContent = String(tk.year);
    svg.append(t);
  }
  if (s.median) {
    svg.append(svgEl('line', { x1: 0, x2: s.width, y1: f1(s.median.y), y2: f1(s.median.y), class: 'bs-median' }));
    const t = svgEl('text', { x: f1(s.median.labelX), y: f1(s.median.labelY), 'text-anchor': s.median.anchor, class: 'bs-median-label' });
    t.textContent = `median of earlier years ${formatCount(s.median.value)}`;
    svg.append(t);
  }
  return svg;
};

/** Panel content; nodes are direct children so the rise animation can stagger them. */
const content = (m, { onClose, onCopy, onTable, sheet }) => {
  const heading = h('h2', { class: 'panel-title', id: 'panel-title', tabindex: '-1', text: m.title });
  const nodes = [
    h('div', { class: 'panel-top' }, h('span', { class: 'eyebrow', text: m.eyebrow }),
      h('button', { type: 'button', class: 'icon-btn panel-close', 'aria-label': 'Close selected month', onclick: () => onClose() }, icon('close'))),
    heading,
    h('div', { class: 'panel-value' }, h('span', { class: `cellchip bin-${m.bin}`, 'aria-hidden': 'true' }),
      h('span', { class: 'panel-num', text: m.value }), m.unit && h('span', { class: 'panel-unit', text: m.unit })),
  ];
  if (m.noData) {
    nodes.push(h('p', { class: 'panel-note', text: m.note }));
  } else {
    nodes.push(h('div', { class: 'meta-row' },
      m.density && h('span', { class: 'meta', text: m.density }),
      h('span', { class: 'meta' }, mark('mark mark-xs'), m.provenance)));
    nodes.push(m.compare
      ? h('div', { class: `cmp cmp-${m.compare.dir}` },
        h('span', { class: 'cmp-x' }, m.compare.text, ' ', h('span', { class: 'tag', text: 'Preview' })),
        h('span', { class: 'cmp-t' }, m.compare.lead, h('small', { text: `median ${m.compare.median}` })))
      : h('p', { class: 'cmp cmp-none', text: m.noMedian }));
    nodes.push(h('div', { class: 'sect' }, h('span', { class: 'eyebrow', text: m.stripTitle })), h('div', { class: 'bars' }, stripSvg(m)));
    if (m.rank) nodes.push(h('p', { class: 'panel-note' }, m.rank, ' ', h('span', { class: 'tag', text: 'Preview' })));
    if (m.extra.length) nodes.push(h('dl', { class: 'detail-list' }, m.extra.map((r) => h('div', { class: 'detail-row' }, h('dt', { text: r.label }), h('dd', { text: r.value })))));
  }
  if (m.satellites.length && !sheet) {
    nodes.push(h('div', { class: 'sect' }, h('span', { class: 'eyebrow', text: 'Satellites in orbit' })),
      h('div', { class: 'sats' }, m.satellites.map((s) => h('div', { class: `sat sat-${s.family}` }, h('b', {}, h('i', { 'aria-hidden': 'true' }), s.label), h('span', { text: s.text })))));
  }
  if (m.partial) nodes.push(h('p', { class: 'panel-note panel-partial', text: m.partial }));
  if (m.estimation) nodes.push(h('p', { class: 'panel-note', text: m.estimation }));
  nodes.push(h('details', { class: 'panel-caveats' }, h('summary', { text: `Caveats (${m.caveats.length})` }),
    h('ul', {}, m.caveats.map((c) => h('li', {}, h('strong', { text: `${c.short} ` }), c.long)))));
  // Copy link on both widths: on phone the sheet is the only place that offers it.
  nodes.push(h('div', { class: 'panel-actions' },
    h('button', { type: 'button', class: 'btn panel-copy', onclick: () => onCopy() }, icon('link'), 'Copy link'),
    !m.noData && !sheet && h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => onTable() }, icon('table'), 'Show in table')));
  if (!sheet) {
    nodes.push(h('p', { class: 'kbd-row', 'aria-hidden': 'true' }, ['←', '→', '↑', '↓'].map((k) => h('kbd', { text: k })), ' move between months ', h('kbd', { text: 'Esc' }), ' close'));
  }
  return { nodes, heading };
};

/**
 * mount(container, {aoiCells, context(), onClose(), onStep(key), onShowTable(cell), isSheet()}).
 * Desktop: a docked, non-modal region; focus stays where it is (the grid) and arrow keys there
 * move the selection. Phone and tablet (`isSheet()`): a modal bottom sheet with a scrim, focus on
 * its title, Tab trapped, Escape and Back close it. `open` while open updates in place.
 */
export const mount = (container, deps) => {
  let aoiCells = deps.aoiCells;
  let opener = null;
  let isOpen = false;
  let sheet = false;
  let pushed = false;
  let current = null;
  const isSheet = deps.isSheet ?? (() => Boolean(globalThis.matchMedia?.('(max-width: 63.99rem)').matches));
  const root = document.documentElement;

  const clearSheet = (cell) => {
    if (!sheet) return;
    const panel = container.querySelector('.panel');
    if (!cell?.isConnected || !panel) return;
    // Layout height, not the box: the slide-in transform would put the sheet below the screen.
    const r = cell.getBoundingClientRect();
    const by = scrollForSheet({ cellTop: r.top, cellBottom: r.bottom, sheetTop: window.innerHeight - panel.offsetHeight });
    if (by) window.scrollBy(0, by);
  };

  const onPop = () => { if (isOpen && sheet) { pushed = false; close(); } };
  const onKey = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    if (sheet) {
      if (STEP_KEYS.includes(ev.key) && !ev.target.closest?.('summary')) { ev.preventDefault(); deps.onStep?.(ev.key); return; }
      trapTab(ev, container.querySelector('.panel'));
    }
  };

  const close = ({ restore = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    const hadFocus = container.contains(document.activeElement);
    container.replaceChildren();
    container.classList.remove('is-open', 'is-sheet');
    root.classList.remove('sheet-open');
    window.removeEventListener('popstate', onPop);
    if (pushed && history.state?.prSheet) history.back();
    pushed = false;
    if (restore && (hadFocus || sheet) && opener?.isConnected) opener.focus();
    opener = null;
    current = null;
    deps.onClose?.();
  };

  const notify = deps.notify ?? toast.show;
  const copy = async () => {
    try {
      await (deps.copy ?? ((t) => navigator.clipboard.writeText(t)))(location.href);
      notify('Link copied');
    } catch {
      notify('Could not copy. The address bar has the link.', { kind: 'error' });
    }
  };

  const render = (cell, layer, { fresh }) => {
    const ctx = deps.context?.() ?? {};
    const m = detailModel(cell, { aoiCells, layer, ...ctx });
    const { nodes, heading } = content(m, { onClose: () => close(), onCopy: copy, onTable: () => deps.onShowTable?.(cell), sheet });
    const panel = h('div', {
      class: `panel${fresh ? ' is-entering' : ' is-swapping'}`,
      ...(sheet ? { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'panel-title' } : { role: 'region', 'aria-label': 'Selected month' }),
    }, sheet && h('div', { class: 'grabber', 'aria-hidden': 'true' }), nodes);
    panel.addEventListener('keydown', onKey);
    const scrim = sheet ? h('div', { class: 'scrim', 'aria-hidden': 'true', onclick: () => close() }) : null;
    const keepFocus = container.contains(document.activeElement) && document.activeElement.closest('.panel-close');
    container.replaceChildren(...[scrim, panel].filter(Boolean));
    if (sheet) heading.focus({ preventScroll: true });
    else if (keepFocus) panel.querySelector('.panel-close').focus();
  };

  const open = (cell, { layer } = {}) => {
    const fresh = !isOpen;
    if (fresh) {
      sheet = isSheet();
      opener = container.contains(document.activeElement) ? opener : document.activeElement;
      isOpen = true;
      container.classList.add('is-open');
      container.classList.toggle('is-sheet', sheet);
      root.classList.toggle('sheet-open', sheet);
      if (sheet) {
        history.pushState({ ...(history.state ?? {}), prSheet: true }, '');
        pushed = true;
        window.addEventListener('popstate', onPop);
      }
    }
    current = { cell, layer };
    render(cell, layer, { fresh });
    if (fresh) clearSheet(opener);
  };

  return {
    open,
    close,
    update: (next) => {
      aoiCells = next.aoiCells ?? aoiCells;
      if (isOpen && current) render(current.cell, current.layer, { fresh: false });
    },
    isOpen: () => isOpen,
    destroy: () => close({ restore: false }),
  };
};
