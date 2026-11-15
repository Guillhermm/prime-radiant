import { UNIT_SENTENCE } from './legend.js';
import { caveat, catalog } from '../../../core/caveats.js';
import { HARMONIZE_METHOD } from '../../../core/harmonize.js';
import { INSTRUMENT, satelliteSpans } from '../satellites.js';
import { MONTH_ABBR } from '../format.js';
import { syntheticModel } from './synthetic-band.js';
import { h } from './h.js';
import { icon, mark, svgEl } from './icons.js';
import { trapTab } from './focus-trap.js';

// Acknowledgment wording is FIRMS' standard text; the manifest does not carry it yet.
export const LANCE_ACKNOWLEDGMENT = "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).";

const FAMILY_LABEL = { modis: 'MODIS', viirs: 'VIIRS S-NPP', noaa20: 'VIIRS NOAA-20' };

/** Status line: core's gate map says whether the method passed the science gate. */
export const statusText = (gates) => (caveat('not-validated', gates).preliminary
  ? 'Status: preliminary. The method has not passed the science review yet.'
  : 'Status: validated by the science team (gate V1, November 2026), with the caveats below. Near-real-time data is not validated yet.');

/** Drawer content from the manifest; any missing manifest field is skipped, never invented. */
export const methodModel = (manifest, { gates } = {}) => {
  manifest ??= {};
  const sats = satelliteSpans(manifest);
  const sensors = [];
  for (const [family, span] of Object.entries(manifest.coverage ?? {})) {
    if (!Array.isArray(span)) continue;
    const names = sats.filter((s) => s.family === family).map((s) => `${s.name} from ${s.from}`).join(', ');
    sensors.push({ label: FAMILY_LABEL[family] ?? family.toUpperCase(), text: `${span[0]} to ${span[1]}${names ? ` (${names})` : ''}` });
  }
  return {
    title: 'Method',
    preliminary: caveat('not-validated', gates).preliminary,
    status: statusText(gates),
    method: `${HARMONIZE_METHOD.id}, version ${HARMONIZE_METHOD.version}`,
    unit: `Unit: fire-cell-day, one grid cell with at least one detection on one UTC day. ${UNIT_SENTENCE}`,
    summary: 'The harmonized series is VIIRS S-NPP where it operates and MODIS scaled to VIIRS-equivalent by a ratio R elsewhere, marked estimated. After S-NPP, NOAA-20 scaled by a ratio K continues it.',
    grid: 'Assumption: detections are binned into a 0.1 degree grid (about 11 km at the equator), coarser than either sensor pixel at nadir.',
    sensors,
    domain: manifest.domain ? `Data domain: ${manifest.domain.id}, version ${manifest.domain.version}. Areas outside it have no data, never zero.` : null,
    version: manifest.dataVersion ?? null,
    citation: manifest.citation ?? null,
    acknowledgment: manifest.acknowledgment ?? LANCE_ACKNOWLEDGMENT,
    caveats: catalog(gates).filter((c) => c.kind === 'caveat'),
    lead: 'MODIS has watched for fires since 2000. VIIRS took over with finer pixels in 2012. They count fires differently, so the app scales MODIS to VIIRS-equivalent before drawing the calendar.',
    steps: STEPS,
    synthetic: syntheticModel(manifest),
  };
};

// Copy from docs/method.md sections 1, 4 and 5, as validated at gate V1; edits go through the science gate.
export const STEPS = [
  { title: 'Count fire-cell-days', text: 'A 0.1° grid cell counts once per UTC day with at least one detection, per sensor family, however many pixels or overpasses saw it.' },
  { title: 'Scale MODIS to VIIRS-equivalent', text: 'R is the ratio of VIIRS to MODIS counts over the full months both flew, 2012 to 2021, per area, with a 95% interval. MODIS × R fills the months before VIIRS, marked estimated. A sparse area borrows R from a wider region, marked low confidence.' },
  { title: 'Continue after S-NPP', text: 'K is the ratio of S-NPP to NOAA-20 counts over the months both flew. NOAA-20 × K continues the series after S-NPP, marked estimated.' },
  { title: 'Compare with the median', text: 'Each month is compared with the median of the same month in at least 5 earlier complete years. Anomalies show only once their science review has passed.' },
];

