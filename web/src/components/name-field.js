import { indexPlaces, matchPlaces, placeSub } from '../place-search.js';
import { NAME_MAX } from '../state.js';
import { sameBbox } from '../places.js';
import { h } from './h.js';

export const DEFAULT_NAME = 'Custom area';

/**
 * Next combobox state after a key (WAI-ARIA APG, editable combobox with list autocomplete):
 * Down and Up open the list and move through it, wrapping; Alt+Down opens it without moving;
 * Enter picks the active option; Escape closes an open list. Null when the key is not the
 * combobox's to handle, so Enter can still submit the form and Escape close the sheet.
 */
export const comboKey = (key, { open, active, count }, { alt = false } = {}) => {
  if (key === 'ArrowDown') {
    if (!count) return null;
    if (!open) return { open: true, active: alt ? -1 : 0 };
    return { open: true, active: alt ? active : (active + 1) % count };
  }
  if (key === 'ArrowUp') {
    if (!count) return null;
    if (!open) return { open: true, active: count - 1 };
    return { open: true, active: active <= 0 ? count - 1 : active - 1 };
  }
  if (key === 'Enter') return open && active >= 0 ? { open: false, active: -1, pick: active } : null;
  if (key === 'Escape') return open ? { open: false, active: -1 } : null;
  return null;
};

/** "8 places match" for the polite status line; empty when nothing to say. */
export const countText = (n) => (n ? `${n} ${n === 1 ? 'place matches' : 'places match'}. Up and down arrows to choose.` : '');

/**
 * The area's Name, with suggestions from places.json. mount(container, {loadPlaces, onPick}):
 * loadPlaces() resolves to a validated places file or null and is called once, on first focus.
 * onPick(entry) fires when a suggestion is chosen. Returns {value(), set(name, bbox), isPrefilled(), coords(bbox)}:
 * set() fills the field for an area; coords() tells it the area's coordinates changed, and while
 * the user has not typed a name of their own, a different area turns it back into "Custom area".
 */
export const mount = (container, { id = 'area-name', loadPlaces = async () => null, onPick = () => {} } = {}) => {
  const listId = `${id}-list`;
  const input = h('input', {
    id, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(NAME_MAX * 2), value: DEFAULT_NAME,
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
  });
  const list = h('ul', { id: listId, role: 'listbox', class: 'combo-list', 'aria-label': 'Places', hidden: true });
  const status = h('p', { class: 'sr-only', role: 'status' });
  container.append(h('div', { class: 'field name-field' }, h('label', { for: id, text: 'Name' }), h('div', { class: 'combo' }, input, list), status));

  let index = null;
  let requested = false;
  let matches = [];
  let open = false;
  let active = -1;
  let base = { name: DEFAULT_NAME, bbox: null };
  let auto = true;
  let prefilled = true;
  let statusTimer = 0;

  const paint = () => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    const opts = [...list.children];
    opts.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (open && active >= 0) {
      input.setAttribute('aria-activedescendant', opts[active].id);
      opts[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const pick = (i) => {
    const e = matches[i];
    if (!e) return;
    input.value = e.name;
    base = { name: e.name, bbox: e.bbox };
    auto = true;
    prefilled = false;
    open = false;
    active = -1;
    paint();
    onPick(e);
  };

  const refresh = () => {
    matches = index ? matchPlaces(index, input.value) : [];
    list.replaceChildren(...matches.map((e, i) => h('li', {
      id: `${listId}-${i}`, role: 'option', class: 'combo-opt', 'aria-selected': 'false',
      onpointerdown: (ev) => ev.preventDefault(), onclick: () => pick(i),
    }, h('span', { class: 'combo-name', text: e.name }), h('span', { class: 'combo-sub', text: placeSub(e) }))));
    open = matches.length > 0 && document.activeElement === input;
    active = -1;
    paint();
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = open ? countText(matches.length) : ''; }, 400);
  };

  input.addEventListener('focus', () => {
    if (requested) return;
    requested = true;
    loadPlaces().then((p) => {
      index = p ? indexPlaces(p) : null;
      if (index && document.activeElement === input && input.value !== base.name) refresh();
    }, () => {});
  });
  input.addEventListener('input', () => { auto = false; refresh(); });
  input.addEventListener('blur', () => { open = false; active = -1; paint(); });
  input.addEventListener('keydown', (ev) => {
    const next = comboKey(ev.key, { open, active, count: matches.length }, { alt: ev.altKey });
    if (!next) return;
    ev.preventDefault();
    ev.stopPropagation();
    if ('pick' in next) { pick(next.pick); return; }
    ({ open, active } = next);
    paint();
  });

  return {
    value: () => input.value,
    set(name, bbox = null) {
      base = { name: name ?? DEFAULT_NAME, bbox };
      auto = true;
      prefilled = true;
      input.value = base.name;
      open = false;
      paint();
    },
    /** True while the field still shows what set() put there: the user neither typed nor picked a name. */
    isPrefilled: () => auto && prefilled && input.value === base.name,
    coords(bbox) {
      if (!auto || !bbox) return;
      input.value = base.bbox && sameBbox(bbox, base.bbox) ? base.name : DEFAULT_NAME;
    },
    input,
  };
};
