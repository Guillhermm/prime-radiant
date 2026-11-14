import { addMonths } from './months.js';
import { KNOWN_PARTIAL_MONTHS } from './baseline.js';

/** Partial MODIS month at the start of the Aqua era (method.md section 3). */
const MODIS_PARTIAL_MONTHS = ['2002-07'];
const NOT_ENOUGH_HISTORY = 'not enough history';
const ERA_MODIS = 'MODIS x R';
const ERA_SNPP = 'S-NPP';
const ERA_NOAA20 = 'NOAA-20 x K';

const inCoverage = (cov, ym) => Array.isArray(cov) && ym >= cov[0] && ym <= cov[1];

/**
 * True when `ym`, the last month of the manifest, is still filling: the archive was generated
 * before that month ended.
 */
function lastMonthIncomplete(ym, manifest) {
  if (!manifest?.last_month || ym !== manifest.last_month || !manifest.generated_at) return false;
  const built = Date.parse(manifest.generated_at);
  const end = Date.parse(`${addMonths(ym, 1)}-01T00:00:00Z`);
  return Number.isFinite(built) && built < end;
}

/**
 * Which sensor supplied month `ym` of the harmonized series, from the manifest coverage
 * (mirrors harmonize.js): 'viirs' when observed, else 'noaa20' after S-NPP ended while NOAA-20
 * covers it, else 'modis'.
 */
function supplier(ym, estimated, manifest) {
  if (!estimated) return 'viirs';
  const sEnd = manifest?.coverage?.viirs?.[1] ?? null;
  return sEnd !== null && ym > sEnd && inCoverage(manifest?.coverage?.noaa20, ym) ? 'noaa20' : 'modis';
}

function isPartial(ym, sensor, manifest) {
  const listed = manifest?.partial_months?.[sensor] ?? [];
  const known = sensor === 'viirs' ? KNOWN_PARTIAL_MONTHS : sensor === 'modis' ? MODIS_PARTIAL_MONTHS : [];
  return listed.includes(ym) || known.includes(ym) || lastMonthIncomplete(ym, manifest);
}

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

const pickRatio = (r) => (r ? { value: r.value, ci: r.ci, level: r.level, usable: r.usable, nYears: r.nYears } : null);

/**
 * KPI strip model for the months `from`..`to` (inclusive "YYYY-MM", clipped to the series).
 * Every number is read from the series: `total` sums the non-null values in range (null when
 * none), `latest` is the last month in range already in the archive (month <= manifest
 * last_month) with its value, status and flags, `median`/`yearsUsed` are the baseline of that
 * month (null and `medianReason` "not enough history" when it has none). `R` and `K` carry the
 * point value, CI, fallback level, usability and years used. `era` lists, oldest first, the
 * sources of the months with a value: 'MODIS x R', 'S-NPP', 'NOAA-20 x K'. `flags` counts the
 * months in range carrying each reason flag.
 *
 * @param {import('./index.js').Harmonized} harmonized result of harmonize()
 * @param {import('./index.js').Baseline|null} base
 * @param {object} manifest
 * @param {{from?: string, to?: string}} [range] defaults to the whole series
 */
export function kpis(harmonized, base, manifest, { from, to } = {}) {
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
    method: series.method,
  };
}