const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const mon = (m) => `${MONTH_ABBR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export const TIMELINE = { width: 440, row: 32, axis: 18, labelRoom: 200 };

/**
 * Sensor timeline from the manifest: one bar per satellite from its first to its last month
 * (satelliteSpans), x in a frame `width` units wide (the rendered width in px, so text sizes in
 * CSS are real sizes). Null without satellites or a last month.
 */
export const timelineModel = (manifest, width = TIMELINE.width) => {
  const sats = satelliteSpans(manifest);
  if (!sats.length || !manifest.last_month) return null;
  const startYear = Math.min(...sats.map((s) => Number(s.from.slice(0, 4))));
  const lo = startYear * 12;
  const hi = monthIdx(manifest.last_month) + 1;
  const x = (m) => ((m - lo) / (hi - lo)) * width;
  const rows = sats.map((s, i) => ({
    family: s.family,
    label: `${s.name} · ${INSTRUMENT[s.family]} · ${mon(s.from)} to ${mon(s.to)}`,
    x0: x(monthIdx(s.from)), x1: x(monthIdx(s.to) + 1), y: i * TIMELINE.row,
  }));
  const endYear = Number(manifest.last_month.slice(0, 4));
  const ticks = [];
  for (let y = startYear; y <= endYear; y += 6) ticks.push({ year: y, x: x(y * 12) });
  const viirs = manifest.coverage?.viirs?.[0];
  return {
    width, rows, ticks,
    overlap: viirs ? x(monthIdx(viirs)) : null,
    height: rows.length * TIMELINE.row + TIMELINE.axis,
    label: `Sensor timeline: ${sats.map((s) => `${s.name} ${mon(s.from)} to ${mon(s.to)}`).join(', ')}`,
  };
};

const f1 = (n) => Number(n.toFixed(1));
const timelineSvg = (t) => {
  const W = t.width;
  const svg = svgEl('svg', { class: 'timeline', viewBox: `0 0 ${W} ${t.height}`, role: 'img', 'aria-label': t.label });
  const axisY = t.height - TIMELINE.axis + 4;
  svg.append(svgEl('line', { x1: 0, x2: W, y1: axisY, y2: axisY, class: 'tl-axis' }));
  if (t.overlap !== null) svg.append(svgEl('line', { x1: f1(t.overlap), x2: f1(t.overlap), y1: 0, y2: axisY, class: 'tl-overlap' }));
  for (const tk of t.ticks) {
    const tx = svgEl('text', { x: f1(Math.min(tk.x, W - 34)), y: t.height - 2, class: 'tl-tick' });
    tx.textContent = String(tk.year);
    svg.append(tx);
  }
  t.rows.forEach((r, i) => {
    // A label that would run off the right edge ends at the edge instead.
    const end = r.x0 > W - TIMELINE.labelRoom;
    const label = svgEl('text', { x: f1(end ? W : r.x0), y: r.y + 12, 'text-anchor': end ? 'end' : 'start', class: 'tl-label' });
    label.textContent = r.label;
    svg.append(label, svgEl('rect', { x: f1(r.x0), y: r.y + 16, width: f1(r.x1 - r.x0), height: 10, rx: 5, class: `tl-bar tl-${r.family}${i % 2 ? ' tl-second' : ''}` }));
  });
  return svg;
};


/**
 * mount(container, {manifest, trigger, themeMount(el)}). `trigger` is the slot that receives the
 * Method button. A modal dialog per the APG: focus to the title, Tab trapped, Escape and the scrim
 * close it, focus returns to the trigger. Returns {open(returnTo?), close(), update({manifest}), destroy()}.
 */
export const mount = (container, deps) => {
  let manifest = deps.manifest;
  let returnTo = null;
  let isOpen = false;

  const build = () => {
    const m = methodModel(manifest);
    const t = timelineModel(manifest);
    const section = (title, ...body) => h('section', { class: 'drawer-section' }, h('h3', { text: title }), ...body);
    const title = h('h2', { id: 'drawer-title', tabindex: '-1', text: 'Two satellite records, one calendar' });
    const theme = h('div', { class: 'drawer-theme' });
    const panel = h('div', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title' },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }),
      h('div', { class: 'panel-top' },
        h('span', { class: 'eyebrow' }, 'Method', m.preliminary ? h('span', { class: 'badge', text: 'Preliminary' }) : null),
        h('button', { type: 'button', class: 'icon-btn drawer-close', 'aria-label': 'Close method', onclick: () => close() }, icon('close'))),
      title,
      h('p', { class: 'lead', text: m.lead }),
      t && timelineSvg(t),
      h('div', { class: 'flame-key' }, mark('mark mark-key'), h('ul', {},
        h('li', {}, h('i', { class: 'key-modis', 'aria-hidden': 'true' }), 'Blue half: MODIS record'),
        h('li', {}, h('i', { class: 'key-viirs', 'aria-hidden': 'true' }), 'Orange half: VIIRS record'),
        h('li', {}, h('i', { class: 'key-harm', 'aria-hidden': 'true' }), 'Yellow core: the harmonized series you see'))),
      h('ol', { class: 'steps' }, m.steps.map((s) => h('li', {}, h('span', {}, h('b', { text: s.title }), s.text)))),
      h('p', { class: 'note', text: `${m.status} Method: ${m.method}.` }),
      section('Unit', h('p', { text: m.unit }), h('p', { text: m.grid })),
      m.sensors.length > 0 && section('Sensor dates', h('ul', {}, m.sensors.map((s) => h('li', {}, h('strong', { text: `${s.label} ` }), s.text)))),
      section('Caveats', h('ul', {}, m.caveats.map((c) => h('li', {}, h('strong', { text: `${c.short} ` }), c.long, c.preliminary ? h('span', { class: 'tag', text: 'Preliminary' }) : null)))),
      section('Data', m.version && h('p', { class: 'mono', text: `Data version: ${m.version}` }), m.domain && h('p', { text: m.domain }), m.citation && h('p', { text: m.citation }), h('p', { text: m.acknowledgment }),
        m.synthetic && h('p', { class: 'synth-note', text: `${m.synthetic.label}. ${m.synthetic.sentence}` })),
      section('Theme', theme));
    panel.addEventListener('keydown', onKeydown);
    deps.themeMount?.(theme);
    return h('div', { class: 'drawer-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); } }, panel);
  };

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    trapTab(ev, ev.currentTarget);
  };

  // Redraw the timeline at its rendered width so its labels keep their CSS size on every screen.
  const fitTimeline = () => {
    const svg = container.querySelector('.timeline');
    const w = Math.round(svg?.getBoundingClientRect().width ?? 0);
    const t = w && timelineModel(manifest, w);
    if (t && w !== TIMELINE.width) svg.replaceWith(timelineSvg(t));
  };

  const open = (from) => {
    if (isOpen) return;
    deps.beforeOpen?.();
    isOpen = true;
    returnTo = from ?? document.activeElement;
    container.replaceChildren(build());
    button.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('drawer-open');
    fitTimeline();
    container.querySelector('#drawer-title').focus();
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    container.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('drawer-open');
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
  };

  const button = h('button', { type: 'button', class: 'btn btn-ghost method-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Method', onclick: (ev) => open(ev.currentTarget) },
    icon('info', 'icon-phone'), h('span', { class: 'btn-label', text: 'Method' }));
  deps.trigger?.replaceChildren(button);

  return {
    open,
    close,
    update: (next) => { manifest = next.manifest ?? manifest; },
    destroy: () => { close(); deps.trigger?.replaceChildren(); },
  };
};
