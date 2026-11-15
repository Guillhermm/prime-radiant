import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTSIDE_LINE, OUTSIDE_EXPORT, bboxText, domainNote, errorState, liveStatus, recordDates, ribbonModel, screenState, stateModel } from './states.js';

test('empty offers one chip per example area', () => {
  const m = stateModel({ kind: 'empty' }, { presets: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual(m.chips, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  assert.equal(m.title, 'When does this place burn?');
  assert.match(m.lines[0], /Pick an area/);
});

test('zero detections says sensors were operating', () => {
  const m = stateModel({ kind: 'zero' });
  assert.match(m.lines.join(' '), /0 fire-cell-days in range/);
  assert.match(m.lines.join(' '), /sensors were operating/);
});

test('loading is busy with a polite status', () => {
  const m = stateModel({ kind: 'loading' });
  assert.equal(m.busy, true);
  assert.equal(m.role, 'status');
});

test('error is an alert with Retry and says what failed', () => {
  const m = stateModel({ kind: 'error', what: 'tile x12y7' });
  assert.equal(m.role, 'alert');
  assert.equal(m.action.label, 'Try again');
  assert.equal(m.title, 'Could not load fire data');
  assert.match(m.lines[0], /tile x12y7/);
});

test('live data older than 48 h or missing is unavailable', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  assert.equal(liveStatus('2026-11-13T12:00:00Z', now).available, true);
  assert.equal(liveStatus('2026-11-12T11:00:00Z', now).available, false);
  assert.match(liveStatus('2026-11-12T11:00:00Z', now).text, /Last update 2026-11-12/);
  assert.equal(liveStatus(null, now).available, false);
  assert.equal(liveStatus('garbage', now).available, false);
  assert.match(stateModel({ kind: 'live-unavailable', fetchedAt: null }).lines[0], /unavailable/);
});

test('unknown kind throws', () => {
  assert.throws(() => stateModel({ kind: 'nope' }), RangeError);
});

test('screenState picks the state from the query and data status', () => {
  assert.deepEqual(screenState({ hasArea: false, status: 'ready' }), { kind: 'empty', results: false });
  assert.deepEqual(screenState({ hasArea: true, status: 'loading' }), { kind: 'loading', results: false });
  assert.deepEqual(screenState({ hasArea: true, status: 'error' }), { kind: 'error', results: false });
  assert.deepEqual(screenState({ hasArea: true, status: 'ready', cells: [{ value: 3 }, { value: 0 }] }), { kind: null, results: true });
  assert.deepEqual(screenState({ hasArea: true, status: 'ready', cells: [] }), { kind: null, results: true });
});

test('zero needs every month to be a real 0, never null', () => {
  assert.equal(screenState({ hasArea: true, status: 'ready', cells: [{ value: 0 }, { value: 0 }] }).kind, 'zero');
  assert.equal(screenState({ hasArea: true, status: 'ready', cells: [{ value: 0 }, { value: null }] }).kind, null);
  assert.equal(screenState({ hasArea: true, status: 'ready', cells: [{ value: null }] }).kind, null);
});

test('errorState tells a validation failure from a connection failure', () => {
  assert.match(stateModel(errorState({ kind: 'invalid' })).lines[0], /failed validation/);
  assert.match(stateModel(errorState({ kind: 'network' })).lines[1], /Check your connection/);
  assert.match(stateModel(errorState({ kind: 'network' }, { offline: true })).lines[1], /not saved for offline use/);
  assert.match(stateModel(errorState({ kind: 'invalid' }, { offline: true })).lines[0], /failed validation/, 'offline does not hide a validation failure');
});

test('first-run record dates come from the manifest, missing ones are skipped', () => {
  const d = recordDates({ coverage: { modis: ['2000-11', '2026-10'], viirs: ['2012-01', '2026-10'] }, last_month: '2026-10' });
  assert.deepEqual(d, [{ v: 'Nov 2000', k: 'MODIS record starts' }, { v: 'Jan 2012', k: 'VIIRS record starts' }, { v: 'Oct 2026', k: 'latest month' }]);
  assert.deepEqual(recordDates(null), []);
});

test('bboxText names hemispheres and drops trailing zeros', () => {
  assert.equal(bboxText([-59, -19, -52, -12]), '19°S–12°S · 59°W–52°W');
  assert.equal(bboxText([-58.2, -20.1, -55, -15.3]), '20.1°S–15.3°S · 58.2°W–55°W');
  assert.equal(bboxText([10, -5, 20, 3]), '5°S–3°N · 10°E–20°E');
});

test('example ribbon: density class of each month median, no median is no data', () => {
  const r = ribbonModel([{ month: 1, median: null }, { month: 2, median: 100 }], 1000);
  assert.deepEqual(r.map((x) => x.bin), ['nodata', 4]);
});

test('an area outside the domain gets its own state, never a zero or a grid of no data', () => {
  const nulls = [{ value: null }, { value: null }];
  assert.deepEqual(screenState({ hasArea: true, status: 'ready', cells: nulls, outside: true }), { kind: 'outside', results: false });
  const m = stateModel({ kind: 'outside' });
  assert.equal(m.title, 'Outside the data domain');
  assert.equal(m.lines[0], OUTSIDE_LINE);
  assert.match(OUTSIDE_LINE, /not zeros/);
  assert.equal(m.role, 'status');
  assert.deepEqual(m.action, { id: 'draw', label: 'Draw an area in Brazil' }, 'the way out is the primary action');
  assert.deepEqual(m.chips.map((c) => c.id), ['pantanal', 'amazon-arc'], 'with the example areas');
  assert.match(OUTSIDE_EXPORT, /^Nothing to export: .*outside Brazil/);
});

test('an area partly outside names the share the counts cover', () => {
  assert.equal(domainNote({ cells: 20000, inside: 10000, partial: true }), 'Part of this area lies outside Brazil, the data domain: counts cover the 50% inside it.');
  assert.equal(domainNote({ cells: 100, inside: 100, partial: false }), null);
  assert.equal(domainNote(undefined), null);
});
