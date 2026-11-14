import { enabledViews } from '../views.js';
import { h } from './h.js';
import { icon, mark } from './icons.js';

export const tabsModel = (views, activeId) => enabledViews(views)
  .map((v) => ({ id: v.id, label: v.label, selected: v.id === activeId }));

// Index of the tab to focus after a key, or null when the key is not a tab key.
export const nextTabIndex = (key, index, count) => {
  if (count <= 0) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
};

export const viewTitle = (views, activeId) => {
  const v = enabledViews(views).find((x) => x.id === activeId);
  return v ? `${v.label} - Prime Radiant` : 'Prime Radiant';
};

const EYEBROWS = { calendar: 'Burning activity calendar', sensors: 'Sensors', anomalies: 'Anomalies', live: 'Live' };
const sameBbox = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// Text of the page hero: the area's name (the matching example area, else "Custom area") and the period.
export const heroModel = ({ view, bbox, from, to }, { presets = [], span = null } = {}) => {
  const f = from ?? span?.from;
  const t = to ?? span?.to;
  const preset = bbox ? presets.find((p) => sameBbox(p.bbox, bbox)) : null;
  let subtitle = 'Pick an example area or enter coordinates.';
  if (bbox) subtitle = f && t ? `Fire-cell-days per month, ${f} to ${t}.` : '';
  return {
    eyebrow: EYEBROWS[view] ?? 'Prime Radiant',
    title: bbox ? (preset?.label ?? 'Custom area') : 'Choose an area',
    subtitle,
  };
};

// One result group per view; a disabled view's group stays hidden.
export const GROUP_IDS = ['calendar', 'sensors', 'anomalies', 'live'];

