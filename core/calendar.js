import { addMonths } from './months.js';
import { supplier, isPartial } from './partial.js';
import { anomaly, yearRank } from './anomaly.js';

const NOT_ENOUGH_HISTORY = 'not enough history';
const ERA_MODIS = 'MODIS x R';
const ERA_SNPP = 'S-NPP';
const ERA_NOAA20 = 'NOAA-20 x K';

/**
 * Calendar view-model: one CalendarCell per month of the harmonized series.
 *
 * status: `no-data` when the value is null (never merged with 0); `partial` when the month is
 * still filling or in the partial_months of the sensor that supplies it (value kept); else
 * `harmonized` for estimated months and `observed` for the rest. `estimated` is the series
 * flag. `flags` lists the reason ids that apply to the month (`terra-only`, `viirs-not-archived`,
 * `outside-domain`, `partial-domain`, `low-confidence` on estimated cells), so a no-data cell
 * can say why. `median` is the baseline value (null when there is not enough history), only
 * present when a baseline is given.
 *
 * @param {import('./index.js').Harmonized} harmonized result of harmonize()
 * @param {import('./index.js').Baseline|null} [base] baseline of the same series
 * @param {object} [manifest] validated manifest (coverage, partial_months, generated_at)
 * @returns {import('./index.js').CalendarCell[]}
 */
export function toCalendar(harmonized, base, manifest) {
  const { series } = harmonized;
  const flags = series.flags ?? [];
  return series.values.map((value, i) => {
    const ym = addMonths(series.start, i);
    const mine = flags.filter((f) => f.month === ym || f.month === null);
    const estimated = value !== null && mine.some((f) => f.month === ym && f.flag === 'estimated');
    const ids = [...new Set(mine.map((f) => f.flag))].filter((id) => id !== 'estimated' && (id !== 'low-confidence' || estimated));
    const partial = value !== null && isPartial(ym, supplier(ym, estimated, manifest), manifest);
    const cell = {
      year: Number(ym.slice(0, 4)), month: Number(ym.slice(5)), value,
      status: value === null ? 'no-data' : partial ? 'partial' : estimated ? 'harmonized' : 'observed',
      estimated, flags: ids,
    };
    if (base) cell.median = base.series.values[i] ?? null;
    return cell;
  });
}

const pickRatio = (r) => (r ? {
  value: r.value, ci: r.ci, level: r.level, usable: r.usable, nYears: r.nYears,
  ...(r.window ? { window: r.window } : {}),
  ...(r.perMonth ? { perMonth: r.perMonth.map((m) => m.value) } : {}),
} : null);

/**
 * KPI strip model for the months `from`..`to` (inclusive "YYYY-MM", clipped to the series).
 * Every number is read from the series: `total` sums the non-null values in range (null when
 * none), `latest` is the last month in range already in the archive (month <= manifest
 * last_month) with its value, status and flags, `median`/`yearsUsed` are the baseline of that
 * month (null and `medianReason` "not enough history" when it has none). `R` and `K` carry the
 * point value (pooled), the twelve per-month values when per-month applies, the window, CI, fallback level, usability and years used. `era` lists, oldest first, the
 * sources of the months with a value: 'MODIS x R', 'S-NPP', 'NOAA-20 x K'. `flags` counts the
 * months in range carrying each reason flag.
 *
 * `anomaly` (anomaly.js): `flagged` months in range (rule and single-sensor confirmation, anomaly.js; pass `range.sensors` = {modis, viirs} raw Series, else none confirm), `crossEra` months in range that pass the rule but not the confirmation, `yearRank` {year, rank, n} of the latest complete
 * year (null without one; `rank` is null with `rankRange` [best, worst] and `reason` when observed and scaled totals disagree), `excludedYears` [{year, reason}] the years left out of the ranking, `latest` {month, rank, flagged} of the latest archived month in range.
 *
 * @param {import('./index.js').Harmonized} harmonized result of harmonize()
 * @param {import('./index.js').Baseline|null} base
 * @param {object} manifest
 * @param {{from?: string, to?: string, sensors?: {modis?: object, viirs?: object}}} [range] defaults to the whole series
 */
export function kpis(harmonized, base, manifest, { from, to, sensors } = {}) {
  const { series } = harmonized;
  const cells = toCalendar(harmonized, base, manifest);
  const months = cells.map((_, i) => addMonths(series.start, i));
  const lo = from ?? months[0];
  const hi = to ?? months[months.length - 1];
  const idx = months.map((m, i) => (m >= lo && m <= hi ? i : -1)).filter((i) => i >= 0);
  const archived = idx.filter((i) => !manifest?.last_month || months[i] <= manifest.last_month);
  const li = archived.length ? archived[archived.length - 1] : -1;

  const withValue = idx.filter((i) => cells[i].value !== null);
  const total = withValue.length ? withValue.reduce((s, i) => s + cells[i].value, 0) : null;

  const era = [];
  for (const i of withValue) {
    const ym = months[i];
    const e = !cells[i].estimated ? ERA_SNPP : supplier(ym, true, manifest) === 'noaa20' && harmonized.K ? ERA_NOAA20 : ERA_MODIS;
    if (!era.includes(e)) era.push(e);
  }

  const flags = {};
  for (const i of idx) for (const f of cells[i].flags) flags[f] = (flags[f] ?? 0) + 1;

  const hasMedian = li >= 0 && base && base.series.values[li] !== null && base.series.values[li] !== undefined;
  const c = li >= 0 ? cells[li] : null;
  const an = anomaly(harmonized, manifest, { sensors });
  const yr = yearRank(harmonized, manifest);
  const last = yr.years[yr.years.length - 1];
  return {
    range: { from: lo, to: hi },
    total,
    latest: c && { year: c.year, month: c.month, value: c.value, status: c.status, estimated: c.estimated, flags: c.flags },
    median: hasMedian ? base.series.values[li] : null,
    yearsUsed: hasMedian ? base.yearsUsed[li] : null,
    ...(hasMedian ? {} : { medianReason: NOT_ENOUGH_HISTORY }),
    R: pickRatio(harmonized.R),
    K: pickRatio(harmonized.K),
    era,
    flags,
    anomaly: {
      flagged: idx.filter((i) => an.flags[i]).length,
      crossEra: idx.filter((i) => an.labels[i].includes('cross-era')).length,
      yearRank: last ? { year: last.year, rank: last.rank, ...(last.rankRange ? { rankRange: last.rankRange, reason: last.reason } : {}), n: yr.n } : null,
      excludedYears: yr.excluded, // {year, reason}: why a year has no rank (gate V2 reviews the rule)
      latest: li >= 0 ? { month: months[li], rank: an.values[li], flagged: an.flags[li] } : null,
    },
    method: series.method,
  };
}
