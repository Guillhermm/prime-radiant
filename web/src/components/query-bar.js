import { isEnabledView } from '../views.js';
import { LAYERS, cleanName } from '../state.js';
import { h } from './h.js';
import { icon } from './icons.js';
import { bboxText } from './states.js';
import { trapTab } from './focus-trap.js';
import * as shareMenu from './share-menu.js';
import * as aoiForm from './aoi-form.js';
import * as dateRange from './date-range.js';
import * as nameField from './name-field.js';

// The draft is what the user typed; Apply is the only thing that commits it to the store.
export const canApply = (aoi, dates) => Boolean(aoi?.valid && dates?.valid);

// Patch for store.set, or null when the draft is not applicable. A blank name is no name.
export const applyPatch = (aoi, dates, name = null) => (canApply(aoi, dates)
  ? { bbox: aoi.bbox, name: cleanName(name), from: dates.from, to: dates.to }
  : null);

// A preset goes straight to the hash (acceptance: presets set the hash), keeping the dates in
// the URL and falling back to the whole span when none is set yet.
export const presetPatch = (preset, state, span = null) => ({
  bbox: preset.bbox,
  name: preset.name ?? null,
  from: state.from ?? span?.from ?? null,
  to: state.to ?? span?.to ?? null,
});

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mon = (m) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Text of the area and period chips (docs/ux.md 3.2), from the committed state. A named area
// shows its name; the coordinates stay in the accessible name.
export const chipModel = (state, span = null) => {
  const from = state.from ?? span?.from;
  const to = state.to ?? span?.to;
  const coords = state.bbox ? bboxText(state.bbox) : 'No area chosen';
  const spoken = coords.replace(' · ', ', ').replaceAll('–', ' to ');
  const named = Boolean(state.bbox && state.name);
  const period = from && to ? `${mon(from)} – ${mon(to)}` : 'All available';
  return {
    area: named ? state.name : coords,
    named,
    period,
    areaLabel: `Area: ${named ? `${state.name}, ${spoken}` : spoken}. Change area`,
    periodLabel: `Period: ${period.replace(' – ', ' to ')}. Change period`,
  };
};

export const LAYER_LABELS = { counts: 'Counts', anomaly: 'vs median' };

// The layer switch exists only once the Anomalies view is enabled (slot C).
export const layerChoices = (views) => (isEnabledView('anomalies', views)
  ? LAYERS.map((id) => ({ id, label: LAYER_LABELS[id] }))
  : []);

