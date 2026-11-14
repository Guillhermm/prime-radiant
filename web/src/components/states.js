import { PRESETS } from '../presets.js';
import { h } from './h.js';

export const LIVE_STALE_HOURS = 48;

/** Live is unavailable when the last fetch is missing or older than 48 h (docs/ux.md section 6). */
export const liveStatus = (fetchedAt, now = new Date()) => {
  if (!fetchedAt) return { available: false, text: 'Live data unavailable.' };
  const ageHours = (now - new Date(fetchedAt)) / 3.6e6;
  if (Number.isNaN(ageHours) || ageHours > LIVE_STALE_HOURS) return { available: false, text: `Live data unavailable. Last update ${fetchedAt}` };
  return { available: true, text: `Live data, updated ${fetchedAt}` };
};

/**
 * State model. kinds: empty, zero, loading, error, live-unavailable.
 * `error` takes {what, hint}; `live-unavailable` takes {fetchedAt, now}.
 */
export const stateModel = (state, { presets = PRESETS } = {}) => {
  switch (state.kind) {
    case 'empty':
      return { kind: 'empty', role: null, busy: false, lines: ['Choose an area to see its fire history.'], chips: presets.map((p) => ({ id: p.id, label: p.label })), action: null };
    case 'zero':
      return { kind: 'zero', role: 'status', busy: false, lines: ['0 fire-cell-days in range.', 'No hotspots detected, sensors were operating.'], chips: [], action: null };
    case 'loading':
      return { kind: 'loading', role: 'status', busy: true, lines: ['Loading tiles'], chips: [], action: null };
    case 'error':
      return { kind: 'error', role: 'alert', busy: false, lines: [`Could not load: ${state.what ?? 'the data'}.`, state.hint ?? 'Check your connection and try again. Your area and dates are kept.'], chips: [], action: { id: 'retry', label: 'Retry' } };
    case 'live-unavailable':
      return { kind: 'live-unavailable', role: 'status', busy: false, lines: [liveStatus(state.fetchedAt, state.now).text, 'The calendar keeps working.'], chips: [], action: null };
    default:
      throw new RangeError(`states: unknown kind "${state.kind}"`);
  }
};

/**
 * Which state the main view shows, and whether the result groups stay visible.
 * Zero only when every cell in range is a real 0: a null month means a sensor was off, so
 * "sensors were operating" would not be true.
 */
export const screenState = ({ hasArea, status, cells = [] }) => {
  if (!hasArea) return { kind: 'empty', results: false };
  if (status === 'loading') return { kind: 'loading', results: false };
  if (status === 'error') return { kind: 'error', results: false };
  if (status === 'ready' && cells.length > 0 && cells.every((c) => c.value === 0)) return { kind: 'zero', results: true };
  return { kind: null, results: true };
};

/** Error state copy for a data-source error (DataSourceError kinds). */
export const errorState = (err) => {
  if (err?.kind === 'invalid' || err?.kind === 'parse') {
    return { kind: 'error', what: 'the data files, they failed validation', hint: 'No numbers are shown from files that fail validation. Retry, or try another area.' };
  }
  return { kind: 'error', what: 'the data tiles' };
};

const SKELETON_CELLS = 36;

/**
 * mount(container, {presets, onPick(id), onRetry()}). Returns {show(state), clear(), destroy()}.
 * The loading skeleton sets aria-busy on the container; any other state clears it.
 */
export const mount = (container, deps = {}) => {
  const show = (state) => {
    const m = stateModel(state, { presets: deps.presets });
    container.setAttribute('aria-busy', String(m.busy));
    const nodes = m.lines.map((t, i) => h('p', { class: i === 0 ? `state-line state-${m.kind}` : 'hint', text: t }));
    if (m.kind === 'loading') nodes.push(h('div', { class: 'skeleton', 'aria-hidden': 'true' }, Array.from({ length: SKELETON_CELLS }, () => h('span', { class: 'skeleton-cell' }))));
    if (m.chips.length) {
      nodes.push(h('ul', { class: 'chips', 'aria-label': 'Example areas' }, m.chips.map((c) => h('li', {}, h('button', { type: 'button', class: 'chip', text: c.label, onclick: () => deps.onPick?.(c.id) })))));
    }
    if (m.action) nodes.push(h('button', { type: 'button', class: 'state-action', text: m.action.label, onclick: () => deps.onRetry?.() }));
    const box = h('div', { class: `state state-box-${m.kind}`, role: m.role }, nodes);
    container.replaceChildren(box);
  };
  const clear = () => { container.removeAttribute('aria-busy'); container.replaceChildren(); };
  return { show, clear, destroy: clear };
};
