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
export const radiantModel = (cells, { aoiCells, labels = true, compact = false } = {}) => {
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
    slices.push({ year: c.year, month: c.month, ring, d: sectorPath(ri, ro, a0, a1), bin, cell: c });
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

export const radiantLabel = (years) => (years.length
  ? `Calendar overview: rings are years from ${years[0]} inside to ${years[years.length - 1]} on the rim, slices are months. Same data as the grid below.`
  : 'Calendar overview: no data in range.');

/**
 * mount(container, {cells, aoiCells, labels, compact, onHover(cell|null), onSelect(cell), tooltip(cell)}).
 * Returns {update(next), select({year, month}|null), destroy()}.
 */
export const mount = (container, deps) => {
  let d = { labels: true, ...deps };
  let model = null;
  let selected = null;
  const svg = svgEl('svg', { class: 'radiant', role: 'img' });
  const tip = document.createElement('div');
  tip.className = 'radiant-tip';
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  const wrap = document.createElement('div');
  wrap.className = 'radiant-wrap';
  wrap.append(svg, tip);
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

  const build = () => {
    model = radiantModel(d.cells, d);
    byKey.clear();
    svg.setAttribute('viewBox', model.viewBox);
    svg.setAttribute('aria-label', radiantLabel(model.years));
    const slices = svgEl('g', { class: 'rad-slices' });
    for (const s of model.slices) {
      const p = svgEl('path', { d: s.d, class: `rb rb-${s.bin}`, 'data-key': keyOf(s.year, s.month) });
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

  const sliceAt = (target) => byKey.get(target?.closest?.('[data-key]')?.dataset.key);
  svg.addEventListener('pointerover', (ev) => {
    const s = sliceAt(ev.target);
    if (!s) return;
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
    if (s) d.onSelect?.(s.cell);
  });

  build();
  return {
    update: (next) => { d = { ...d, ...next }; build(); },
    select: (sel) => { selected = sel; paintSelection(); },
    destroy: () => container.replaceChildren(),
  };
};
