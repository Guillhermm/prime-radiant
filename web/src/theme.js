export const THEMES = ['system', 'light', 'dark'];
export const THEME_KEY = 'pr-theme';

export const normalizeTheme = (value) => (THEMES.includes(value) ? value : 'system');

// Reading window.localStorage itself throws when site data is blocked; the theme then lasts for the page only.
export const browserStorage = (get = () => globalThis.localStorage) => {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
};

export const loadTheme = (storage) => {
  try {
    return normalizeTheme(storage?.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
};

// Returns false when the browser refuses to store (private mode, blocked site data).
export const saveTheme = (storage, theme) => {
  try {
    if (theme === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, normalizeTheme(theme));
    return true;
  } catch {
    return false;
  }
};

// "system" leaves data-theme off so the prefers-color-scheme rules in tokens.css decide.
export const applyTheme = (root, theme) => {
  const t = normalizeTheme(theme);
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  return t;
};
