import { CAVEATS, PRELIMINARY, STRIP_TEXT } from '../caveat-catalog.js';
import { h } from './h.js';
import { icon } from './icons.js';

/** What the caveat line shows. It has no close control by design (docs/ux.md section 2). */
export const stripModel = ({ preliminary = PRELIMINARY, text = STRIP_TEXT } = {}) => ({
  text,
  preliminary,
  badge: preliminary ? 'Preliminary' : null,
  readMore: 'How this is made',
  count: CAVEATS.length,
});

/** mount(container, {onReadMore(trigger)}). Returns {destroy()}. */
export const mount = (container, deps = {}) => {
  const m = stripModel(deps);
  const more = h('button', { type: 'button', class: 'caveat-more', text: m.readMore, onclick: (ev) => deps.onReadMore?.(ev.currentTarget) });
  container.replaceChildren(h('p', { class: 'caveat-line' },
    icon('warning'),
    h('span', { class: 'caveat-text', text: m.text }),
    m.badge && h('span', { class: 'badge', text: m.badge }),
    more));
  return { destroy: () => container.replaceChildren() };
};
