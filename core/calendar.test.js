import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCalendar, kpis } from './calendar.js';
import { validateCalendarCell } from './schema.js';

const manifest = {
  month0: '2023-01', last_month: '2024-06', generated_at: '2024-07-15T00:00:00Z',
  coverage: { modis: ['2023-01', '2024-06'], viirs: ['2023-03', '2024-02'], noaa20: ['2023-01', '2024-06'] },
  partial_months: { modis: [], viirs: ['2023-07'], noaa20: ['2024-05'] },
};
const series = (start, values, flags) => ({
  id: 'harmonized', unit: 'fire-cell-days', start, values, ...(flags ? { flags } : {}),
  method: { id: 'ratio-of-sums', version: 1 }, comparable: true,
});
const baseOf = (s, values, yearsUsed) => ({
  series: { ...s, id: 'baseline', values, flags: undefined }, yearsUsed, reasons: [], method: { id: 'baseline-median', version: 1 },
});
const K = { value: 1.5, ci: [1.4, 1.6], level: 'aoi', usable: true, nYears: 7 };
const R = { value: 1.8, ci: [1.7, 1.9], level: 'tiles', usable: false, nYears: 3 };

// 2023-01 .. 2023-07
const A = {
  series: series('2023-01', [3.6, null, 4, 0, null, 7, 9], [
    { month: '2023-01', flag: 'estimated' }, { month: '2023-02', flag: 'terra-only' },
    { month: null, flag: 'low-confidence' },
  ]),
  R, K: null, reasons: [],
};

test('toCalendar: status, estimated, flags per month; zero and no-data never collapse', () => {
  const cells = toCalendar(A, null, manifest);
  assert.deepEqual(cells.map((c) => c.status), ['harmonized', 'no-data', 'observed', 'observed', 'no-data', 'observed', 'partial']);
  assert.deepEqual(cells.map((c) => c.value), [3.6, null, 4, 0, null, 7, 9]);
  assert.deepEqual(cells.map((c) => c.estimated), [true, false, false, false, false, false, false]);
  assert.deepEqual(cells[1].flags, ['terra-only']); // no-data carries its reason
  assert.deepEqual(cells[0].flags, ['low-confidence']); // global flag only on estimated cells
  assert.deepEqual(cells[2].flags, []);
  assert.deepEqual([cells[0].year, cells[0].month, cells[6].year, cells[6].month], [2023, 1, 2023, 7]);
  assert.ok(cells.every((c) => !('median' in c))); // no baseline given
  for (const c of cells) assert.deepEqual(validateCalendarCell(c, { manifest }), []);
});

test('toCalendar: median from baseline, null kept as null', () => {
  const b = baseOf(A.series, [null, null, 1, 2, null, 3, 4], []);
  assert.deepEqual(toCalendar(A, b, manifest).map((c) => c.median), [null, null, 1, 2, null, 3, 4]);
});

// 2024-01 .. 2024-06: S-NPP archive ends 2024-02, NOAA-20 x 1.5 after
const B = {
  series: series('2024-01', [5, 0, 6, null, 3, 2], [
    { month: '2024-03', flag: 'estimated' }, { month: '2024-05', flag: 'estimated' }, { month: '2024-06', flag: 'estimated' },
    { month: '2024-06', flag: 'viirs-not-archived' }, { month: null, flag: 'partial-domain' },
  ]),
  R, K, reasons: [],
};

test('toCalendar: partial by the supplying sensor, and the last month while it fills', () => {
  let cells = toCalendar(B, null, manifest);
  // 2024-05 is in noaa20 partial_months; 2024-06 only harmonized, archive built after month end
  assert.deepEqual(cells.map((c) => c.status), ['observed', 'observed', 'harmonized', 'no-data', 'partial', 'harmonized']);
  assert.equal(cells[4].estimated, true); // partial keeps the estimated flag and the value
  assert.equal(cells[4].value, 3);
  assert.deepEqual(cells[5].flags, ['viirs-not-archived', 'partial-domain']);
  // archive generated inside 2024-06: the last month is still filling
  cells = toCalendar(B, null, { ...manifest, generated_at: '2024-06-20T00:00:00Z' });
  assert.equal(cells[5].status, 'partial');
  assert.equal(cells[2].status, 'harmonized');
  // a viirs-only partial month does not mark an estimated month supplied by NOAA-20
  const m2 = { ...manifest, partial_months: { ...manifest.partial_months, viirs: ['2024-03'], noaa20: [] } };
  assert.equal(toCalendar(B, null, m2)[2].status, 'harmonized');
  // known partial MODIS month 2002-07 and VIIRS 2012-01
  const old = { series: series('2002-07', [1, 2], [{ month: '2002-07', flag: 'estimated' }]), R, K: null, reasons: [] };
  assert.deepEqual(toCalendar(old, null, { month0: '2002-07', last_month: '2002-08' }).map((c) => c.status), ['partial', 'observed']);
  const jan = { series: series('2012-01', [4]), R, K: null, reasons: [] };
  assert.equal(toCalendar(jan, null, { month0: '2012-01', last_month: '2012-01' })[0].status, 'partial');
});

