import { binClass, NODATA } from '../bins.js';
import { MONTH_NAMES } from '../format.js';
import { svgEl } from './icons.js';

// The Radiant: a polar calendar. Rings are years (oldest at the center), slices are months with
// January starting at 12 o'clock and running clockwise. It is an overview glyph, never the
// reading surface: it carries no number of its own and the grid stays the keyboard path.
export const RADIANT = { inner: 27, outer: 96, hairline: 0.18, gap: 0.01, labelGap: 8 };
// Below about 10rem the hairlines and spoke gaps alias into moire, so the small Radiant drops them.
export const COMPACT = { hairline: 0, gap: 0.004 };

const TAU = Math.PI * 2;
const f2 = (n) => Number(n.toFixed(2));

/**
 * Start and end angle (radians, 0 = 3 o'clock, clockwise in SVG) of month 1..12. `gap` is the
 * whole gap at a month boundary, so each side gives up half of it.
 */
export const monthAngles = (month, gap = RADIANT.gap) => {
  const a0 = -Math.PI / 2 + ((month - 1) * TAU) / 12;
  return [a0 + gap / 2, a0 + TAU / 12 - gap / 2];
};

const pt = (r, a) => [f2(r * Math.cos(a)), f2(r * Math.sin(a))];

/** Closed annular sector between radii ri < ro and angles a0 < a1 (less than half a turn). */
export const sectorPath = (ri, ro, a0, a1) => {
  const [x0, y0] = pt(ro, a0);
  const [x1, y1] = pt(ro, a1);
  const [x2, y2] = pt(ri, a1);
  const [x3, y3] = pt(ri, a0);
  return `M${x0} ${y0}A${f2(ro)} ${f2(ro)} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${f2(ri)} ${f2(ri)} 0 0 0 ${x3} ${y3}Z`;
};

/** Inner and outer radius of ring `i` of `n`, hairline removed on both sides. */
export const ringRadii = (i, n, { inner, outer, hairline } = RADIANT) => {
  const t = (outer - inner) / n;
  return [inner + i * t + hairline, inner + (i + 1) * t - hairline];
};

/**
 * Geometry for the cells in range. Months without data (value null) draw nothing.
 * @returns {{years: number[], slices: {year, month, ring, d, bin, cell}[], labels: {text, x, y}[], viewBox: string}}
 */
export const radiantModel = (cells, { aoiCells, labels = true, compact = false, classOf = null } = {}) => {
  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  const { hairline, gap } = compact ? COMPACT : RADIANT;
  const slices = [];
  for (const c of cells) {
    if (c.value === null) continue;
    const ring = years.indexOf(c.year);
    const [ri, ro] = ringRadii(ring, years.length, { ...RADIANT, hairline });
    const [a0, a1] = monthAngles(c.month, gap);
    const bin = binClass(c.value, aoiCells);
    if (bin === NODATA) continue;
    slices.push({ year: c.year, month: c.month, ring, d: sectorPath(ri, ro, a0, a1), bin, cls: classOf ? classOf(c) : `rb rb-${bin}`, cell: c });
  }
  const r = RADIANT.outer + RADIANT.labelGap + (labels === 'abbr' ? 4 : 0);
  const labelList = labels ? MONTH_NAMES.map((name, i) => {
    const [a0, a1] = monthAngles(i + 1, 0);
    const [x, y] = pt(r, (a0 + a1) / 2);
    return { text: labels === 'abbr' ? name.slice(0, 3) : name[0], x, y };
  }) : [];
  const pad = RADIANT.outer + (labels === 'abbr' ? 24 : labels ? 14 : 3);
  return { years, slices, labels: labelList, viewBox: `${-pad} ${-pad} ${2 * pad} ${2 * pad}` };
};

/** Outline of the selected cell and a dashed spoke over its month; null when the year is not drawn. */
export const selectionShape = (years, { year, month }) => {
  const ring = years.indexOf(year);
  if (ring < 0) return null;
  const [ri, ro] = ringRadii(ring, years.length);
  const [a0, a1] = monthAngles(month, 0);
  return {
    cell: sectorPath(Math.max(1, ri - 0.6), ro + 0.6, a0 - 0.01, a1 + 0.01),
    spoke: sectorPath(RADIANT.inner - 1, RADIANT.outer + 1, a0, a1),
  };
};

/**
 * Cells for the placeholder drawn before data: every month of the record (months as "YYYY-MM"),
 * value 0, so the rings and slices have their final geometry while the tiles load.
 */
