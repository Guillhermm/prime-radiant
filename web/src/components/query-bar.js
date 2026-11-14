import { isEnabledView } from '../views.js';
import { LAYERS } from '../state.js';
import { h } from './h.js';
import { trapTab } from './focus-trap.js';
import * as aoiForm from './aoi-form.js';
import * as dateRange from './date-range.js';

// The draft is what the user typed; Apply is the only thing that commits it to the store.
export const canApply = (aoi, dates) => Boolean(aoi?.valid && dates?.valid);

// Patch for store.set, or null when the draft is not applicable.
export const applyPatch = (aoi, dates) => (canApply(aoi, dates)
  ? { bbox: aoi.bbox, from: dates.from, to: dates.to }
  : null);

// A preset goes straight to the hash (acceptance: presets set the hash), keeping the dates in
// the URL and falling back to the whole span when none is set yet.
export const presetPatch = (preset, state, span = null) => ({
  bbox: preset.bbox,
  from: state.from ?? span?.from ?? null,
  to: state.to ?? span?.to ?? null,
});

const sig = (x) => Number(x.toPrecision(3));

// Text of the two phone chips (docs/ux.md 3.2), from the committed state.
export const summaryModel = (state, span = null) => {
  let area = 'No area chosen';
  if (state.bbox) {
    const [w, s, e, n] = state.bbox;
    area = `Area: ${s}, ${w} to ${n}, ${e} (${sig((e - w) * (n - s))} sq deg)`;
  }
  const from = state.from ?? span?.from;
  const to = state.to ?? span?.to;
  return { area, range: from && to ? `Range: ${from} to ${to}` : 'Range: all available' };
};

export const LAYER_LABELS = { counts: 'Counts', anomaly: 'vs median' };

// The layer switch exists only once the Anomalies view is enabled (slot C).
export const layerChoices = (views) => (isEnabledView('anomalies', views)
  ? LAYERS.map((id) => ({ id, label: LAYER_LABELS[id] }))
  : []);

export const mount = (container, {
  store, views, span = null, maxAreaDeg2 = Infinity, now,
  goTo = (patch) => store.set(patch), onAoiInput = () => {}, onDrawMap = null,
} = {}) => {
  let aoi = { valid: false };
  let dates = { valid: false };
  const apply = h('button', { type: 'button', class: 'btn-primary', disabled: true }, 'Apply');
  const sync = () => { apply.disabled = !canApply(aoi, dates); };

  const aoiBox = h('div');
  const dateBox = h('div');
  const s = store.get();
  const aoiCtl = aoiForm.mount(aoiBox, { bbox: s.bbox, maxAreaDeg2, onChange: (v) => { aoi = v; sync(); onAoiInput(v); },
    onPreset: (p) => goTo(presetPatch(p, store.get(), span)) });
  const dateCtl = dateRange.mount(dateBox, { span, from: s.from ?? '', to: s.to ?? '', now, onChange: (v) => { dates = v; sync(); } });

  const commit = () => {
    const patch = applyPatch(aoi, dates);
    if (!patch) return;
    goTo(patch);
    closeSheet();
  };
  apply.addEventListener('click', commit);

  const choices = layerChoices(views);
  const layerBox = choices.length
    ? h('fieldset', { class: 'layer' }, h('legend', {}, 'Layer'),
      choices.map((c) => h('label', {},
        h('input', { type: 'radio', name: 'layer', value: c.id, checked: store.get().layer === c.id, onchange: () => store.set({ layer: c.id }) }), c.label)))
    : null;

  // The full-screen map opens over the sheet, so the sheet stops being modal until focus is back.
  const drawBtn = onDrawMap ? h('button', { type: 'button', class: 'chip draw-map', onclick: () => { setModal(false); onDrawMap(); } }, 'Draw on map') : null;
  const closeBtn = h('button', { type: 'button', class: 'sheet-close' }, 'Close');
  const form = h('form', { class: 'query-form', 'aria-label': 'Query' },
    h('div', { class: 'sheet-head' }, h('strong', {}, 'Area and range'), closeBtn),
    aoiBox, drawBtn, dateBox, layerBox, h('div', { class: 'actions' }, apply));
  form.addEventListener('submit', (e) => { e.preventDefault(); commit(); });

  // Phone: the form lives in a sheet opened from two summary chips. The sheet state is a
  // class on the container; desktop CSS ignores it and always shows the form.
  let opener = null;
  const isSheetOpen = () => container.classList.contains('sheet-open');
  const setModal = (on) => {
    if (on) { form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); }
    else { form.removeAttribute('role'); form.removeAttribute('aria-modal'); }
  };
  const openSheet = (from, focusEl) => {
    opener = from;
    container.classList.add('sheet-open');
    setModal(true);
    focusEl?.focus();
  };
  const closeSheet = () => {
    if (!isSheetOpen()) return;
    container.classList.remove('sheet-open');
    setModal(false);
    opener?.focus();
  };
  const chip = (cls) => h('button', { type: 'button', class: `summary-chip ${cls}` });
  const areaChip = chip('area-chip');
  const rangeChip = chip('range-chip');
  const summary = h('div', { class: 'query-summary' }, areaChip, rangeChip);
  const paintSummary = (st) => {
    const m = summaryModel(st, span);
    areaChip.textContent = `${m.area}  Change`;
    rangeChip.textContent = `${m.range}  Change`;
    areaChip.setAttribute('aria-label', `${m.area}. Change area`);
    rangeChip.setAttribute('aria-label', `${m.range}. Change range`);
  };
  paintSummary(store.get());
  areaChip.addEventListener('click', () => openSheet(areaChip, form.querySelector('#aoi-south')));
  rangeChip.addEventListener('click', () => openSheet(rangeChip, form.querySelector('#date-from')));
  closeBtn.addEventListener('click', closeSheet);
  form.addEventListener('keydown', (e) => {
    if (!isSheetOpen()) return;
    if (e.key === 'Escape') closeSheet();
    else trapTab(e, form);
  });
  form.addEventListener('focusin', () => { if (isSheetOpen()) setModal(true); });
  container.append(summary, form);

  // Store changes from the hash or from presets in the empty state refill the form.
  // Only when the committed values change: a view switch must not wipe an unapplied draft.
  let last = store.get();
  store.subscribe((st) => {
    if (st.bbox !== last.bbox || st.from !== last.from || st.to !== last.to) { aoiCtl.set(st.bbox); dateCtl.set(st.from, st.to); }
    last = st;
    paintSummary(st);
  });
  return { aoi: aoiCtl, dates: dateCtl };
};