test('toCalendar: outside-domain series is all no-data with its reason', () => {
  const out = { series: series('2023-01', [null, null], [{ month: null, flag: 'outside-domain' }]), R, K: null, reasons: [] };
  const cells = toCalendar(out, null, manifest);
  assert.deepEqual(cells.map((c) => [c.value, c.status, c.flags]), [[null, 'no-data', ['outside-domain']], [null, 'no-data', ['outside-domain']]]);
});

const baseB = baseOf(B.series, [null, 2, 3, null, 4, 1], [[], [2019, 2020], [], [], [2018, 2019, 2020, 2021, 2022], []]);

test('kpis: numbers equal the series they come from', () => {
  const k = kpis(B, baseB, manifest, { from: '2024-02', to: '2024-05' });
  assert.deepEqual(k.range, { from: '2024-02', to: '2024-05' });
  assert.equal(k.total, 0 + 6 + 3); // null skipped, 0 counted
  assert.deepEqual([k.latest.year, k.latest.month, k.latest.value, k.latest.status, k.latest.estimated], [2024, 5, 3, 'partial', true]);
  assert.equal(k.median, 4);
  assert.deepEqual(k.yearsUsed, [2018, 2019, 2020, 2021, 2022]);
  assert.equal('medianReason' in k, false);
  assert.deepEqual(k.R, { value: 1.8, ci: [1.7, 1.9], level: 'tiles', usable: false, nYears: 3 });
  assert.deepEqual(k.K, K);
  assert.deepEqual(k.era, ['S-NPP', 'NOAA-20 x K']);
  assert.deepEqual(k.flags, { 'partial-domain': 4 });
  // whole series, defaults
  const all = kpis(B, baseB, manifest);
  assert.equal(all.total, 5 + 0 + 6 + 3 + 2);
  assert.equal(all.latest.month, 6);
  assert.deepEqual(all.flags, { 'partial-domain': 6, 'viirs-not-archived': 1 });
});

test('kpis: no median is null with a reason; latest is the last archived month in range', () => {
  const k = kpis(B, baseB, { ...manifest, last_month: '2024-04' }, { to: '2024-06' });
  assert.deepEqual([k.latest.month, k.latest.value, k.latest.status], [4, null, 'no-data']);
  assert.deepEqual([k.median, k.yearsUsed, k.medianReason], [null, null, 'not enough history']);
  assert.equal(kpis(B, null, manifest).median, null);
});

test('kpis: era without K uses MODIS x R; all-null range totals null, all-zero totals 0', () => {
  const noK = { ...B, K: null };
  assert.deepEqual(kpis(noK, null, manifest, { from: '2024-03', to: '2024-03' }).era, ['MODIS x R']);
  assert.equal(kpis(noK, null, manifest, { from: '2024-03', to: '2024-03' }).K, null);
  assert.equal(kpis(B, null, manifest, { from: '2024-04', to: '2024-04' }).total, null);
  assert.deepEqual(kpis(B, null, manifest, { from: '2024-04', to: '2024-04' }).era, []);
  assert.equal(kpis(B, null, manifest, { from: '2024-02', to: '2024-02' }).total, 0);
});

test('kpis: total equals the sum of the calendar cells', () => {
  const cells = toCalendar(A, null, manifest);
  assert.equal(kpis(A, null, manifest).total, cells.reduce((s, c) => s + (c.value ?? 0), 0));
});

test('kpis: R exposes window and perMonth values when the harmonizer supplies them', () => {
  const window = { from: '2002-08', to: '2021-12' };
  const perMonth = Array.from({ length: 12 }, (_, i) => ({ value: 1 + i }));
  const k = kpis({ ...B, R: { ...R, window, perMonth } }, baseB, manifest);
  assert.deepEqual(k.R.window, window);
  assert.deepEqual(k.R.perMonth, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal('window' in kpis(B, baseB, manifest).R, false);
});
