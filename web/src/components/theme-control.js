import { THEMES, browserStorage, loadTheme, saveTheme, applyTheme } from '../theme.js';
import { h } from './h.js';
import { icon } from './icons.js';

const LABELS = { light: 'Light', dark: 'Dark', system: 'System' };
const ICONS = { light: 'sun', dark: 'moon', system: 'monitor' };
// Display order of the switch; THEMES keeps its own order for storage.
const ORDER = ['light', 'dark', 'system'];
const EVENT = 'pr-theme-change';

export const themeOptions = (current) => ORDER.filter((id) => THEMES.includes(id)).map((id) => ({ id, label: LABELS[id], icon: ICONS[id], selected: id === current }));

/** Index of the radio to check after an arrow key in a group of `count`, or null. */
export const nextThemeIndex = (key, index, count) => {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  return null;
};

const reduced = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

// Cross-fade the switch where View Transitions exist; reduced motion and older browsers swap at once.
const withTransition = (fn) => {
  if (document.startViewTransition && !reduced()) {
    document.documentElement.classList.add('vt-theme');
    document.startViewTransition(fn).finished.finally(() => document.documentElement.classList.remove('vt-theme'));
  } else fn();
};

/**
 * mount(container, deps). A three-way radiogroup (Light, Dark, System) with icons. Several can be
 * mounted (top bar, footer, Method sheet); they stay in sync. deps: optional `storage`, `root`.
 */
export const mount = (container, deps = {}) => {
  const storage = deps.storage ?? browserStorage();
  const root = deps.root ?? document.documentElement;
  let current = loadTheme(storage);
  const radios = themeOptions(current).map((o) => h('button', {
    type: 'button', role: 'radio', class: 'theme-opt', 'data-theme-id': o.id, 'aria-label': o.label, title: o.label,
  }, icon(o.icon)));
  const paint = () => radios.forEach((r) => {
    const on = r.dataset.themeId === current;
    r.setAttribute('aria-checked', String(on));
    r.tabIndex = on ? 0 : -1;
  });
  const choose = (id, { focus = false } = {}) => {
    withTransition(() => { applyTheme(root, id); });
    saveTheme(storage, id);
    current = id;
    paint();
    if (focus) radios.find((r) => r.dataset.themeId === id)?.focus();
    document.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
  };
  const group = h('div', { class: 'theme-seg', role: 'radiogroup', 'aria-label': 'Theme' }, radios);
  group.addEventListener('click', (ev) => { const r = ev.target.closest('[role=radio]'); if (r) choose(r.dataset.themeId); });
  group.addEventListener('keydown', (ev) => {
    const i = radios.indexOf(document.activeElement);
    const n = nextThemeIndex(ev.key, i, radios.length);
    if (n === null || i < 0) return;
    ev.preventDefault();
    choose(radios[n].dataset.themeId, { focus: true });
  });
  const onOther = (ev) => { if (ev.detail !== current) { current = ev.detail; paint(); } };
  document.addEventListener(EVENT, onOther);
  applyTheme(root, current);
  paint();
  container.replaceChildren(group);
  return { destroy: () => { document.removeEventListener(EVENT, onOther); container.replaceChildren(); } };
};
