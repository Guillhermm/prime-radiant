import { isEnabledView } from '../views.js';
import { LAYERS } from '../state.js';
import { h } from './h.js';
import * as aoiForm from './aoi-form.js';
import * as dateRange from './date-range.js';

// The draft is what the user typed; Apply is the only thing that commits it to the store.
export const canApply = (aoi, dates) => Boolean(aoi?.valid && dates?.valid);

// Patch for store.set, or null when the draft is not applicable.
export const applyPatch = (aoi, dates) => (canApply(aoi, dates)
  ? { bbox: aoi.bbox, from: dates.from, to: dates.to }
  : null);

export const LAYER_LABELS = { counts: 'Counts', anomaly: 'vs median' };

// The layer switch exists only once the Anomalies view is enabled (slot C).
export const layerChoices = (views) => (isEnabledView('anomalies', views)
  ? LAYERS.map((id) => ({ id, label: LAYER_LABELS[id] }))
  : []);

export const mount = (container, { store, views, span = null, maxAreaDeg2 = Infinity, now } = {}) => {
  let aoi = { valid: false };
  let dates = { valid: false };
  const apply = h('button', { type: 'button', class: 'btn-primary', disabled: true }, 'Apply');
  const sync = () => { apply.disabled = !canApply(aoi, dates); };

  const aoiBox = h('div');
  const dateBox = h('div');
  const s = store.get();
  const aoiCtl = aoiForm.mount(aoiBox, { bbox: s.bbox, maxAreaDeg2, onChange: (v) => { aoi = v; sync(); } });
  const dateCtl = dateRange.mount(dateBox, { span, from: s.from ?? '', to: s.to ?? '', now, onChange: (v) => { dates = v; sync(); } });

  const commit = () => {
    const patch = applyPatch(aoi, dates);
    if (patch) store.set(patch);
  };
  apply.addEventListener('click', commit);

  const choices = layerChoices(views);
  const layerBox = choices.length
    ? h('fieldset', { class: 'layer' }, h('legend', {}, 'Layer'),
      choices.map((c) => h('label', {},
        h('input', { type: 'radio', name: 'layer', value: c.id, checked: store.get().layer === c.id, onchange: () => store.set({ layer: c.id }) }), c.label)))
    : null;

  const form = h('form', { class: 'query-form', 'aria-label': 'Query' }, aoiBox, dateBox, layerBox, h('div', { class: 'actions' }, apply));
  form.addEventListener('submit', (e) => { e.preventDefault(); commit(); });
  container.append(form);

  // Store changes from the hash or from presets in the empty state refill the form.
  // Only when the committed values change: a view switch must not wipe an unapplied draft.
  let last = store.get();
  store.subscribe((st) => {
    if (st.bbox !== last.bbox || st.from !== last.from || st.to !== last.to) { aoiCtl.set(st.bbox); dateCtl.set(st.from, st.to); }
    last = st;
  });
  return { aoi: aoiCtl, dates: dateCtl };
};
