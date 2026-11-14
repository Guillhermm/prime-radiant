import { UNIT_SENTENCE } from './legend.js';
import { CAVEATS, PRELIMINARY } from '../caveat-catalog.js';
import { h } from './h.js';
import { trapTab } from './focus-trap.js';

// Acknowledgment wording is FIRMS' standard text; the manifest does not carry it yet.
export const LANCE_ACKNOWLEDGMENT = "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).";

/** Drawer content from the manifest; any missing manifest field is skipped, never invented. */
export const methodModel = (manifest) => {
  manifest ??= {};
  const sensors = [];
  for (const [family, span] of Object.entries(manifest.coverage ?? {})) {
    const sats = (manifest.satellites?.[family] ?? []).map((s) => `${s.name} from ${s.from}`).join(', ');
    sensors.push({ label: family.toUpperCase(), text: `${span[0]} to ${span[1]}${sats ? ` (${sats})` : ''}` });
  }
  return {
    title: 'Method',
    preliminary: PRELIMINARY,
    unit: `Unit: fire-cell-day, one grid cell with at least one detection on one UTC day. ${UNIT_SENTENCE}`,
    summary: 'The harmonized series is VIIRS where VIIRS operates for the full month and MODIS scaled by a ratio R elsewhere, marked estimated. R is estimated per area on the months where both sensors operate.',
    grid: 'Assumption: detections are binned into a 0.1 degree grid (about 11 km at the equator), coarser than either sensor pixel at nadir.',
    sensors,
    version: manifest.dataVersion ?? null,
    citation: manifest.citation ?? null,
    acknowledgment: manifest.acknowledgment ?? LANCE_ACKNOWLEDGMENT,
    caveats: CAVEATS,
  };
};

/**
 * mount(container, {manifest, trigger}). `trigger` is the slot that receives the Method button.
 * Returns {open(returnTo?), close(), update({manifest}), destroy()}.
 */
export const mount = (container, deps) => {
  let manifest = deps.manifest;
  let returnTo = null;
  let isOpen = false;

  const build = () => {
    const m = methodModel(manifest);
    const section = (title, ...body) => h('section', { class: 'drawer-section' }, h('h3', { text: title }), ...body);
    const panel = h('div', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-title', tabindex: '-1' },
      h('div', { class: 'drawer-head' },
        h('h2', { id: 'drawer-title', text: m.title }),
        m.preliminary && h('span', { class: 'badge', text: 'Preliminary' }),
        h('button', { type: 'button', class: 'drawer-close', text: 'Close', onclick: () => close() })),
      section('Unit', h('p', { text: m.unit })),
      section('Summary', h('p', { text: m.summary }), h('p', { text: m.grid })),
      m.sensors.length > 0 && section('Sensor dates', h('ul', {}, m.sensors.map((s) => h('li', {}, h('strong', { text: `${s.label} ` }), s.text)))),
      section('Caveats', h('ul', {}, m.caveats.map((c) => h('li', { text: `${c.id}: ${c.text} (${c.status})` })))),
      section('Data', m.version && h('p', { text: `Data version: ${m.version}` }), m.citation && h('p', { text: m.citation }), h('p', { text: m.acknowledgment })));
    panel.addEventListener('keydown', onKeydown);
    return h('div', { class: 'drawer-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); } }, panel);
  };

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    trapTab(ev, ev.currentTarget);
  };

  const open = (from) => {
    if (isOpen) return;
    isOpen = true;
    returnTo = from ?? document.activeElement;
    container.replaceChildren(build());
    button.setAttribute('aria-expanded', 'true');
    container.querySelector('.drawer-panel').focus();
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    container.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
    if (returnTo?.isConnected) returnTo.focus();
    returnTo = null;
  };

  const button = h('button', { type: 'button', class: 'method-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', text: 'Method', onclick: (ev) => open(ev.currentTarget) });
  deps.trigger?.replaceChildren(button);

  return {
    open,
    close,
    update: (next) => { manifest = next.manifest ?? manifest; },
    destroy: () => { close(); deps.trigger?.replaceChildren(); },
  };
};
