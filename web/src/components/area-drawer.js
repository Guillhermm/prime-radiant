import { drawerModel, hotspotLabels, mapModel, placeAt, PICK_HINT, sameBbox, squareFor, UNAVAILABLE, valueLine } from '../places.js';
import { hottestList, legendEl, mountHeatMap, swatch } from './heat-map.js';
import { h } from './h.js';
import { icon } from './icons.js';
import { trapTab } from './focus-trap.js';

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
  let mapCtl = null;

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

    const current = squareFor(model, deps.currentBbox());
    const sel = h('div', { class: 'ad-sel' });
    const primary = h('button', { type: 'button', class: 'btn btn-primary ad-primary', disabled: true, text: m.primary, onclick: () => commit() });
    let hot = null;
    const stage = (q) => {
      staged = q;
      map.select(q);
      hot?.press(q?.bbox);
      primary.disabled = !q;
      if (!q) { sel.replaceChildren(h('span', { class: 'ad-hint', text: PICK_HINT })); return; }
      const { label, coords } = hotspotLabels(placeAt(overview, q.bbox) ?? { bbox: q.bbox });
      sel.replaceChildren(swatch(q.bin), h('span', { class: 'ad-sel-text' }, h('b', { text: label }), h('small', { text: coords ? `${coords} · ${valueLine(q.value, overview)}` : valueLine(q.value, overview) })));
    };
    const map = mountHeatMap(model, overview, { focus: current, onPick: (q) => stage(q) });
    mapCtl = map;

    hot = hottestList({ overview, model, map, limit: 10, title: m.listTitle, titleClass: 'ad-list-title', rowSub: m.rowSub, onPick: (q) => stage(q) });
    hot.head.id = 'ad-list-title';

    // On phone CSS lifts the manual row above the list, as in the sheet mockup.
    body.append(
      h('div', { class: 'plate' }, ...map.nodes, legendEl(), m.border ? h('p', { class: 'plate-note', text: m.border }) : null),
      h('section', { class: 'ad-list', 'aria-labelledby': 'ad-list-title' },
        h('div', { class: 'ad-sub' }, hot.head, h('span', { text: m.listSub })),
        hot.list, hot.live),
      manualRow);
    foot.append(sel, h('button', { type: 'button', class: 'btn ad-cancel', text: 'Cancel', onclick: () => close() }), primary);
    stage(null);
    return { el: backdrop(panel), focusEl: map.mapEl };
  };

  const backdrop = (panel) => h('div', { class: 'drawer-backdrop area-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); } }, panel);

  const onKeydown = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); return; }
    trapTab(ev, ev.currentTarget);
  };

  const render = () => {
    mapCtl?.stop();
    mapCtl = null;
    const { el, focusEl } = build();
    container.replaceChildren(el);
    mapCtl?.start();
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
    mapCtl?.stop();
    mapCtl = null;
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