// NOTICE and LICENSE live in the repo root and are not deployed (.vercelignore), so they are
// plain text here, not links.
export const FOOTER = {
  name: 'Prime Radiant',
  tagline: 'One fire calendar from two satellite records: MODIS since 2000 and VIIRS since 2012, harmonized month by month.',
  event: 'Made for the NASA Space Apps Challenge 2026.',
  authors: [
    { name: 'Guilherme Almeida Zeni', href: 'https://github.com/Guillhermm' },
    { name: 'Kauê Melo', href: 'https://github.com/kauemelo01' },
  ],
  rights: '© 2026 Guilherme Almeida Zeni and Kauê Melo. Licensed under Apache-2.0.',
  attributions: [
    'Fire data: NASA FIRMS (LANCE, ESDIS), provided as is.',
    'Map: © OpenStreetMap contributors.',
    'Leaflet (BSD-2-Clause). Fira Sans and Fira Code (SIL Open Font License). Details in NOTICE.',
  ],
  links: [
    { text: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/' },
    { text: 'OpenStreetMap copyright', href: 'https://www.openstreetmap.org/copyright' },
  ],
};

export const VIEW_ICONS = { calendar: 'calendarView', sensors: 'sensors', anomalies: 'anomalies', live: 'live' };

const footerEl = (slots) => h('footer', { class: 'site-footer' },
  h('div', { class: 'foot-brand' },
    h('p', { class: 'footer-name' }, mark('mark mark-sm'), FOOTER.name),
    h('p', { text: FOOTER.tagline }), h('p', { text: FOOTER.event })),
  h('div', {}, h('h2', { class: 'foot-h', text: 'Made by' }), h('ul', { class: 'footer-authors' }, FOOTER.authors.map((a) => h('li', {}, h('a', { href: a.href, rel: 'noopener noreferrer', target: '_blank', text: a.name }))))),
  h('div', {}, h('h2', { class: 'foot-h', text: 'Data and credits' }),
    h('ul', { class: 'footer-attributions' }, FOOTER.attributions.map((a) => h('li', { text: a }))),
    h('p', { class: 'foot-links' }, FOOTER.links.map((l) => h('a', { href: l.href, rel: 'noopener noreferrer', target: '_blank', text: l.text })))),
  h('div', { class: 'foot-bottom' },
    h('p', { class: 'footer-rights', text: FOOTER.rights }), slots.version, slots.install, slots.themeFoot));

// Builds the page frame and returns the named slots other components mount into.
export const mount = (container, { views, activeView, onView, previewIds = [], synthetic = false }) => {
  const tabs = tabsModel(views, activeView);
  const tabEls = tabs.map((t) => h('button', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'main-view', 'data-view': t.id, class: 'tab',
  }, h('span', { class: 'tab-ic' }, icon(VIEW_ICONS[t.id] ?? 'calendarView')),
  h('span', { class: 'tab-dot', hidden: true, 'aria-hidden': 'true' }),
  h('span', { class: 'tab-label', text: t.label }),
  previewIds.includes(t.id) ? h('span', { class: 'tab-tag', text: 'preview' }) : null,
  h('span', { class: 'tab-dot-text sr-only' })));
  // One view needs no switcher; the bar comes back when a second view is enabled.
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views', hidden: tabEls.length < 2 }, tabEls);
  tablist.addEventListener('click', (e) => {
    const b = e.target.closest('[role=tab]');
    if (b) onView(b.dataset.view);
  });
  tablist.addEventListener('keydown', (e) => {
    const i = tabEls.indexOf(document.activeElement);
    const n = nextTabIndex(e.key, i, tabEls.length);
    if (n === null || i < 0) return;
    e.preventDefault();
    tabEls[n].focus();
    onView(tabEls[n].dataset.view);
  });

  const slot = (name, tag = 'div', attrs = {}) => h(tag, { 'data-slot': name, ...attrs });
  const slots = {
    synthetic: slot('synthetic'),
    synthTag: slot('synth-tag', 'span'),
    offline: slot('offline', 'span'),
    method: slot('method', 'span'),
    export: slot('export', 'span'),
    themeFoot: slot('theme-foot', 'span'),
    install: slot('install', 'span'),
    version: slot('version', 'p', { class: 'foot-version mono' }),
    query: slot('query', 'div', { class: 'query-bar' }),
    verdict: slot('verdict'),
    caveat: slot('caveat', 'section', { class: 'caveat', 'aria-label': 'Caveats' }),
    empty: slot('empty', 'div', { class: 'empty' }),
    calendar: slot('calendar'),
    sensors: slot('sensors'),
    anomalies: slot('anomalies'),
    live: slot('live'),
    detail: slot('detail', 'aside', { class: 'panel-host' }),
    drawer: slot('drawer'),
    map: slot('map'),
  };
  const groupSlots = { calendar: [slots.calendar], sensors: [slots.sensors], anomalies: [slots.anomalies], live: [slots.live] };
  const groups = Object.fromEntries(GROUP_IDS.map((id) => [id, h('div', { class: `view-${id}`, 'data-for': id }, groupSlots[id])]));
  const main = h('main', { id: 'main-view', role: 'tabpanel', tabindex: '-1' }, slots.empty, Object.values(groups));

  const heroEyebrow = h('p', { class: 'eyebrow' });
  const heroTitle = h('h1');
  const context = h('section', { class: 'context', 'aria-label': 'Area and period' },
    h('div', { class: 'context-title' }, heroEyebrow, heroTitle), slots.query);
  container.append(
    h('a', { class: 'skip-link', href: '#main-view' }, 'Skip to main view'),
    slots.synthetic,
    h('header', { class: 'topbar' },
      // An empty hash is the first-run view: the hashchange listener clears the area.
      h('a', { class: 'brand', href: '#', 'aria-label': 'Prime Radiant, home' }, mark('mark brand-mark'), h('span', { text: 'Prime Radiant' })), tablist,
      h('div', { class: 'topbar-actions' }, slots.offline, slots.synthTag, slots.method, slots.export)),
    h('div', { class: 'page' },
      h('div', { class: 'main-col' }, context, slots.verdict, slots.caveat, main, footerEl(slots)),
      slots.detail),
    slots.drawer);

  return {
    slots,
    groups: Object.values(groups),
    /** A small dot on a tab, with `label` for screen readers; label null removes it. */
    setTabDot(id, label) {
      const tab = tabEls.find((el) => el.dataset.view === id);
      if (!tab) return;
      tab.querySelector('.tab-dot').hidden = !label;
      tab.querySelector('.tab-dot-text').textContent = label ? `, ${label}` : '';
    },
    context,
    // hasArea=false shows the empty state and hides the data groups.
    update({ view, hasArea, hero = null }) {
      if (hero) {
        heroEyebrow.textContent = hero.eyebrow;
        heroTitle.textContent = hero.title;
      }
      tabEls.forEach((el) => {
        const on = el.dataset.view === view;
        el.setAttribute('aria-selected', String(on));
        el.tabIndex = on ? 0 : -1;
      });
      main.setAttribute('aria-labelledby', `tab-${view}`);
      // The context stays rendered on first run: it holds the area form the hero buttons open. CSS hides its title and chips.
      slots.empty.hidden = hasArea;
      for (const [id, el] of Object.entries(groups)) el.hidden = !hasArea || view !== id;
      document.title = (synthetic ? 'Synthetic data: ' : '') + viewTitle(views, view);
      document.documentElement.classList.toggle('is-first-run', !hasArea);
    },
  };
};
