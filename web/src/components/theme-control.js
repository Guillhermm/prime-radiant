import { THEMES, browserStorage, loadTheme, saveTheme, applyTheme } from '../theme.js';
import { h } from './h.js';

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

export const themeOptions = (current) => THEMES.map((id) => ({ id, label: LABELS[id], selected: id === current }));

/** mount(container, deps). deps: optional `storage`, `root` (defaults: localStorage, <html>). */
export const mount = (container, deps = {}) => {
  const storage = deps.storage ?? browserStorage();
  const root = deps.root ?? document.documentElement;
  const current = loadTheme(storage);
  const select = h('select', { id: 'theme-select', class: 'theme-select' },
    themeOptions(current).map((o) => h('option', { value: o.id, selected: o.selected }, o.label)));
  select.addEventListener('change', () => {
    applyTheme(root, select.value);
    saveTheme(storage, select.value);
  });
  applyTheme(root, current);
  container.replaceChildren(h('div', { class: 'theme-control' }, h('label', { for: 'theme-select' }, 'Theme'), select));
  return { destroy: () => container.replaceChildren() };
};