export const placeholderCells = ({ from, to }) => {
  const cells = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    cells.push({ year: y, month: m, value: 0 });
    if (++m > 12) { m = 1; y += 1; }
  }
  return cells;
};
export const PLACEHOLDER_CLASS = 'rb rb-ph';

/**
 * Keyboard step over the drawn slices: Right and Left go to the next and previous month in time
 * (across years), Up and Down to the same month one ring out (newer) or in (older), Home and End to
 * the first and last slice. Months with no slice are skipped; at the edge the focus stays. Returns
 * {year, month}, or null when the key is not a Radiant key.
 */
export const stepSlice = (slices, cur, key) => {
  if (!slices.length) return null;
  const has = new Set(slices.map((s) => s.year * 12 + s.month - 1));
  const idx = [...has].sort((a, b) => a - b);
  const at = (i) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  if (key === 'Home') return at(idx[0]);
  if (key === 'End') return at(idx[idx.length - 1]);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: 12, ArrowDown: -12 }[key];
  if (!step) return null;
  if (!cur) return at(idx[idx.length - 1]);
  const lo = idx[0];
  const hi = idx[idx.length - 1];
  for (let i = cur.year * 12 + cur.month - 1 + step; i >= lo && i <= hi; i += step) {
    if (has.has(i)) return at(i);
  }
  return cur;
};

export const radiantLabel = (years) => (years.length
  ? `Calendar overview: rings are years from ${years[0]} inside to ${years[years.length - 1]} on the rim, slices are months. Same data as the grid below.`
  : 'Calendar overview: no data in range.');

/**
 * mount(container, {cells, aoiCells, labels, compact, onHover(cell|null), onSelect(cell), tooltip(cell),
 * keyboard: {label, sliceLabel(cell)}}). With `keyboard` the Radiant is one tab stop: arrows move a
 * focus ring (stepSlice), Enter or Space calls onSelect, each move is read from a polite live region,
 * and every slice carries its own accessible name. With `placeholder: true` every slice is drawn in
 * the neutral placeholder class and the figure is aria-busy. Returns {update(next), reveal(next),
 * select({year, month}|null), destroy()}: reveal() swaps in real data on the same slices, so CSS can
 * fade the colors, and falls back to update() when the rings differ.
 */
