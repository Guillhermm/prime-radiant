import { MONTH_ABBR, formatCount } from '../format.js';
import { h } from './h.js';

const inRange = (ym, [from, to]) => ym >= from && ym <= to;

/** Sensors operating in month `ym` ("YYYY-MM") given manifest `coverage`: "MODIS+VIIRS", "MODIS", "VIIRS" or null. */
export const sensorEra = (coverage, ym) => {
  const on = ['modis', 'viirs'].filter((s) => coverage?.[s] && inRange(ym, coverage[s]));
  return on.length ? on.map((s) => s.toUpperCase()).join('+') : null;
};

const pct = (value, median) => {
  if (median === 0) return value === 0 ? 'equal to the median' : 'median is 0';
  const p = Math.round(((value - median) / median) * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
};

/**
 * Three cards: current month vs median, total in range, sensor era.
 * @param {object[]} cells CalendarCell list in time order; the last one is the current month
 * @param {{total: number}} k core.kpis output
 * @param {{coverage?: object, yearsUsed?: number|null}} [opts] manifest coverage; years behind the median
 */
export const kpiCards = (cells, k, { coverage, yearsUsed = null } = {}) => {
  const last = cells[cells.length - 1];
  const cards = [];
  if (last) {
    const title = `${MONTH_ABBR[last.month - 1]} ${last.year} vs median${last.status === 'partial' ? ' (partial month)' : ''}`;
    if (last.value === null) {
      cards.push({ id: 'current', title, value: 'No data', note: 'Sensor not operating this month' });
    } else {
      const hasMedian = typeof last.median === 'number';
      const years = hasMedian && yearsUsed ? ` of ${yearsUsed} yrs` : '';
      cards.push({
        id: 'current',
        title,
        value: formatCount(last.value),
        delta: hasMedian ? pct(last.value, last.median) : null,
        note: hasMedian ? `median${years}: ${formatCount(last.median)}` : 'Not enough history for a median',
      });
    }
  }
  const withData = cells.filter((c) => c.value !== null).length;
  const total = { id: 'total', title: 'Total in range', value: withData === 0 ? 'No data' : formatCount(k.total) };
  if (withData > 0) total.note = k.total === 0 ? 'No hotspots detected, sensors were operating' : 'fire-cell-days';
  cards.push(total);
  const era = last && coverage ? sensorEra(coverage, `${last.year}-${String(last.month).padStart(2, '0')}`) : null;
  cards.push({ id: 'era', title: 'Sensor era', value: era ?? 'No sensor', note: 'at the latest month in range' });
  return cards;
};

/**
 * mount(container, {cells, kpis, coverage, yearsUsed}); returns {update(next), destroy()}.
 * On phone the cards scroll sideways with snap and the prev/next buttons.
 */
export const mount = (container, deps) => {
  const render = (d) => {
    const cards = kpiCards(d.cells, d.kpis, d).map((c) => h('div', { class: 'kpi-card', 'data-kpi': c.id },
      h('p', { class: 'kpi-title', text: c.title }),
      h('p', { class: 'kpi-value' }, h('span', { text: c.value }), c.delta ? h('span', { class: 'kpi-delta', text: ` ${c.delta}` }) : null),
      c.note ? h('p', { class: 'kpi-note', text: c.note }) : null));
    const list = h('div', { class: 'kpi-list' }, cards);
    const step = (dir) => () => list.scrollBy({ left: dir * list.clientWidth, behavior: 'auto' });
    container.replaceChildren(h('div', { class: 'kpi-strip', role: 'region', 'aria-label': 'Key figures' },
      h('button', { type: 'button', class: 'kpi-nav kpi-prev', 'aria-label': 'Previous figure', text: '‹' }),
      list,
      h('button', { type: 'button', class: 'kpi-nav kpi-next', 'aria-label': 'Next figure', text: '›' })));
    const [prev, next] = container.querySelectorAll('.kpi-nav');
    prev.addEventListener('click', step(-1));
    next.addEventListener('click', step(1));
  };
  render(deps);
  return { update: (next) => render({ ...deps, ...next }), destroy: () => container.replaceChildren() };
};
