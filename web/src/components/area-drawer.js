import { centerLabel, drawerModel, hotspotAt, hotspotLabels, HEAT_LABELS, mapModel, PICK_HINT, sameBbox, squareFor, squareText, stepSquare, UNAVAILABLE, valueLine, formatCount } from '../places.js';
import { bboxText } from './states.js';
import { h } from './h.js';
import { icon, svgEl } from './icons.js';
import { trapTab } from './focus-trap.js';

// SVG units per degree; the SVG scales to its box, so this only sets the stroke and pin proportions.
const U = 10;

const swatch = (bin) => h('i', { class: `hm-sw hm-b${bin}`, 'aria-hidden': 'true' });

/** The heat map: squares, rank pins and the rings for selection, focus and hover, moved by `place`. */
const mapSvg = (model) => {
  const W = (model.east - model.west) * U;
  const H = (model.north - model.south) * U;
  const x = (q) => (q.w - model.west) * U;
  const y = (q) => (model.north - q.s - 1) * U;
  const svg = svgEl('svg', { class: 'hm', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' });
  const squares = svgEl('g', { class: 'hm-squares' });
  for (const q of model.squares) {
    squares.append(svgEl('rect', { x: x(q) + 0.5, y: y(q) + 0.5, width: U - 1, height: U - 1, rx: 1.8, class: `hm-sq hm-b${q.bin}`, 'data-key': q.key }));
  }
  const ring = (cls, pad) => svgEl('rect', { class: cls, width: U + 2 * pad, height: U + 2 * pad, rx: 3, hidden: '' });
  const rings = {
    sel: [ring('hm-ring hm-sel-in', 1.6), ring('hm-ring hm-sel-out', 4.6)],
    focus: [ring('hm-ring hm-focus-in', 1.6), ring('hm-ring hm-focus-out', 4.6)],
    hover: [ring('hm-ring hm-hover', 1.3)],
  };
  const pins = svgEl('g', { class: 'hm-pins' });
  for (const [key, rank] of model.ranks) {
    const q = model.byKey.get(key);
    if (!q) continue;
    const cx = x(q) + U - 0.5;
    const cy = y(q) + 0.5;
    const t = svgEl('text', { x: cx, y: cy + 3 });
    t.textContent = String(rank);
    const pin = svgEl('g', { class: 'hm-pin' });
    pin.append(svgEl('circle', { cx, cy, r: 7 }), t);
    pins.append(pin);
  }
  svg.append(squares, ...rings.hover, ...rings.sel, ...rings.focus, pins);
  const place = (which, q) => rings[which].forEach((r) => {
    if (!q) { r.setAttribute('hidden', ''); return; }
    const pad = (Number(r.getAttribute('width')) - U) / 2;
    r.setAttribute('x', x(q) - pad);
    r.setAttribute('y', y(q) - pad);
    r.removeAttribute('hidden');
  });
  return { svg, place };
};

const legendEl = () => h('ul', { class: 'hm-legend', 'aria-label': 'Fire-cell-days per 1° square' },
  HEAT_LABELS.map((label, bin) => h('li', {}, swatch(bin), label)));

const skeletonEl = () => h('div', { class: 'ad-skeleton', 'aria-hidden': 'true' },
  h('span', { class: 'ad-sk-plate' }), h('span', { class: 'ad-sk-row' }), h('span', { class: 'ad-sk-row' }), h('span', { class: 'ad-sk-row' }));

/**
 * mount(container, {trigger, getOverview(), isHome(), currentBbox(), onCommit(bbox), onManual(target, returnTo), beforeOpen()}).
 * getOverview returns {status: 'loading' | 'ready' | 'missing', overview}. A modal dialog per the
 * APG: Tab is trapped, Escape, the scrim, Cancel and the close button discard the staged pick and
 * return focus to whatever opened it. Returns {open(from), close(opts), update(), isOpen()}.
 */
export const mount = (container, deps) => {
  let returnTo = null;
  let open = false;
  let staged = null;
  let announceTimer = 0;

  const button = h('button', {
    type: 'button', class: 'btn areas-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Choose an area', 'data-tip': 'Choose an area',
    onclick: (ev) => (open ? close() : openDrawer(ev.currentTarget)),
  }, icon('pin'));
  deps.trigger?.replaceChildren(button);

  const setExpanded = (on) => {
    button.setAttribute('aria-expanded', String(on));
    if (returnTo !== button && returnTo?.hasAttribute?.('aria-expanded')) returnTo.setAttribute('aria-expanded', String(on));
  };

  const build = () => {
    const { status, overview } = deps.getOverview();
    const ready = status === 'ready' && overview;
    const home = deps.isHome();
    const m = drawerModel(ready ? overview : null, { home });
    const model = ready ? mapModel(overview) : null;
    staged = null;

    const title = h('h2', { id: 'area-title', tabindex: '-1', text: m.title });
    const head = h('div', { class: 'ad-head' },
      h('div', { class: 'ad-head-text' }, h('p', { class: 'eyebrow', text: 'Choose an area' }), title, m.unit ? h('p', { class: 'ad-unit', text: m.unit }) : null),
      h('button', { type: 'button', class: 'icon-btn ad-close', 'aria-label': 'Close', onclick: () => close() }, icon('close')));
    const manualRow = h('button', { type: 'button', class: 'ad-manual', onclick: () => manual('both') },
      icon('drawArea'), h('span', { text: 'Draw or enter coordinates' }), icon('arrow', 'ad-manual-arrow'));
    const body = h('div', { class: 'ad-body' });
    const foot = h('div', { class: 'ad-foot' });
    const panel = h('div', { class: 'area-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'area-title' },
      h('div', { class: 'grabber', 'aria-hidden': 'true' }), head, body, foot);
    panel.addEventListener('keydown', onKeydown);

    if (status === 'loading') {
      panel.setAttribute('aria-busy', 'true');
      body.append(skeletonEl(), manualRow);
      return { el: backdrop(panel), focusEl: title };
    }
    if (!model) {
      body.append(h('div', { class: 'ad-empty' }, h('p', { text: UNAVAILABLE }),
        h('div', { class: 'ad-empty-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => manual('map') }, icon('drawArea'), 'Draw an area'),
          h('button', { type: 'button', class: 'btn', onclick: () => manual('area') }, icon('crosshair'), 'Enter coordinates'))));
      return { el: backdrop(panel), focusEl: title };
    }

    const { svg, place } = mapSvg(model);
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const readout = h('p', { class: 'hm-readout', 'aria-hidden': 'true' });
    const mapEl = h('div', {
      class: 'hm-map', tabindex: '0', role: 'application', 'aria-roledescription': 'map',
      'aria-label': `Fire map of ${overview.year}. Arrow keys move one square, Shift and an arrow five, Home goes to hotspot 1, Enter picks the square.`,
    }, svg);
    const current = squareFor(model, deps.currentBbox());
    let focusSq = current ?? stepSquare(model, null, 'Home');
    const showReadout = (q) => {
      readout.replaceChildren(...(q ? [swatch(q.bin), h('b', { text: centerLabel(q.bbox) }), ` ${valueLine(q.value, overview)}`] : []));
    };
    const rows = [];
    const sel = h('div', { class: 'ad-sel' });
    const primary = h('button', { type: 'button', class: 'btn btn-primary ad-primary', disabled: true, text: m.primary, onclick: () => commit() });

    const stage = (q) => {
      staged = q;
      place('sel', q);
      rows.forEach((r) => r.setAttribute('aria-pressed', String(Boolean(q) && sameBbox(r._bbox, q.bbox))));
      primary.disabled = !q;
      showReadout(q);
      if (!q) { sel.replaceChildren(h('span', { class: 'ad-hint', text: PICK_HINT })); return; }
      const { label, coords } = hotspotLabels(hotspotAt(overview, q.bbox) ?? { bbox: q.bbox });
      sel.replaceChildren(swatch(q.bin), h('span', { class: 'ad-sel-text' }, h('b', { text: label }), h('small', { text: coords ? `${coords} · ${valueLine(q.value, overview)}` : valueLine(q.value, overview) })));
    };
    const moveFocus = (q) => {
      focusSq = q;
      place('focus', q);
      showReadout(q);
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { live.textContent = squareText(model, q, overview); }, 150);
    };

    mapEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (focusSq) stage(focusSq); return; }
      const next = stepSquare(model, focusSq, ev.key, { by: ev.shiftKey ? 5 : 1 });
      if (!next) return;
      ev.preventDefault();
      moveFocus(next);
    });
    mapEl.addEventListener('focus', () => { if (focusSq) moveFocus(focusSq); });
    mapEl.addEventListener('blur', () => showReadout(staged));
    const squareAt = (ev) => model.byKey.get(ev.target.closest?.('[data-key]')?.dataset.key) ?? null;
    svg.addEventListener('pointermove', (ev) => {
      const q = squareAt(ev);
      place('hover', q);
      showReadout(q ?? staged);
    });
    svg.addEventListener('pointerleave', () => { place('hover', null); showReadout(staged); });
    svg.addEventListener('click', (ev) => {
      const q = squareAt(ev);
      if (!q) return;
      focusSq = q;
      place('focus', q);
      stage(q);
    });

    const list = h('ol', { class: 'ad-rows' }, (overview.hotspots ?? []).map((hs, i) => {
      const q = squareFor(model, hs.bbox) ?? { key: hs.bbox.join(), bbox: hs.bbox, value: hs.value, bin: 6 };
      const { label, coords } = hotspotLabels(hs);
      const row = h('button', { type: 'button', class: 'hs-row', 'aria-pressed': 'false', onclick: () => { stage(q); if (model.byKey.has(q.key)) { focusSq = q; place('focus', q); } } },
        h('span', { class: 'hs-rank', text: String(i + 1) }),
        h('span', { class: 'hs-name' }, h('b', { text: label }), h('small', { class: coords || m.rowSub ? '' : 'mono', text: coords ?? m.rowSub ?? bboxText(hs.bbox) })),
        h('span', { class: 'hs-val' }, swatch(q.bin), formatCount(hs.value)));
      row._bbox = hs.bbox;
      rows.push(row);
      return h('li', {}, row);
    }));

    // On phone CSS lifts the manual row above the list, as in the sheet mockup.
    body.append(
      h('div', { class: 'plate' }, mapEl, readout, legendEl(), h('p', { class: 'plate-note', text: m.border }), live),
      h('section', { class: 'ad-list', 'aria-labelledby': 'ad-list-title' },
        h('div', { class: 'ad-sub' }, h('h3', { id: 'ad-list-title', text: m.listTitle }), h('span', { text: m.listSub })),
        list),
      manualRow);
    foot.append(sel, h('button', { type: 'button', class: 'btn ad-cancel', text: 'Cancel', onclick: () => close() }), primary);
    stage(null);
    return { el: backdrop(panel), focusEl: mapEl };
  };

  const backdrop = (panel) => h('div', { class: 'drawer-backdrop area-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); } }, panel);

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    trapTab(ev, ev.currentTarget);
  };

  const render = () => {
    const { el, focusEl } = build();
    container.replaceChildren(el);
    focusEl.focus();
  };

  const openDrawer = (from) => {
    if (open) return;
    deps.beforeOpen?.();
    open = true;
    returnTo = from ?? document.activeElement;
    setExpanded(true);
    document.documentElement.classList.add('drawer-open');
    render();
  };

  const close = ({ restore = true } = {}) => {
    if (!open) return;
    open = false;
    staged = null;
    clearTimeout(announceTimer);
    container.replaceChildren();
    setExpanded(false);
    document.documentElement.classList.remove('drawer-open');
    const back = returnTo;
    returnTo = null;
    if (restore && back?.isConnected) back.focus();
  };

  const commit = () => {
    const bbox = staged?.bbox;
    if (!bbox) return;
    close();
    if (!sameBbox(bbox, deps.currentBbox())) deps.onCommit(bbox);
  };

  // The manual path is the area form and map: the drawer closes first, and the form returns focus
  // to whatever opened the drawer.
  const manual = (target) => {
    const back = returnTo;
    close({ restore: false });
    deps.onManual?.(target, back);
  };

  return {
    open: openDrawer,
    close,
    isOpen: () => open,
    /** Rebuilds an open drawer, for when overview.json arrives while it is open. */
    update: () => { if (open) render(); },
  };
};
