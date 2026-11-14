import { MONTH_NAMES, formatCount, monthLabel } from '../format.js';
import { compareToMedian, medianYears, peakMonth, rankSentence, sameMonth, yearTotals } from '../stats.js';
import { h } from './h.js';
import * as radiant from './radiant.js';

export const NO_MEDIAN = 'Not enough history for a median';
export const ZERO_NOTE = 'No hotspots detected; the sensors were operating.';

/**
 * The answer first: the latest month against its median (core.baseline), then plain sums. Every
 * comparison and the peak month carry the Preview tag until the science gate passes.
 * @param {{cells: object[], allCells?: object[], kpis: {total: number}, typical?: object[]}} r
 */
export const verdictModel = ({ cells, allCells = cells, kpis, typical = [] }) => {
  const last = cells[cells.length - 1] ?? null;
  const withData = cells.filter((c) => c.value !== null);
  const allZero = withData.length > 0 && withData.every((c) => c.value === 0);
  let latest = null;
  if (last) {
    const name = MONTH_NAMES[last.month - 1];
    latest = {
      eyebrow: `${monthLabel(last.year, last.month)} · latest month${last.status === 'partial' ? ', partial' : ''}`,
      value: last.value === null ? 'No data' : formatCount(last.value),
      unit: last.value === null ? 'The sensors were not operating this month.' : 'fire-cell-days',
      compare: null,
      versus: null,
      sentence: null,
    };
    const cmp = last.value === null ? null : compareToMedian(last.value, last.median);
    if (cmp) {
      latest.compare = cmp;
      latest.versus = `vs ${name} median ${formatCount(last.median)}`;
      const w = medianYears(allCells, last);
      const rank = rankSentence(sameMonth(cells, last), last.month);
      latest.sentence = [rank, w && `median over ${w.from === w.to ? w.from : `${w.from}–${w.to}`}`].filter(Boolean).join(' · ') || null;
    } else if (last.value !== null) {
      latest.sentence = NO_MEDIAN;
    }
    if (allZero) latest.sentence = ZERO_NOTE;
  }
  const peak = peakMonth(typical);
  const busiest = yearTotals(cells).find((y) => y.busiest) ?? null;
  const facts = [
    {
      id: 'peak', k: 'Peak month', preview: true,
      v: peak ? MONTH_NAMES[peak.month - 1] : 'Not enough history',
      s: peak ? `median ${formatCount(Math.round(peak.median))}, ${peak.from}–${peak.to}` : '',
    },
    { id: 'busiest', k: 'Busiest year', v: busiest ? String(busiest.year) : 'None', s: busiest ? `${formatCount(busiest.total)}${busiest.partial ? ', part of the year' : ''}` : '' },
    {
      id: 'total', k: 'Total in range',
      v: withData.length ? formatCount(kpis.total) : 'No data',
      s: `${cells.length} ${cells.length === 1 ? 'month' : 'months'}${allZero ? ', sensors operating' : ''}`,
    },
  ];
  return { latest, facts };
};

const tag = () => h('span', { class: 'tag', text: 'Preview' });

/**
 * mount(container, {cells, allCells, kpis, typical, aoiCells, onHover(cell|null), onSelect(cell)}).
 * Returns {update(next), select(sel|null), destroy()}.
 */
export const mount = (container, deps) => {
  let d = deps;
  const heroCard = h('article', { class: 'card card-hero', 'aria-label': 'Latest month' });
  const radiantCard = h('article', { class: 'card radiant-card', 'aria-label': 'The Radiant' });
  const factsCard = h('article', { class: 'card facts', 'aria-label': 'Facts in range' });
  container.replaceChildren(h('section', { class: 'verdict', 'aria-label': 'Key figures' }, heroCard, radiantCard, factsCard));

  const radiantDeps = () => ({
    cells: d.cells, aoiCells: d.aoiCells,
    onHover: (c) => d.onHover?.(c), onSelect: (c) => d.onSelect?.(c),
    tooltip: (c) => `${monthLabel(c.year, c.month).replace(/^(\w{3})\w*/, '$1')} · ${formatCount(c.value)}`,
  });
  const miniHost = h('div', { class: 'radiant-mini' });
  const bigHost = h('div', { class: 'radiant-big' });
  const mini = radiant.mount(miniHost, { ...radiantDeps(), labels: false, compact: true });
  const big = radiant.mount(bigHost, radiantDeps());

  const paint = () => {
    const m = verdictModel(d);
    const l = m.latest;
    const hero = l ? [
      h('div', { class: 'hero-row' },
        h('div', {},
          h('p', { class: 'eyebrow', text: l.eyebrow }),
          h('p', { class: 'hero-num', text: l.value }),
          h('p', { class: 'unit-l', text: l.unit })),
        miniHost),
      l.compare && h('p', { class: 'delta' },
        h('span', { class: `pill pill-${l.compare.dir}`, text: l.compare.text }), h('span', { text: l.versus }), tag()),
      l.sentence && h('p', { class: 'delta sub2', text: l.sentence }),
    ] : [h('p', { class: 'eyebrow', text: 'No months in range' })];
    heroCard.replaceChildren(...hero.filter(Boolean));
    radiantCard.replaceChildren(bigHost, h('div', { class: 'radiant-copy' },
      h('p', { class: 'eyebrow', text: 'The Radiant' }),
      h('p', { text: 'Rings are years, the oldest at the center and the newest on the rim. Slices are months.' }),
      h('p', { class: 'hint', text: 'The bright arc is the fire season. Point at a slice to find it in the grid.' })));
    factsCard.replaceChildren(...m.facts.map((f) => h('div', { class: 'fact', 'data-fact': f.id },
      h('span', { class: 'k' }, f.k, f.preview ? tag() : null),
      h('span', { class: 'v', text: f.v }),
      h('span', { class: 's', text: f.s }))));
  };
  paint();
  return {
    update: (next) => {
      d = { ...d, ...next };
      mini.update({ ...radiantDeps(), labels: false, compact: true });
      big.update(radiantDeps());
      paint();
    },
    select: (sel) => { mini.select(sel); big.select(sel); },
    destroy: () => container.replaceChildren(),
  };
};
