import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harmonize } from './harmonize.js';
import { validateSeries } from './schema.js';
import { addMonths } from './months.js';

const manifest = (over = {}) => ({
  schema: 1, month0: '2002-01', last_month: '2002-01',
  coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2026-11'], noaa20: ['2018-04', '2030-12'] },
  partial_months: { modis: [], viirs: ['2012-01', '2026-11'], noaa20: [] }, ...over,
});
const series = (id, start, values, flags) => ({
  id, unit: 'fire-cell-days', start, values, method: { id: 'raw', version: 1 }, comparable: false, ...(flags ? { flags } : {}),
});
/** Level from per-month functions over [start, start+len). */
const level = (name, start, len, { m, v, n }) => ({
  level: name,
  modis: series('modis', start, Array.from({ length: len }, (_, i) => m(i, addMonths(start, i)))),
  viirs: series('viirs', start, Array.from({ length: len }, (_, i) => v(i, addMonths(start, i)))),
  ...(n ? { noaa20: series('viirs', start, Array.from({ length: len }, (_, i) => n(i, addMonths(start, i)))) } : {}),
});
const sum = (a) => a.reduce((s, x) => s + (x ?? 0), 0);

// 2011-01..2013-12: S-NPP from 2012-01 (partial), MODIS everywhere
test('R = sum(V)/sum(M) over full overlap months, zero-MODIS months included; partial months excluded', () => {
  const lv = level('aoi', '2012-01', 4, { m: (i) => [9, 0, 2, 1][i], v: (i) => [9, 0, 6, 3][i] });
  const h = harmonize([lv], manifest());
  assert.equal(h.R.value, 3); // 2012-01 partial excluded: V=[0,6,3], M=[0,2,1]
  assert.deepEqual(h.series.values, [9, 0, 6, 3]);
  assert.equal(h.R.usable, false); // 1 year
});

test('harmonized overlap total equals VIIRS total; MODIS x R before S-NPP flagged estimated; Terra-only null', () => {
  const lv = level('aoi', '2002-05', 120, {
    m: (i) => (i % 3) + 1, v: (i, ym) => (ym >= '2012-01' ? ((i % 3) + 1) * 2 : null) });
  const h = harmonize([lv], manifest());
  assert.deepEqual(validateSeries(h.series), []);
  assert.deepEqual(h.series.values.slice(0, 2), [null, null]); // 2002-05, 2002-06 Terra-only
  assert.notEqual(h.series.values[2], null); // 2002-07 scaled
  const est = new Set(h.series.flags.filter((f) => f.flag === 'estimated').map((f) => f.month));
  const first = lv.viirs.values.findIndex((x) => x !== null);
  lv.viirs.values.forEach((x, i) => {
    if (x !== null) assert.equal(h.series.values[i], x);
    else if (i >= 2) assert.ok(est.has(addMonths('2002-05', i)));
  });
  assert.equal(sum(h.series.values.slice(first)), sum(lv.viirs.values));
  assert.equal(h.R.value, 2);
  assert.equal(h.series.values[2], lv.modis.values[2] * 2);
});

test('MODIS sum 0 at aoi falls back to the next level', () => {
  const zero = level('aoi', '2002-08', 240, { m: () => 0, v: (i, ym) => (ym >= '2012-02' ? 1 : null) });
  const tiles = level('tiles', '2002-08', 240, { m: (i) => (i % 2) + 1, v: (i, ym) => (ym >= '2012-02' ? ((i % 2) + 1) * 4 : null) });
  const h = harmonize([zero, tiles], manifest());
  assert.equal(h.R.level, 'tiles');
  assert.equal(h.R.value, 4);
  assert.equal(h.R.usable, true);
  assert.equal(h.reasons.length, 1);
  assert.equal(h.series.values[0], 0); // aoi MODIS 0 x 4
});

test('no level usable: last level used, low confidence reason', () => {
  const a = level('aoi', '2012-02', 24, { m: () => 0, v: () => 1 });
  const g = level('global', '2012-02', 24, { m: () => 1, v: () => 2 });
  const h = harmonize([a, g], manifest());
  assert.equal(h.R.level, 'global');
  assert.equal(h.R.usable, false);
  assert.match(h.reasons[0], /low confidence/);
});

test('a world R in a build with no domain is applied but low confidence; a Brazil build keeps it usable', () => {
  const a = level('aoi', '2010-02', 144, { m: () => 0, v: (i, ym) => (ym >= '2012-02' ? 1 : null) });
  const g = level('global', '2010-02', 144, { m: (i) => (i % 2) + 1, v: (i, ym) => (ym >= '2012-02' ? ((i % 2) + 1) * 2 : null) });
  const world = harmonize([a, g], manifest());
  assert.equal(world.R.level, 'global');
  assert.equal(world.R.usable, false);
  assert.match(world.reasons[0], /world total/);
  assert.ok(world.series.flags.some((f) => f.flag === 'low-confidence'));
  const brazil = harmonize([a, g], manifest({ domain: { id: 'brazil' } }));
  assert.equal(brazil.R.usable, true);
});