export const mount = (container, deps) => {
  let d = { labels: true, ...deps };
  let model = null;
  let selected = null;
  const kb = d.keyboard;
  const svg = svgEl('svg', kb ? { class: 'radiant is-interactive', role: 'group', tabindex: '0', 'aria-roledescription': 'calendar overview' } : { class: 'radiant', role: 'img' });
  const live = kb ? document.createElement('p') : null;
  if (live) { live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); }
  const tip = document.createElement('div');
  tip.className = 'radiant-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  const wrap = document.createElement('div');
  wrap.className = 'radiant-wrap';
  wrap.append(svg, tip, ...(live ? [live] : []));
  container.replaceChildren(wrap);

  const byKey = new Map();
  const keyOf = (y, m) => `${y}-${m}`;
  let selLayer = null;

  const paintSelection = () => {
    selLayer.replaceChildren();
    const s = selected && selectionShape(model.years, selected);
    if (!s) return;
    // The ground underlay keeps the focus outline visible on yellow cells in dark.
    selLayer.append(svgEl('path', { d: s.spoke, class: 'rad-spoke' }), svgEl('path', { d: s.cell, class: 'rad-sel-ground' }), svgEl('path', { d: s.cell, class: 'rad-sel' }));
  };

  const opts = () => (d.placeholder ? { ...d, aoiCells: 1, classOf: () => PLACEHOLDER_CLASS } : d);
  const paintBusy = () => {
    if (d.placeholder) svg.setAttribute('aria-busy', 'true');
    else svg.removeAttribute('aria-busy');
    svg.setAttribute('aria-label', kb ? d.keyboard.label : radiantLabel(model.years));
  };
  // Per-slice name and ring index (the CSS stagger reads --ring through CSSOM, which the CSP allows).
  const dress = (p, s) => {
    p.setAttribute('class', s.cls);
    p.style.setProperty('--ring', String(s.ring));
    if (kb && !d.placeholder) { p.setAttribute('role', 'img'); p.setAttribute('aria-label', d.keyboard.sliceLabel(s.cell)); }
  };
  let slicesG = null;
  const build = () => {
    model = radiantModel(d.cells, opts());
    byKey.clear();
    svg.setAttribute('viewBox', model.viewBox);
    paintBusy();
    const slices = svgEl('g', { class: 'rad-slices' });
    slicesG = slices;
    for (const s of model.slices) {
      const p = svgEl('path', { d: s.d, 'data-key': keyOf(s.year, s.month) });
      dress(p, s);
      byKey.set(keyOf(s.year, s.month), s);
      slices.append(p);
    }
    const labels = svgEl('g', { class: `rad-labels${d.labels === 'abbr' ? ' is-abbr' : ''}`, 'aria-hidden': 'true' });
    for (const l of model.labels) {
      const t = svgEl('text', { x: l.x, y: l.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = l.text;
      labels.append(t);
    }
    selLayer = svgEl('g', { class: 'rad-selection', 'aria-hidden': 'true' });
    const r = RADIANT.inner - 2.5;
    const fh = RADIANT.inner * 1.05;
    const fw = (fh * 276) / 404;
    const center = svgEl('g', { class: 'rad-center', 'aria-hidden': 'true' });
    center.append(svgEl('circle', { r }), svgEl('image', { href: 'icons/mark.svg', x: f2(-fw / 2), y: f2(-fh * 0.56), width: f2(fw), height: f2(fh) }));
    svg.replaceChildren(slices, selLayer, labels, center);
    paintSelection();
  };

  const reveal = (next) => {
    const prev = model;
    d = { ...d, ...next };
    const m = radiantModel(d.cells, opts());
    if (prev.years.join() !== m.years.join()) { build(); return; }
    model = m;
    const fresh = new Map(m.slices.map((s) => [keyOf(s.year, s.month), s]));
    for (const p of [...slicesG.children]) {
      const s = fresh.get(p.dataset.key);
      // A month the data leaves empty fades out instead of keeping the placeholder color.
      if (s) dress(p, s);
      else p.setAttribute('class', 'rb rb-gone');
    }
    for (const [k, s] of fresh) {
      if (byKey.has(k)) continue;
      const p = svgEl('path', { d: s.d, 'data-key': k });
      dress(p, s);
      slicesG.append(p);
    }
    byKey.clear();
    fresh.forEach((s, k) => byKey.set(k, s));
    paintBusy();
  };

  const sliceAt = (target) => byKey.get(target?.closest?.('[data-key]')?.dataset.key);
  if (kb) {
    let focusSel = null;
    const show = (sel) => {
      focusSel = sel;
      selected = sel;
      paintSelection();
      const s = sel && byKey.get(keyOf(sel.year, sel.month));
      if (s) live.textContent = d.keyboard.sliceLabel(s.cell);
    };
    svg.addEventListener('keydown', (ev) => {
      if (d.placeholder) return;
      if ((ev.key === 'Enter' || ev.key === ' ') && focusSel) {
        ev.preventDefault();
        const s = byKey.get(keyOf(focusSel.year, focusSel.month));
        if (s) d.onSelect?.(s.cell);
        return;
      }
      const next = stepSlice(model.slices, focusSel, ev.key);
      if (!next) return;
      ev.preventDefault();
      show(next);
    });
    // A click also focuses the figure: the ring only appears for keyboard focus.
    svg.addEventListener('focus', () => { if (!d.placeholder && !focusSel && svg.matches(':focus-visible')) show(stepSlice(model.slices, null, 'End')); });
    svg.addEventListener('blur', () => { selected = null; focusSel = null; paintSelection(); });
  }
  svg.addEventListener('pointerover', (ev) => {
    const s = sliceAt(ev.target);
    if (!s || d.placeholder) return;
    tip.textContent = d.tooltip ? d.tooltip(s.cell) : `${MONTH_NAMES[s.month - 1].slice(0, 3)} ${s.year}`;
    const box = wrap.getBoundingClientRect();
    tip.style.setProperty('--x', `${ev.clientX - box.left}px`);
    tip.style.setProperty('--y', `${ev.clientY - box.top}px`);
    tip.hidden = false;
    d.onHover?.(s.cell);
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; d.onHover?.(null); });
  svg.addEventListener('click', (ev) => {
    const s = sliceAt(ev.target);
    if (s && !d.placeholder) d.onSelect?.(s.cell);
  });

  build();
  return {
    update: (next) => { d = { ...d, ...next }; build(); },
    reveal,
    select: (sel) => { selected = sel; paintSelection(); },
    destroy: () => container.replaceChildren(),
  };
};
