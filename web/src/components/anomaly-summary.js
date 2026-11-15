import { flaggedPeriods, flagRuleText } from '../../../core/periods.js';
import { addMonths } from '../../../core/months.js';
import { MONTH_ABBR, formatCount, monthLabel } from '../format.js';
import { ordinal } from './anomaly-layer.js';
import { h } from './h.js';
import { icon } from './icons.js';

const SENSOR_NAMES = { modis: 'MODIS', viirs: 'VIIRS' };
// Flag explanations that only exist because of the anomaly rule; the rest of the flag items describe counts.
const ANOMALY_FLAG_IDS = new Set(['cross-era', 'unconfirmed', 'sparse-baseline']);

const ymOf = (s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) });
const abbr = ({ year, month }) => `${MONTH_ABBR[month - 1]} ${year}`;

/** core's flaggedPeriods over the months from..to (inclusive, null = open), newest first. */
export const periodsInRange = (series, from = null, to = null) => {
  if (!series) return [];
  const months = series.values.map((_, i) => addMonths(series.start, i));
  const keep = months.map((m) => (!from || m >= from) && (!to || m <= to));
  const first = keep.indexOf(true);
  if (first < 0) return [];
  const cut = (a) => (a ?? []).slice(first, keep.lastIndexOf(true) + 1);
  return flaggedPeriods({ start: months[first], values: cut(series.values), flags: cut(series.flags), confirmedBy: cut(series.confirmedBy) }).reverse();
};

/** "Dec 2011", "Aug–Oct 2019" or "Dec 2018–Feb 2019". */
export const periodLabel = (p) => {
  const a = ymOf(p.from);
  const b = ymOf(p.to);
  if (p.from === p.to) return abbr(a);
  if (a.year === b.year) return `${MONTH_ABBR[a.month - 1]}–${abbr(b)}`;
  return `${abbr(a)}–${abbr(b)}`;
};

const peakText = (rank) => {
  if (typeof rank !== 'number') return null;
  return rank === 1 ? 'record high' : `peak ${ordinal(Math.round(rank * 100))} percentile`;
};

/** One row of the list: what the button says, its accessible name, and the cell it selects. */
export const periodModel = (p) => {
  const a = ymOf(p.from);
  const b = ymOf(p.to);
  const sensors = p.confirmedBy.map((s) => SENSOR_NAMES[s] ?? s);
  const parts = [`${p.months} ${p.months === 1 ? 'month' : 'months'}`, peakText(p.maxRank), sensors.length ? `confirmed on ${sensors.join(' and ')}` : null].filter(Boolean);
  const when = p.from === p.to ? monthLabel(a.year, a.month) : `${monthLabel(a.year, a.month)} to ${monthLabel(b.year, b.month)}`;
  return { label: periodLabel(p), meta: parts.join(' · '), name: [when, ...parts].join(', '), first: a };
};

/**
 * The newest complete year of the range in core's yearRank: "5" or a tied or scaled "5–6",
 * out of how many complete years. null when core ranked no year at all.
 */
export const yearRankModel = (yr, { from = null, to = null } = {}) => {
  if (!yr?.years?.length) return null;
  const lo = from ? Number(from.slice(0, 4)) : -Infinity;
  const hi = to ? Number(to.slice(0, 4)) : Infinity;
  const years = yr.years.map((y) => y.year);
  const of = `of ${yr.n} complete years, ${Math.min(...years)}–${Math.max(...years)}`;
  const y = yr.years.filter((e) => e.year >= lo && e.year <= hi).at(-1);
  if (!y) return { year: null, value: null, of, total: null, note: 'No complete year in this range to rank.' };
  return {
    year: y.year,
    value: y.rank !== null ? String(y.rank) : `${y.rankRange[0]}–${y.rankRange[1]}`,
    of,
    total: `${y.year} had ${formatCount(y.total)} fire-cell-days. Rank 1 is the year with the most.`,
    note: y.rank === null ? `Range: ${y.reason}.` : null,
  };
};

/** core's caveats that explain the ranks and flags, in catalog order. */
export const anomalyCaveats = (caveats = []) => caveats.filter((c) => c.kind === 'anomaly' || ANOMALY_FLAG_IDS.has(c.id));

/** The plain one-line reading of a flag, ahead of the full rule. */
export const FLAG_LEAD = 'Flagged: a record or near-record for that calendar month, confirmed on MODIS or VIIRS alone.';

/** core's rule text with the comparison signs typeset. */
export const flagRule = () => flagRuleText().replaceAll('<=', '≤').replaceAll('>=', '≥');

/** A closed disclosure in the app's style: the summary row with a chevron, the body under it. */
export const disclosure = (summary, ...body) => h('details', { class: 'disclosure' },
  h('summary', {}, h('span', { text: summary }), icon('chevron', 'disclosure-chevron')), ...body);

/** Flagged periods card. onSelect receives {year, month} of a period's first month. */
export const periodsCard = (periods, { onSelect }) => {
  const rows = periods.map(periodModel);
  return h('section', { class: 'card flag-periods', 'aria-labelledby': 'flag-periods-title' },
    h('h2', { id: 'flag-periods-title', text: 'Flagged periods' }),
    h('p', { class: 'sub', text: 'Runs of consecutive flagged months in this range, newest first. Pick one to open its first month.' }),
    rows.length
      ? h('ul', { class: 'period-list' }, rows.map((m) => h('li', {},
        h('button', { type: 'button', class: 'period', 'aria-label': m.name, onclick: () => onSelect(m.first) },
          h('span', { class: 'period-when', text: m.label }), h('span', { class: 'period-meta', text: m.meta })))))
      : h('p', { class: 'period-none', text: 'No month in this range is flagged.' }),
    h('p', { class: 'flag-lead', text: FLAG_LEAD }),
    h('div', { class: 'disclosure-list flag-rule' }, disclosure('How a month is flagged', h('p', { text: flagRule() }))));
};

/** Compact rank card in the facts card's row pattern. */
export const yearRankCard = (m) => h('article', { class: 'card year-rank', 'aria-label': 'Year rank' },
  h('p', { class: 'eyebrow', text: 'Year rank' }),
  m?.year
    ? h('div', { class: 'fact' },
      h('span', { class: 'k', text: `Rank of ${m.year}` }),
      h('span', { class: 'v', text: m.value }),
      h('span', { class: 's', text: m.of }))
    : h('p', { class: 'hint', text: m?.note ?? 'No complete year to rank.' }),
  m?.year ? h('p', { class: 'hint', text: m.total }) : null,
  m?.year && m.note ? h('p', { class: 'hint', text: m.note }) : null);

/** Each caveat as a disclosure: the short line always visible, the full text on open. */
export const caveatList = (list) => [
  h('h2', { text: 'About these ranks' }),
  h('ul', { class: 'caveat-list disclosure-list' }, list.map((c) => h('li', { 'data-caveat': c.id }, disclosure(c.short, h('p', { text: c.long }))))),
];
