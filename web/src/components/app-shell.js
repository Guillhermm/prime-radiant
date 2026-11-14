import { enabledViews } from '../views.js';
import { h } from './h.js';

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

// Placeholder copy until the designer's pass. NOTICE and LICENSE live in the repo root and are not
// deployed (.vercelignore), so they are plain text here, not links.
export const FOOTER = {
  name: 'Prime Radiant',
  authors: ['Guilherme Almeida Zeni', 'Kauê Melo'],
  rights: '© 2026 Guilherme Almeida Zeni and Kauê Melo. Prime Radiant, Apache-2.0.',
  attributions: [
    'Fire data: NASA FIRMS (LANCE, ESDIS), provided as is.',
    'Map: © OpenStreetMap contributors.',
    'Leaflet and Fira fonts: see NOTICE.',
  ],
};

const footerEl = () => h('footer', { class: 'site-footer' },
  h('p', { class: 'footer-name', text: FOOTER.name }),
  h('p', { class: 'footer-authors', text: FOOTER.authors.join(', ') }),
  h('p', { class: 'footer-rights', text: FOOTER.rights }),
  h('ul', { class: 'footer-attributions' }, FOOTER.attributions.map((a) => h('li', { text: a }))));

// Builds the page frame and returns the named slots other components mount into.
export const mount = (container, { views, activeView, onView, previewIds = [] }) => {
  const tabs = tabsModel(views, activeView);
  const tabEls = tabs.map((t) => h('button', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'main-view', 'data-view': t.id, class: 'tab',
  }, t.label, previewIds.includes(t.id) ? h('span', { class: 'tab-tag', text: 'preview' }) : null));
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tabEls);
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

  const select = h('select', { id: 'view-select', onchange: (e) => onView(e.target.value) },
    tabs.map((t) => h('option', { value: t.id }, t.label)));
  const selectWrap = h('div', { class: 'view-select' }, h('label', { for: 'view-select' }, 'View'), select);

  const slot = (name, tag = 'div', attrs = {}) => h(tag, { 'data-slot': name, ...attrs });
  const slots = {
    method: slot('method', 'span'),
    export: slot('export', 'span'),
    theme: slot('theme', 'span'),
    query: slot('query', 'section', { class: 'query-bar', 'aria-label': 'Query bar' }),
    caveat: slot('caveat', 'section', { class: 'caveat', 'aria-label': 'Caveats' }),
    empty: slot('empty', 'div', { class: 'empty' }),
    kpi: slot('kpi'),
    calendar: slot('calendar'),
    legend: slot('legend'),
    table: slot('table'),
    sensors: slot('sensors'),
    anomalies: slot('anomalies'),
    live: slot('live'),
    detail: slot('detail', 'aside', { class: 'detail', 'aria-label': 'Cell detail' }),
    drawer: slot('drawer'),
    map: slot('map'),
  };
  const groupSlots = { calendar: [slots.kpi, slots.calendar, slots.legend, slots.table], sensors: [slots.sensors], anomalies: [slots.anomalies], live: [slots.live] };
  const groups = Object.fromEntries(GROUP_IDS.map((id) => [id, h('div', { class: `view-${id}`, 'data-for': id }, groupSlots[id])]));
  const main = h('main', { id: 'main-view', role: 'tabpanel', tabindex: '-1' }, slots.empty, Object.values(groups));

  const heroEyebrow = h('p', { class: 'eyebrow' });
  const heroTitle = h('h1');
  const heroSub = h('p', { class: 'hero-sub' });
  container.append(
    h('a', { class: 'skip-link', href: '#main-view' }, 'Skip to main view'),
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Prime Radiant'), tablist, selectWrap,
      h('div', { class: 'topbar-actions' }, slots.theme, slots.method, slots.export)),
    h('div', { class: 'page' },
      h('div', { class: 'hero' }, heroEyebrow, heroTitle, heroSub),
      slots.query, slots.map, slots.caveat,
      h('div', { class: 'content' }, main, slots.detail)),
    footerEl(),
    slots.drawer);

  return {
    slots,
    groups: Object.values(groups),
    // hasArea=false shows the empty state and hides the data groups.
    update({ view, hasArea, hero = null }) {
      if (hero) {
        heroEyebrow.textContent = hero.eyebrow;
        heroTitle.textContent = hero.title;
        heroSub.textContent = hero.subtitle;
      }
      tabEls.forEach((el) => {
        const on = el.dataset.view === view;
        el.setAttribute('aria-selected', String(on));
        el.tabIndex = on ? 0 : -1;
      });
      select.value = view;
      main.setAttribute('aria-labelledby', `tab-${view}`);
      slots.empty.hidden = hasArea;
      for (const [id, el] of Object.entries(groups)) el.hidden = !hasArea || view !== id;
      document.title = viewTitle(views, view);
    },
  };
};