export const mount = (container, {
  store, span = null, maxAreaDeg2 = Infinity, now, presets, mapSlot = null,
  goTo = (patch) => store.set(patch), onAoiInput = () => {}, onDrawMap = null, onMapToggle = null, onAreaChip = null, copy,
  titleOf = (st) => st.name, loadPlaces,
} = {}) => {
  let aoi = { valid: false };
  let dates = { valid: false };
  const apply = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Apply');
  const sync = () => { apply.disabled = !canApply(aoi, dates); };

  const nameBox = h('div', { class: 'name-box' });
  const aoiBox = h('div', { class: 'aoi-box' });
  const dateBox = h('div', { class: 'date-box' });
  const s = store.get();
  // A suggestion fills the coordinates too, which moves the map through onAoiInput.
  let aoiCtl = null;
  const nameCtl = nameField.mount(nameBox, { loadPlaces, onPick: (e) => aoiCtl?.set(e.bbox) });
  // The name field shows the committed area's title; with no area it says "Custom area".
  const prefillName = (st) => nameCtl.set(st.bbox ? titleOf(st) : null, st.bbox);
  aoiCtl = aoiForm.mount(aoiBox, { bbox: s.bbox, maxAreaDeg2, presets, onChange: (v) => { aoi = v; sync(); nameCtl.coords(v.bbox); onAoiInput(v); },
    onPreset: (p) => { goTo(presetPatch(p, store.get(), span)); closeSheet(); } });
  const dateCtl = dateRange.mount(dateBox, { span, from: s.from ?? '', to: s.to ?? '', now, onChange: (v) => { dates = v; sync(); } });

  prefillName(s);

  const commit = () => {
    // An untouched name keeps the area's own (an example's label is not written to the link), and
    // the default "Custom area" is no name at all.
    const typed = nameCtl.value();
    const name = nameCtl.isPrefilled() ? store.get().name : typed === nameField.DEFAULT_NAME ? null : typed;
    const patch = applyPatch(aoi, dates, name);
    if (!patch) return;
    goTo(patch);
    closeSheet();
  };
  apply.addEventListener('click', commit);

  // On phone the map opens full screen over the sheet, so the sheet stops being modal until focus is back.
  const drawBtn = onDrawMap ? h('button', { type: 'button', class: 'btn draw-map', onclick: () => { setModal(false); onDrawMap(); } }, icon('drawArea'), 'Draw on map') : null;
  const closeBtn = h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close area and period' }, icon('close'));
  const actions = h('div', { class: 'actions' }, apply);
  const form = h('form', { class: 'query-form', 'aria-labelledby': 'query-title' },
    h('div', { class: 'sheet-head' }, h('strong', { id: 'query-title', text: 'Area and period' }), closeBtn),
    nameBox, mapSlot, aoiBox, drawBtn, dateBox, actions);
  form.addEventListener('submit', (e) => { e.preventDefault(); commit(); });

  // The form is a popover under the chips on desktop and a sheet on phone. Its open state is a
  // class on the container.
  let opener = null;
  const isSheetOpen = () => container.classList.contains('sheet-open');
  const setModal = (on) => {
    if (on) { form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); }
    else { form.removeAttribute('role'); form.removeAttribute('aria-modal'); }
  };
  const chip = (cls, ic) => h('button', { type: 'button', class: `chip summary-chip ${cls}`, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon(ic));
  const areaChip = chip('area-chip', 'areaDashed');
  const rangeChip = chip('range-chip', 'calendar');
  const setExpanded = (on) => [areaChip, rangeChip].forEach((c) => c.setAttribute('aria-expanded', String(on && c === opener)));
  // centered: opened from outside the chips (first screen, place picker), so the form is a dialog
  // in the middle of the screen on desktop rather than a popover hanging off a chip.
  const openSheet = (from, focusEl, { centered = false } = {}) => {
    opener = from;
    form.classList.toggle('is-centered', centered);
    container.classList.add('sheet-open');
    document.documentElement.classList.add('query-open');
    setModal(true);
    setExpanded(true);
    focusEl?.focus();
  };
  const closeSheet = () => {
    if (!isSheetOpen()) return;
    container.classList.remove('sheet-open');
    document.documentElement.classList.remove('query-open');
    setModal(false);
    setExpanded(false);
    opener?.focus();
  };
  const share = shareMenu.create({ getBbox: () => store.get().bbox, getName: () => (store.get().bbox ? store.get().name : null), ...(copy && { copy }) });
  // The share button rides on the area chip; the pair wraps as one unit.
  const summary = h('div', { class: 'query-summary chips' }, h('span', { class: 'chip-split' }, areaChip, share.button), share.menu, rangeChip);
  const paintSummary = (st) => {
    const m = chipModel(st, span);
    areaChip.replaceChildren(icon('areaDashed'), h('span', { class: m.named ? 'chip-text' : 'chip-text mono', text: m.area }), icon('pencil', 'chip-edit'));
    rangeChip.replaceChildren(icon('calendar'), h('span', { class: 'chip-text', text: m.period }), icon('chevron', 'chip-edit'));
    areaChip.setAttribute('aria-label', m.areaLabel);
    share.update();
    rangeChip.setAttribute('aria-label', m.periodLabel);
  };
  paintSummary(store.get());
  // With a place picker the area chip opens it; the form stays one step away from there.
  areaChip.addEventListener('click', () => {
    if (onAreaChip) { closeSheet(); onAreaChip(areaChip); return; }
    if (isSheetOpen() && opener === areaChip) closeSheet();
    else openSheet(areaChip, form.querySelector('#aoi-south'));
  });
  rangeChip.addEventListener('click', () => (isSheetOpen() && opener === rangeChip ? closeSheet() : openSheet(rangeChip, form.querySelector('#date-from'))));
  closeBtn.addEventListener('click', closeSheet);
  form.addEventListener('keydown', (e) => {
    if (!isSheetOpen()) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } else trapTab(e, form);
  });
  form.addEventListener('focusin', () => { if (isSheetOpen()) setModal(true); });
  const onOutside = (e) => {
    if (!isSheetOpen() || container.contains(e.target) || e.target.closest?.('.map-panel.is-full')) return;
    closeSheet();
  };
  document.addEventListener('pointerdown', onOutside);
  container.append(summary, form);

  // Store changes from the hash or from presets in the empty state refill the form.
  // Only when the committed values change: a view switch must not wipe an unapplied draft.
  let last = store.get();
  store.subscribe((st) => {
    if (st.bbox !== last.bbox || st.name !== last.name || st.from !== last.from || st.to !== last.to) { prefillName(st); aoiCtl.set(st.bbox); dateCtl.set(st.from, st.to); }
    last = st;
    paintSummary(st);
  });
  return {
    aoi: aoiCtl,
    name: nameCtl,
    dates: dateCtl,
    actions,
    /** Opens the form from a trigger outside the chips: 'area' focuses South, 'map' also opens the map. */
    open: (target, from) => {
      openSheet(from ?? areaChip, target === 'period' ? form.querySelector('#date-from') : form.querySelector('#aoi-south'), { centered: true });
      opener = from ?? areaChip;
      if (target === 'map') onMapToggle?.();
    },
    close: closeSheet,
  };
};
