import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_KEY, browserStorage, normalizeTheme, loadTheme, saveTheme, applyTheme } from './theme.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
};
const root = () => {
  const attrs = new Map();
  return { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), attrs };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };

test('normalizeTheme accepts the three choices and falls back to system', () => {
  for (const t of THEMES) assert.equal(normalizeTheme(t), t);
  for (const bad of ['', 'sepia', null, undefined, 3]) assert.equal(normalizeTheme(bad), 'system');
});

test('save then load round-trips; system clears the stored key', () => {
  const s = memory();
  assert.equal(saveTheme(s, 'dark'), true);
  assert.equal(loadTheme(s), 'dark');
  saveTheme(s, 'system');
  assert.equal(s.m.has(THEME_KEY), false);
  assert.equal(loadTheme(s), 'system');
});

test('a tampered stored value reads as system', () => {
  const s = memory();
  s.setItem(THEME_KEY, '<script>');
  assert.equal(loadTheme(s), 'system');
});

test('blocked storage never throws: load is system, save reports false', () => {
  assert.equal(loadTheme(blocked), 'system');
  assert.equal(saveTheme(blocked, 'light'), false);
  assert.equal(loadTheme(undefined), 'system');
});

test('applyTheme sets data-theme for light and dark and removes it for system', () => {
  const r = root();
  assert.equal(applyTheme(r, 'dark'), 'dark');
  assert.equal(r.attrs.get('data-theme'), 'dark');
  applyTheme(r, 'light');
  assert.equal(r.attrs.get('data-theme'), 'light');
  applyTheme(r, 'system');
  assert.equal(r.attrs.has('data-theme'), false);
});

test('the early-apply script uses the same key and the same values as the module', () => {
  const src = readFileSync(new URL('../theme-init.js', import.meta.url), 'utf8');
  assert.ok(src.includes(`'${THEME_KEY}'`));
  for (const t of THEMES.filter((x) => x !== 'system')) assert.ok(src.includes(`'${t}'`));
});

test('browserStorage returns null instead of throwing when site data is blocked', () => {
  assert.equal(browserStorage(() => { throw new DOMException('denied', 'SecurityError'); }), null);
  const s = {};
  assert.equal(browserStorage(() => s), s);
  assert.equal(saveTheme(null, 'dark'), false);
  assert.equal(loadTheme(null), 'system');
});
