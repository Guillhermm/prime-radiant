import { CAVEATS, PRELIMINARY, STRIP_TEXT } from '../caveat-catalog.js';
import { h } from './h.js';

/** What the strip shows. The strip has no close control by design (docs/ux.md section 2). */
export const stripModel = ({ preliminary = PRELIMINARY, text = STRIP_TEXT, synthetic = false } = {}) => ({
  text,
  preliminary,
  badge: preliminary ? 'Preliminary' : null,
  synthetic,
  syntheticBadge: synthetic ? 'Synthetic demo data' : null,
  readMore: 'Read more',
  count: CAVEATS.length,
});

/** mount(container, {onReadMore(trigger)}). Returns {destroy()}. */
export const mount = (container, deps = {}) => {
  const m = stripModel(deps);
  const more = h('button', { type: 'button', class: 'caveat-more', text: m.readMore, onclick: (ev) => deps.onReadMore?.(ev.currentTarget) });
  container.replaceChildren(h('p', { class: 'caveat-line' },
    h('span', { class: 'caveat-text', text: m.text }), ' ',
    m.syntheticBadge && h('span', { class: 'badge badge-synthetic', role: 'note', text: m.syntheticBadge }), ' ',
    m.badge && h('span', { class: 'badge', text: m.badge }), ' ', more));
  return { destroy: () => container.replaceChildren() };
};
