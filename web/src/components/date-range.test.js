import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetRange, validateRange, spanFromManifest, currentMonth } from './date-range.js';

const span = { from: '2000-11', to: '2026-10' };
const now = new Date('2026-11-14T12:00:00Z');

test('spanFromManifest takes earliest coverage start and last_month', () => {
  assert.deepEqual(spanFromManifest({ coverage: { modis: ['2000-11', '2012-12'], viirs: ['2012-02', '2012-12'] }, last_month: '2012-12' }), { from: '2000-11', to: '2012-12' });
  assert.equal(spanFromManifest({}), null);
});

test('currentMonth is YYYY-MM in UTC', () => assert.equal(currentMonth(now), '2026-11'));

test('presets clamp to the span', () => {
  assert.deepEqual(presetRange('all', span, now), span);
  assert.deepEqual(presetRange('10y', span, now), { from: '2016-11', to: '2026-10' });
  assert.deepEqual(presetRange('year', span, now), { from: '2026-01', to: '2026-10' });
});

test('presets clamp when the span is short and old (fixtures)', () => {
  const s = { from: '2000-11', to: '2012-12' };
  assert.deepEqual(presetRange('10y', s, now), { from: '2003-01', to: '2012-12' });
  assert.deepEqual(presetRange('year', s, now), { from: '2012-01', to: '2012-12' });
  assert.deepEqual(presetRange('10y', { from: '2010-05', to: '2012-12' }, now), { from: '2010-05', to: '2012-12' });
});

test('presets without a span: All unavailable, others use now', () => {
  assert.equal(presetRange('all', null, now), null);
  assert.deepEqual(presetRange('year', null, now), { from: '2026-01', to: '2026-12' });
  assert.equal(presetRange('nope', span, now), null);
});

test('validateRange rejects from > to, bad format and out of span', () => {
  assert.deepEqual(validateRange('2020-01', '2021-01', span), { from: null, to: null });
  const r = validateRange('2021-01', '2020-01', span);
  assert.ok(r.from && r.to);
  assert.ok(validateRange('', '2020-01', span).from);
  assert.ok(validateRange('2020-13', '2020-01', span).from);
  assert.ok(validateRange('1999-01', '2020-01', span).from);
  assert.ok(validateRange('2020-01', '2030-01', span).to);
  assert.deepEqual(validateRange('2020-01', '2020-01'), { from: null, to: null });
});
