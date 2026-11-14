import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOOTER, GROUP_IDS, VIEW_ICONS, heroModel, tabsModel, nextTabIndex, viewTitle } from './app-shell.js';
import { ICON_NAMES } from './icons.js';
import { VIEWS } from '../views.js';

test('disabled views are absent from the tabs', () => {
  assert.deepEqual(tabsModel(VIEWS, 'sensors').map((t) => [t.id, t.selected]), [['calendar', false], ['sensors', true]]);
});

test('tab keys wrap and ignore others', () => {
  assert.equal(nextTabIndex('ArrowRight', 1, 2), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 2), 1);
  assert.equal(nextTabIndex('Home', 1, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('a', 0, 2), null);
  assert.equal(nextTabIndex('Home', 0, 0), null);
});

test('title names the view', () => {
  assert.equal(viewTitle(VIEWS, 'calendar'), 'Calendar - Prime Radiant');
  assert.equal(viewTitle(VIEWS, 'live'), 'Prime Radiant');
});

test('the shell has a result group for every view', () => {
  assert.deepEqual(GROUP_IDS, VIEWS.map((v) => v.id));
});

test('hero names the matching example area and the period', () => {
  const presets = [{ id: 'p', label: 'Pantanal', bbox: [-58, -20, -55, -17] }];
  const h = heroModel({ view: 'calendar', bbox: [-58, -20, -55, -17], from: '2012-01', to: null }, { presets, span: { from: '2000-11', to: '2025-12' } });
  assert.deepEqual(h, { eyebrow: 'Burning activity calendar', title: 'Pantanal', subtitle: 'Fire-cell-days per month, 2012-01 to 2025-12.' });
});

test('hero falls back to a custom area and to a prompt without an area', () => {
  assert.equal(heroModel({ view: 'live', bbox: [1, 2, 3, 4] }, { presets: [] }).title, 'Custom area');
  const none = heroModel({ view: 'calendar', bbox: null });
  assert.equal(none.title, 'Choose an area');
  assert.match(none.subtitle, /example area/);
});

test('footer names the authors with accents, the Apache-2.0 notice and the three attributions, never "all rights reserved"', () => {
  assert.deepEqual(FOOTER.authors, ['Guilherme Almeida Zeni', 'Kauê Melo']);
  assert.match(FOOTER.rights, /^© 2026 .*Apache-2\.0\.$/);
  assert.doesNotMatch(JSON.stringify(FOOTER), /all rights reserved/i);
  assert.equal(FOOTER.attributions.length, 3);
  assert.ok(FOOTER.attributions.some((a) => a.includes('OpenStreetMap contributors')));
});

test('every view has a bottom-bar icon and the footer links are https', () => {
  assert.ok(VIEWS.every((v) => ICON_NAMES.includes(VIEW_ICONS[v.id])));
  assert.ok(FOOTER.links.every((l) => l.href.startsWith('https://')));
  assert.match(FOOTER.tagline, /MODIS since 2000 and VIIRS since 2012/);
});
