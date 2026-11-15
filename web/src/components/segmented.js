import { h } from './h.js';

/**
 * A radio group drawn as a segmented control: arrow keys move and pick, one tab stop.
 * Returns {el, set(id)}; set changes the pick without calling onPick.
 */
export const segmented = (label, options, onPick) => {
  const btns = options.map((o) => h('button', { type: 'button', role: 'radio', class: 'seg-opt', 'data-id': o.id, 'aria-checked': String(o.on) }, o.label));
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, btns);
  const set = (id) => btns.forEach((b) => { const on = b.dataset.id === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  group.addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (b) { set(b.dataset.id); onPick(b.dataset.id); } });
  group.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const b = btns[(i + step + btns.length) % btns.length];
    b.focus();
    set(b.dataset.id);
    onPick(b.dataset.id);
  });
  set(options.find((o) => o.on)?.id);
  return { el: group, set };
};
