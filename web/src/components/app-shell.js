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

// Builds the page frame and returns the named slots other components mount into.
export const mount = (container, { views, activeView, onView }) => {
  const tabs = tabsModel(views, activeView);
  const tabEls = tabs.map((t) => h('button', {
    type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'main-view', 'data-view': t.id, class: 'tab',
  }, t.label));
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
    query: slot('query', 'section', { class: 'query-bar', 'aria-label': 'Query bar' }),
    caveat: slot('caveat', 'section', { class: 'caveat', 'aria-label': 'Caveats' }),
    empty: slot('empty', 'div', { class: 'empty' }),
    kpi: slot('kpi'),
    calendar: slot('calendar'),
    legend: slot('legend'),
    table: slot('table'),
    sensors: slot('sensors'),
    detail: slot('detail', 'aside', { class: 'detail', 'aria-label': 'Cell detail' }),
    drawer: slot('drawer'),
    map: slot('map'),
  };
  const calendarGroup = h('div', { class: 'view-calendar', 'data-for': 'calendar' }, slots.kpi, slots.calendar, slots.legend, slots.table);
  const sensorsGroup = h('div', { class: 'view-sensors', 'data-for': 'sensors' }, slots.sensors);
  const main = h('main', { id: 'main-view', role: 'tabpanel', tabindex: '-1' }, slots.empty, calendarGroup, sensorsGroup);

  container.append(
    h('a', { class: 'skip-link', href: '#main-view' }, 'Skip to main view'),
    h('header', { class: 'topbar' },
      h('h1', {}, 'Prime Radiant'), tablist, selectWrap,
      h('div', { class: 'topbar-actions' }, slots.method, slots.export)),
    slots.query, slots.map, slots.caveat,
    h('div', { class: 'content' }, main, slots.detail),
    slots.drawer);

  return {
    slots,
    // hasArea=false shows the empty state and hides the data groups.
    update({ view, hasArea }) {
      tabEls.forEach((el) => {
        const on = el.dataset.view === view;
        el.setAttribute('aria-selected', String(on));
        el.tabIndex = on ? 0 : -1;
      });
      select.value = view;
      main.setAttribute('aria-labelledby', `tab-${view}`);
      slots.empty.hidden = hasArea;
      calendarGroup.hidden = !hasArea || view !== 'calendar';
      sensorsGroup.hidden = !hasArea || view !== 'sensors';
      document.title = viewTitle(views, view);
    },
  };
};
