import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorState, liveStatus, screenState, stateModel } from './states.js';

test('empty offers one chip per example area', () => {
  const m = stateModel({ kind: 'empty' }, { presets: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual(m.chips, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  assert.match(m.lines[0], /Choose an area/);
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
  assert.equal(m.action.label, 'Retry');
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
});
