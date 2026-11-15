import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchedLabel, liveAnswer, liveModel, liveTableModel, nextPoint, periodLabel, shortPeriod, spreadLabels } from './live-view.js';

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
  assert.equal(m.fetchedText, 'Fetched 6 h ago · 14 Nov, 06:00 UTC');
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
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 16);
  // The band is wide enough to carry its own label inside, so only two direct labels remain.
  assert.deepEqual(m.labels.map((l) => l.text).sort(), ['Current season', 'Historical median']);
  assert.equal(m.bandLabel.text, 'Middle half of past years');
  const thin = liveModel({ ...input({ band: { p25: [89, 149, 159, 119], median: [90, 150, 160, 120], p75: [91, 151, 161, 121] } }), now: NOW });
  assert.equal(thin.bandLabel, null);
  assert.ok(thin.labels.some((l) => l.text === 'Middle half of past years'), 'a thin band gets a direct label');
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

test('niceTicks keeps whole numbers only, no repeated labels on flat data', async () => {
  const { niceTicks } = await import('./live-view.js');
  assert.deepEqual(niceTicks(1), [0, 1]);
  assert.deepEqual(niceTicks(2), [0, 1, 2]);
  assert.deepEqual(niceTicks(300), [0, 150, 300]);
});

test('chartWidth uses the real width below 640 so text is not scaled, and moves labels to a key', async () => {
  const { chartWidth, liveModel } = await import('./live-view.js');
  assert.equal(chartWidth(360), 360);
  assert.equal(chartWidth(0), 640);
  assert.equal(chartWidth(1000), 1000, 'desktop uses the real width too');
  assert.equal(chartWidth(3000), 1400);
  const input = { fetched_at: '2026-11-14T00:00:00Z', now: new Date('2026-11-14T01:00:00Z'), live: { id: 'live', comparable: false, start: '2026-01', values: [1, 2, 3] }, band: { p25: [0, 1, 1], median: [1, 1, 2], p75: [2, 2, 3] } };
  const narrow = liveModel({ ...input, width: 360 });
  assert.equal(narrow.width, 360);
  assert.equal(narrow.labels.length, 0);
  assert.equal(narrow.key.length, 3);
  assert.equal(liveModel(input).key.length, 0);
});

test('fetched label: relative then absolute in UTC', () => {
  assert.equal(fetchedLabel('2026-11-14T11:59:40Z', NOW), 'Fetched just now · 14 Nov, 11:59 UTC');
  assert.equal(fetchedLabel('2026-11-14T11:30:00Z', NOW), 'Fetched 30 min ago · 14 Nov, 11:30 UTC');
  assert.equal(fetchedLabel('2026-11-13T22:00:00Z', NOW), 'Fetched 14 h ago · 13 Nov, 22:00 UTC');
});

test('x labels are short months, with the year only on January', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => shortPeriod('2025-11', 'month', i)), ['Nov', 'Dec', 'Jan 2026', 'Feb']);
});

test('answer: latest value so far and the signed difference from its median', () => {
  assert.deepEqual(liveAnswer(input()), { headline: 'November 2026 so far: 150 fire-cell-days', delta: '+25% vs the November median' });
  const below = liveAnswer(input({ band: { ...input().band, median: [90, 150, 160, 200] } }));
  assert.equal(below.delta, '−25% vs the November median');
  assert.equal(liveAnswer(input({ band: { ...input().band, median: [90, 150, 160, 0] } })).delta, null, 'no percent against a zero median');
  assert.equal(liveAnswer({ ...input(), provisional: false }).headline, 'November 2026: 150 fire-cell-days');
});

test('table caption says synthetic and Preview', () => {
  assert.match(liveTableModel(input(), { synthetic: true }).caption, /Synthetic data, not real fire detections\. Median and percentiles are a Preview\./);
  assert.doesNotMatch(liveTableModel(input()).caption, /Synthetic/);
});

test('a reason replaces the chart with its own status line', async () => {
  const { stateModel } = await import('./states.js');
  const m = liveModel({ fetched_at: '2026-11-14T06:00:00Z', reason: 'Live data covers Brazil only.', now: NOW });
  assert.equal(m.available, false);
  assert.deepEqual(stateModel(m.state).lines, ['Live data covers Brazil only.', 'The calendar keeps working.']);
});

test('validated live drops Preview from the table caption', () => {
  assert.doesNotMatch(liveTableModel({ ...input(), preview: false }).caption, /Preview/);
});

test('daily running totals: the answer names the month and the last day', () => {
  const daily = input({ live: { id: 'live', unit: 'fire-cell-days', comparable: false, step: 'day', start: '2026-11-01', values: [10, 20, null, 150] } });
  assert.deepEqual(liveAnswer(daily), { headline: 'November 2026 through day 4 so far: 150 fire-cell-days', delta: '+25% vs the median of the same days in past years' });
});

test('no band: the running total alone, with no band or median paths, labels, key items or table columns', () => {
  const day = input({ band: null, live: { id: 'live', unit: 'fire-cell-days', comparable: false, step: 'day', start: '2026-11-01', values: [null, null, 12, 30] } });
  const m = liveModel({ ...day, now: NOW });
  assert.equal(m.compared, false);
  assert.equal(m.bandPath, '');
  assert.equal(m.medianPath, '');
  assert.equal(m.bandLabel, null);
  assert.deepEqual(m.labels.map((l) => l.text), ['Running total']);
  assert.deepEqual(liveModel({ ...day, now: NOW, width: 360 }).key, [{ text: 'Running total', cls: 'live' }]);
  assert.ok(m.points.every((p) => !/median|middle half/.test(p.aria)));
  assert.equal(liveAnswer(day).delta, null);
  const t = liveTableModel(day);
  assert.deepEqual(t.columns, ['Running total']);
  assert.deepEqual(t.rows.map((r) => r.cells), [['No data'], ['No data'], ['12'], ['30']]);
  assert.match(t.caption, /^Running total of fire-cell-days, not compared with past years\.$/);
});
