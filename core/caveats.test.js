import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAVEAT_IDS, DEFAULT_GATES, NO_GATES, caveat, catalog, caveatsFor } from './caveats.js';

test('catalog: nine caveats plus anomaly caveats and flags, short and long text, unique ids', () => {
  const all = catalog();
  assert.equal(all.filter((c) => c.kind === 'caveat').length, 9);
  assert.deepEqual(all.filter((c) => c.kind === 'flag').map((c) => c.id),
    ['unconfirmed', 'cross-era', 'sparse-baseline', 'estimated', 'viirs-outage-filled', 'viirs-not-archived', 'terra-only',
      'low-confidence', 'partial-domain', 'outside-domain']);
  assert.equal(all.filter((c) => c.kind === 'anomaly').length, 6);
  assert.equal(all.filter((c) => c.kind === 'live').length, 4);
  assert.equal(new Set(CAVEAT_IDS).size, CAVEAT_IDS.length);
  for (const c of all) assert.ok(c.short && c.long && c.long.length >= c.short.length, c.id);
});

test('preliminary: after V1 and V2 only the near-real-time items stay preliminary', () => {
  assert.deepEqual(catalog().filter((c) => c.preliminary).map((c) => c.id),
    ['nrt-unfiltered', 'live-nrt', 'live-not-harmonized', 'live-unfiltered', 'live-provisional']);
  assert.equal(DEFAULT_GATES['not-validated'], 'passed');
});

test('preliminary: with no gate passed every item is preliminary; map flips only passed ids', () => {
  assert.ok(catalog(NO_GATES).every((c) => c.preliminary));
  const g = { ...NO_GATES, 'unit-fire-cell-days': 'passed' };
  assert.equal(caveat('unit-fire-cell-days', g).preliminary, false);
  assert.equal(caveat('brazil-only', g).preliminary, true);
  assert.equal(caveat('brazil-only', {}).preliminary, true);
  assert.throws(() => caveat('nope'), RangeError);
});

const ids = (r, o) => caveatsFor(r, o).map((c) => c.id);

test('caveatsFor: always-on set for a plain AOI result', () => {
  const r = { series: { flags: [] }, R: { level: 'aoi' }, K: null };
  assert.deepEqual(ids(r), ['unit-fire-cell-days', 'no-confidence-filter', 'detection-limits', 'archive-lag',
    'brazil-only']);
  assert.deepEqual(ids(r, { gates: NO_GATES }), ['unit-fire-cell-days', 'no-confidence-filter',
    'detection-limits', 'archive-lag', 'not-validated', 'brazil-only']);
});

test('caveatsFor: estimated, wide level, low confidence, flags, live', () => {
  const r = { series: { flags: [{ month: '2010-01', flag: 'estimated' }, { month: '2000-01', flag: 'terra-only' },
    { month: null, flag: 'low-confidence' }] }, R: { level: 'tiles' }, K: { level: 'aoi' } };
  const got = ids(r, { live: true, flags: ['partial-domain'] });
  for (const id of ['estimated-before-viirs', 'regional-ratio', 'nrt-unfiltered', 'estimated', 'terra-only',
    'low-confidence', 'partial-domain']) assert.ok(got.includes(id), id);
  assert.ok(!got.includes('outside-domain') && !got.includes('viirs-not-archived'));
  assert.ok(ids({ series: {}, R: { level: 'global' } }).includes('regional-ratio'));
  assert.ok(!ids({ series: { flags: [{ month: null, flag: 'low-confidence' }] }, R: { level: 'aoi' } }).includes('regional-ratio'));
});

test('caveatsFor: anomaly results add the five anomaly caveats and the label flags they carry', () => {
  const base = { series: { flags: [] } };
  assert.ok(!ids(base).includes('anomaly-rule'));
  const plain = ids({ ...base, anomaly: { labels: [[], []] } });
  for (const id of ['anomaly-rule', 'anomaly-small-n', 'anomaly-scaled-years', 'anomaly-sparse', 'anomaly-archive']) assert.ok(plain.includes(id), id);
  assert.ok(!plain.includes('cross-era') && !plain.includes('sparse-baseline'));
  const both = ids({ ...base, anomaly: { labels: [['cross-era'], [], ['sparse-baseline']] } });
  assert.ok(both.includes('cross-era') && both.includes('sparse-baseline'));
});

test('caveatsFor: the viirs-outage-filled series flag adds its explanation', () => {
  assert.ok(ids({ series: { flags: [{ month: '2022-07', flag: 'viirs-outage-filled' }] } }).includes('viirs-outage-filled'));
});
