import { h } from './h.js';
import { icon } from './icons.js';
import { popover, restoreFocus } from './popover.js';
import * as toast from './toast.js';

/** "west,south,east,north" in decimal degrees, the order GIS tools and the link use. */
export const bboxDecimal = ([w, s, e, n]) => `${w},${s},${e},${n}`;

/** Menu entries for an area; none without one. A named area is named in the confirmations. */
export const shareItems = (bbox, href, name = null) => (bbox ? [
  { id: 'link', label: 'Copy link', text: href, done: name ? `Link to ${name} copied` : 'Link copied' },
  { id: 'coords', label: 'Copy coordinates', text: bboxDecimal(bbox), done: `${name ? `Coordinates of ${name}` : 'Coordinates'} copied: ${bboxDecimal(bbox)} (west, south, east, north)` },
] : []);

/** Index of the item to focus after `key` in a menu of `n` items, or null for other keys. */
export const nextItem = (key, i, n) => {
  if (key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
};

let seq = 0;

/**
 * create({getBbox, getName, copy, notify}) builds the share button that sits on the area chip and its menu
 * (a popover with role menu: arrows, Home and End move, Escape and Tab close, focus returns to the
 * button). Returns {button, menu, update()}; update() hides the button while there is no area.
 */
export const create = ({ getBbox, getName = () => null, copy = (t) => navigator.clipboard.writeText(t), notify = toast.show }) => {
  const id = `share-menu-${++seq}`;
  const button = h('button', {
    type: 'button', class: 'chip share-chip', popovertarget: id, 'aria-haspopup': 'menu', 'aria-controls': id, 'aria-label': 'Share this area',
  }, icon('link'));
  const menu = h('div', { id, class: 'share-menu', popover: 'auto', role: 'menu', 'aria-label': 'Share this area' });
  let items = [];
  const ctl = popover(menu, [button], {
    onOpen: () => {
      items = shareItems(getBbox(), location.href, getName());
      const r = button.getBoundingClientRect();
      menu.style.setProperty('--pop-top', `${Math.round(r.bottom + 6)}px`);
      menu.style.setProperty('--pop-start', `${Math.round(r.left)}px`);
      menu.replaceChildren(...items.map((it) => h('button', { type: 'button', role: 'menuitem', tabindex: '-1', class: 'share-item', 'data-id': it.id },
        icon(it.id === 'link' ? 'link' : 'crosshair'), it.label)));
      // The menu is shown after this callback; focus the first item once it is.
      requestAnimationFrame(() => menu.querySelector('[role=menuitem]')?.focus());
    },
    onClose: (btn) => restoreFocus(menu, btn),
    closeOnScroll: true,
  });
  const run = async (it) => {
    ctl.hide();
    try {
      await copy(it.text);
      notify(it.done);
    } catch {
      notify(it.id === 'link' ? 'Could not copy. The address bar has the link.' : `Could not copy. Coordinates: ${it.text}`, { kind: 'error' });
    }
  };
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[role=menuitem]');
    if (b) run(items.find((it) => it.id === b.dataset.id));
  });
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('[role=menuitem]')];
    if (e.key === 'Tab') { ctl.hide(); return; }
    const n = nextItem(e.key, list.indexOf(document.activeElement), list.length);
    if (n === null) return;
    e.preventDefault();
    list[n].focus();
  });
  const update = () => { button.hidden = !getBbox(); };
  update();
  return { button, menu, update };
};
