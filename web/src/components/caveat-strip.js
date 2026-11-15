import { caveat, catalog } from '../../../core/caveats.js';
import { h } from './h.js';
import { icon } from './icons.js';

export const STRIP_TEXT = 'Hotspot counts, not burned area. Values before VIIRS are scaled to VIIRS-equivalent (MODIS × R).';

/**
 * What the caveat line shows. It has no close control by design (docs/ux.md section 2). The
 * Preliminary badge follows core's gate map: it shows while the method is not validated.
 */
export const stripModel = ({ gates, text = STRIP_TEXT } = {}) => {
  const preliminary = caveat('not-validated', gates).preliminary;
  return {
    text,
    preliminary,
    badge: preliminary ? 'Preliminary' : null,
    readMore: 'How this is made',
    count: catalog(gates).filter((c) => c.kind === 'caveat').length,
  };
};

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