test('per-calendar-month R when all months pass, annual R otherwise', () => {
  // 2012-02..2024-12: month-dependent ratio (cal month c has R = c), no noise.
  const mon = (ym) => Number(ym.slice(5));
  const lv = level('aoi', '2012-02', 155, { m: () => 2, v: (i, ym) => 2 * mon(ym) });
  const h = harmonize([lv], manifest({ coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2030-12'], noaa20: null } }));
  assert.ok(h.R.usable && h.R.perMonth);
  assert.deepEqual(h.R.perMonth.map((p) => p.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  // Annual-only: one calendar month has MODIS 0 for every year -> that month is unusable.
  const lv2 = level('aoi', '2012-02', 155, { m: (i, ym) => (mon(ym) === 7 ? 0 : 2), v: () => 2 });
  const h2 = harmonize([lv2], manifest());
  assert.equal(h2.R.perMonth, undefined);
  assert.equal(h2.R.usable, true);
  assert.ok(h2.R.value > 0);
});

test('CI is deterministic for a fixed seed, differs across seeds, counts failed draws', () => {
  const lv = level('aoi', '2012-02', 100, { m: (i) => 1 + (i % 7), v: (i) => 2 + (i % 5) });
  const a = harmonize([lv], manifest(), { seed: 7, draws: 200 });
  const b = harmonize([lv], manifest(), { seed: 7, draws: 200 });
  const c = harmonize([lv], manifest(), { seed: 8, draws: 200 });
  assert.deepEqual(a.R, b.R);
  assert.notDeepEqual(a.R.ci, c.R.ci);
  assert.ok(a.R.ci[0] < a.R.value && a.R.value < a.R.ci[1]);
  // One year holds all the MODIS: draws that miss it fail.
  const sparse = level('aoi', '2012-02', 100, { m: (i) => (i < 8 ? 3 : 0), v: () => 1 });
  const s = harmonize([sparse], manifest(), { seed: 1, draws: 200 });
  assert.ok(s.R.failedDraws > 0);
  assert.equal(s.R.usable, false);
});

test('after S-NPP ends: NOAA-20 x K, estimated; MODIS x R when NOAA-20 is null', () => {
  const m = manifest({
    coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2026-10'], noaa20: ['2018-04', '2030-12'] },
    partial_months: { modis: [], viirs: ['2012-01'], noaa20: [] },
  });
  const lv = level('aoi', '2018-04', 105, {
    m: () => 2, v: (i, ym) => (ym <= '2026-10' ? 4 : null),
    n: (i, ym) => (ym <= '2026-10' || ym < '2026-12' ? 2 : ym === '2026-12' ? null : 2),
  });
  const h = harmonize([lv], m);
  assert.equal(h.K.value, 2);
  assert.equal(h.R.value, 2);
  const at = (ym) => h.series.values[lv.viirs.values.length ? (Number(ym.slice(0, 4)) - 2018) * 12 + Number(ym.slice(5)) - 4 : 0];
  assert.equal(at('2026-10'), 4); // observed S-NPP
  assert.equal(at('2026-11'), 4); // NOAA-20 2 x K 2
  assert.equal(at('2026-12'), 4); // NOAA-20 null -> MODIS 2 x R 2
  assert.ok(h.series.flags.some((f) => f.month === '2026-11' && f.flag === 'estimated'));
  assert.ok(!h.series.flags.some((f) => f.month === '2026-10'));
  assert.deepEqual(validateSeries(h.series), []);
});

test('input flags carry over; all-null input gives all-null harmonized with a reason', () => {
  const flags = [{ month: null, flag: 'outside-domain' }];
  const nul = { m: () => null, v: () => null };
  const lv = level('aoi', '2012-02', 6, nul);
  lv.modis.flags = flags; lv.viirs.flags = flags;
  const h = harmonize([lv], manifest());
  assert.ok(h.series.values.every((v) => v === null));
  assert.deepEqual(h.series.flags, flags);
  assert.match(h.reasons[0], /outside-domain/);
  assert.deepEqual(validateSeries(h.series), []);
  const pd = level('aoi', '2012-02', 6, { m: () => 1, v: () => 1 });
  pd.modis.flags = [{ month: null, flag: 'partial-domain' }];
  assert.ok(harmonize([pd], manifest()).series.flags.some((f) => f.flag === 'partial-domain'));
});

test('S-NPP operating but not yet archived: estimated and flagged viirs-not-archived, with a reason', () => {
  const m = manifest({
    coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2026-07'], noaa20: ['2018-04', '2026-07'] },
    partial_months: { modis: [], viirs: ['2012-01'], noaa20: [] },
  });
  const lv = level('aoi', '2018-04', 104, { m: () => 2, v: (i, ym) => (ym <= '2026-07' ? 4 : null), n: (i, ym) => (ym <= '2026-07' ? 2 : null) });
  const h = harmonize([lv], m);
  const f = (flag) => h.series.flags.filter((x) => x.flag === flag).map((x) => x.month);
  assert.deepEqual(f('viirs-not-archived'), ['2026-08', '2026-09', '2026-10']);
  assert.ok(f('estimated').includes('2026-08') && f('estimated').includes('2026-11'));
  assert.ok(!f('viirs-not-archived').includes('2026-11'));
  assert.ok(h.reasons.some((r) => /not archived yet/.test(r)));
});

test('a factor that is not usable flags the series low-confidence; Terra-only months are flagged', () => {
  const lv = level('aoi', '2002-05', 250, { m: () => 1, v: (i, ym) => (ym >= '2012-01' ? 2 : null) });
  const ok = harmonize([lv], manifest());
  assert.ok(!ok.series.flags.some((x) => x.flag === 'low-confidence'));
  assert.deepEqual(ok.series.flags.filter((x) => x.flag === 'terra-only').map((x) => x.month), ['2002-05', '2002-06']);
  const short = level('aoi', '2011-01', 24, { m: () => 1, v: (i, ym) => (ym >= '2012-01' ? 2 : null) });
  const h = harmonize([short], manifest());
  assert.equal(h.R.usable, false);
  assert.ok(h.series.flags.some((x) => x.month === null && x.flag === 'low-confidence'));
});

test('R window: default ends 2021-12, later months do not change R, window recorded', () => {
  const mk = (after) => level('aoi', '2012-02', 155, { m: () => 2, v: (i, ym) => (ym > '2021-12' ? after : 4) });
  const a = harmonize([mk(2)], manifest());
  const b = harmonize([mk(40)], manifest());
  assert.equal(a.R.value, 2);
  assert.equal(b.R.value, 2);
  assert.deepEqual(a.R.window, { from: '2002-08', to: '2021-12' });
  const c = harmonize([mk(40)], manifest(), { rWindow: { from: '2013-01', to: '2030-12' } });
  assert.deepEqual(c.R.window, { from: '2013-01', to: '2030-12' });
  assert.ok(c.R.value > 2);
});

// 2018-04..2022-12, S-NPP 4 vs NOAA-20 2 (K = 2); 2022-07 is an S-NPP outage month (observed 1)
const outageLevel = (nAt = () => 2) => level('aoi', '2018-04', 57, {
  m: () => 2, v: (i, ym) => (ym === '2022-07' ? 1 : 4), n: (i, ym) => nAt(ym),
});
const outageManifest = (over = {}) => manifest({
  coverage: { modis: ['2000-11', '2030-12'], viirs: ['2012-01', '2030-12'], noaa20: ['2018-04', '2030-12'] },
  partial_months: { modis: [], viirs: ['2012-01', '2022-07'], noaa20: [] }, ...over,
});
const idx = (ym) => (Number(ym.slice(0, 4)) - 2018) * 12 + Number(ym.slice(5)) - 4;

test('S-NPP outage month inside NOAA-20 coverage is NOAA-20 x K, flagged; fits exclude it', () => {
  const h = harmonize([outageLevel()], outageManifest(), { seed: 1, draws: 200 });
  assert.equal(h.K.value, 2); // the outage month (1 vs 2) is not in the fit
  assert.equal(h.series.values[idx('2022-07')], 4);
  assert.equal(h.series.values[idx('2022-06')], 4); // neighbours stay observed
  const f = (ym) => h.series.flags.filter((x) => x.month === ym).map((x) => x.flag).sort();
  assert.deepEqual(f('2022-07'), ['estimated', 'viirs-outage-filled']);
  assert.deepEqual(f('2022-06'), []);
  assert.deepEqual(validateSeries(h.series), []);
});

test('outage month stays observed when NOAA-20 is null there, partial for NOAA-20, or K is not usable', () => {
  const nul = harmonize([outageLevel((ym) => (ym === '2022-07' ? null : 2))], outageManifest(), { seed: 1, draws: 200 });
  assert.equal(nul.series.values[idx('2022-07')], 1);
  assert.ok(!nul.series.flags?.some((x) => x.flag === 'viirs-outage-filled'));
  const pn = harmonize([outageLevel()], outageManifest({
    partial_months: { modis: [], viirs: ['2012-01', '2022-07'], noaa20: ['2022-07'] },
  }), { seed: 1, draws: 200 });
  assert.equal(pn.series.values[idx('2022-07')], 1);
  const short = level('aoi', '2022-01', 12, { m: () => 2, v: (i, ym) => (ym === '2022-07' ? 1 : 4), n: () => 2 });
  const un = harmonize([short], outageManifest(), { seed: 1, draws: 200 }); // 1 year: K not usable
  assert.equal(un.K.usable, false);
  assert.equal(un.series.values[6], 1);
  assert.ok(!un.series.flags?.some((x) => x.flag === 'viirs-outage-filled'));
});
