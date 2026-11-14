import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveModel, liveTableModel, nextPoint, periodLabel, spreadLabels } from './live-view.js';

const NOW = new Date('2026-11-14T12:00:00Z');
const input = (over = {}) => ({
  fetched_at: '2026-11-14T06:00:00Z',
  live: { id: 'live', unit: 'fire-cell-days', comparable: false, start: '2026-08', values: [100, 200, null, 150] },
  band: { p25: [50, 80, 90, 70], median: [90, 150, 160, 120], p75: [130, 250, 260, 200] },
  ...over,
});

test('missing or stale fetched_at gives live-unavailable and no chart', () => {
  for (const fetched_at of [null, undefined, '2026-11-12T11:00:00Z']) {
    const m = liveModel({ ...input({ fetched_at }), now: NOW });
    assert.equal(m.available, false);
    assert.equal(m.state.kind, 'live-unavailable');
    assert.equal(m.points, undefined);
  }
});

test('47 h old is available, 49 h is not', () => {
  assert.equal(liveModel({ ...input({ fetched_at: '2026-11-12T13:00:00Z' }), now: NOW }).available, true);
  assert.equal(liveModel({ ...input({ fetched_at: '2026-11-12T11:00:00Z' }), now: NOW }).available, false);
});

test('provisional badge, fetched text and the never-mixed note', () => {
  const m = liveModel({ ...input(), now: NOW });
  assert.equal(m.badge, 'Provisional');
  assert.equal(m.fetchedText, 'Fetched 2026-11-14T06:00:00Z');
  assert.match(m.note, /never added to the harmonized totals/);
  assert.equal(liveModel({ ...input(), provisional: false, now: NOW }).badge, null);
});

test('current month is the last value, drawn as a dashed tail, not in the solid line', () => {
  const m = liveModel({ ...input(), now: NOW });
  assert.equal(m.current.label, 'November 2026');
  assert.ok(m.points.at(-1).provisional);
  assert.equal(m.tailPath, '', 'previous value is null, so there is no tail to draw');
  const full = liveModel({ ...input({ live: { ...input().live, values: [100, 200, 120, 150] } }), now: NOW });
  assert.match(full.tailPath, /^M[\d. ]+ L[\d. ]+$/);
  assert.equal((full.linePath.match(/M/g) ?? []).length, 1);
});

test('null is a gap, never a zero: no point, and the line breaks', () => {
  const m = liveModel({ ...input({ live: { ...input().live, values: [100, null, 120, 150] } }), now: NOW });
  assert.equal(m.points.length, 3);
  assert.equal(m.points.some((p) => p.label === 'September 2026'), false);
  assert.equal((m.linePath.match(/M/g) ?? []).length, 2, 'closed part is [100, null, 120]: two runs');
});

test('a real 0 is plotted on the baseline', () => {
  const m = liveModel({ ...input({ live: { ...input().live, values: [0, 10, 20, 30] } }), now: NOW });
  const p0 = m.points[0];
  assert.equal(p0.value, 0);
  assert.equal(p0.y, m.bottom);
});

test('point labels carry value, provisional flag, median and middle half', () => {
  const m = liveModel({ ...input(), now: NOW });
  assert.match(m.points[0].aria, /^August 2026, 100 fire-cell-days, historical median 90, middle half 50 to 130$/);
  assert.match(m.points.at(-1).aria, /provisional, the period is still open/);
});

test('direct labels never overlap', () => {
  const m = liveModel({ ...input({ live: { ...input().live, values: [90, 150, 160, 120] } }), now: NOW });
  const ys = m.labels.map((l) => l.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 14);
  assert.deepEqual(m.labels.map((l) => l.text).sort(), ['Current season', 'Historical median', 'Middle half of past years']);
});

test('spreadLabels keeps order and spacing', () => {
  assert.deepEqual(spreadLabels([{ y: 10 }, { y: 11 }, { y: 12 }], 14).map((l) => l.y), [10, 24, 38]);
});

test('band path closes each run and breaks at null', () => {
  const band = { p25: [50, null, 90, 70], median: [90, 150, 160, 120], p75: [130, 250, 260, 200] };
  const m = liveModel({ ...input({ band }), now: NOW });
  assert.equal((m.bandPath.match(/Z/g) ?? []).length, 2);
});

test('contract is enforced: id, comparable and band length', () => {
  assert.throws(() => liveModel({ ...input({ live: { ...input().live, comparable: true } }), now: NOW }), /comparable false/);
  assert.throws(() => liveModel({ ...input({ band: { ...input().band, p25: [1] } }), now: NOW }), /same length/);
});

test('daily step labels roll over months', () => {
  assert.equal(periodLabel('2026-11-29', 'day', 3), '2026-12-02');
  assert.equal(periodLabel('2026-11', 'month', 2), 'January 2027');
});

test('keyboard moves between points and clamps at the ends', () => {
  assert.equal(nextPoint('ArrowLeft', 0, 4), 0);
  assert.equal(nextPoint('ArrowRight', 3, 4), 3);
  assert.equal(nextPoint('ArrowRight', 1, 4), 2);
  assert.equal(nextPoint('Home', 2, 4), 0);
  assert.equal(nextPoint('End', 0, 4), 3);
  assert.equal(nextPoint('a', 0, 4), null);
});

test('table alternative: one row per period, null live is no data, 0 stays 0, provisional marked', () => {
  const t = liveTableModel(input({ live: { ...input().live, values: [0, 200, null, 150] }, band: { ...input().band, median: [90, null, 160, 120] } }));
  assert.equal(t.corner, 'Month');
  assert.deepEqual(t.columns, ['Current season', 'Historical median', '25th percentile', '75th percentile']);
  assert.deepEqual(t.rows.map((r) => r.header), ['August 2026', 'September 2026', 'October 2026', 'November 2026 (provisional)']);
  assert.deepEqual(t.rows[0].cells, ['0', '90', '50', '130']);
  assert.equal(t.rows[1].cells[1], 'Not available');
  assert.equal(t.rows[2].cells[0], 'No data');
  assert.equal(liveTableModel({ ...input(), provisional: false }).rows[3].header, 'November 2026');
  assert.throws(() => liveTableModel(input({ band: { p25: [], median: [], p75: [] } })), RangeError);
});
