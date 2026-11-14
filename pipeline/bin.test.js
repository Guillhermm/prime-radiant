import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binRecords, familyOf, createBinResult } from './bin.js';
import { locate } from '../core/grid.js';

const rec = (o) => ({ sensor: 'modis', satellite: 'Terra', lat: 10.05, lon: 20.05, utcDay: '2020-03-05', hasType: true, ...o });
const month0 = '2000-11';
const midx = 232; // 2020-03 minus 2000-11
const at = (r, fam, lon, lat) => {
  const l = locate(lon, lat);
  const m = r.counts[fam]?.[l.tile]?.[l.cell];
  return m && Object.fromEntries(m);
};

test('Terra and Aqua same cell/day count once', async () => {
  const r = await binRecords([rec({}), rec({ satellite: 'Aqua', lat: 10.07, lon: 20.08 })], { month0 });
  assert.deepEqual(at(r, 'modis', 20.05, 10.05), { [midx]: 1 });
  assert.equal(r.stats.duplicates, 1);
  assert.equal(r.stats.counted, 1);
});

test('different days in the same month sum', async () => {
  const r = await binRecords([rec({}), rec({ utcDay: '2020-03-06' })], { month0 });
  assert.deepEqual(at(r, 'modis', 20.05, 10.05), { [midx]: 2 });
});

test('cell edge goes to east/north cell', async () => {
  const r = await binRecords([rec({ lon: 20.1, lat: 10.1 })], { month0 });
  assert.equal(at(r, 'modis', 20.15, 10.15)[midx], 1);
  assert.equal(at(r, 'modis', 20.05, 10.05), undefined);
});

test('lon +180 equals -180', async () => {
  const r = await binRecords([rec({ lon: 180 }), rec({ lon: -180, satellite: 'Aqua' })], { month0 });
  assert.equal(at(r, 'modis', -180, 10.05)[midx], 1);
  assert.equal(r.stats.duplicates, 1);
});

test('NOAA-20 reaches noaa20, never viirs; same cell/day as SNPP both count', async () => {
  const r = await binRecords([
    rec({ sensor: 'viirs', satellite: 'NOAA20' }),
    rec({ sensor: 'viirs', satellite: 'SNPP' }),
  ], { month0 });
  assert.equal(at(r, 'noaa20', 20.05, 10.05)[midx], 1);
  assert.equal(at(r, 'viirs', 20.05, 10.05)[midx], 1);
});

test('NOAA-21 is skipped and counted', async () => {
  const r = await binRecords([rec({ sensor: 'viirs', satellite: 'NOAA21' })], { month0 });
  assert.deepEqual(r.counts, {});
  assert.deepEqual(r.stats.skipped, { NOAA21: 1 });
});

test('Terra-only era is its own family; Aqua start day switches to modis', () => {
  assert.equal(familyOf(rec({ utcDay: '2002-07-03' })), 'modis_terra_only');
  assert.equal(familyOf(rec({ utcDay: '2002-07-04' })), 'modis');
  assert.equal(familyOf(rec({ sensor: 'viirs', satellite: 'Terra' })), null);
});

test('bad coordinate and pre-month0 days are rejected', async () => {
  const r = await binRecords([rec({ lat: 95 }), rec({ utcDay: '2000-10-31' }), rec({ utcDay: 'x' })], { month0 });
  assert.equal(r.stats.rejected, 3);
  assert.deepEqual(r.counts, {});
});

test('async iterable, accumulating across years', async () => {
  async function* y(day) { yield rec({ utcDay: day }); }
  const into = createBinResult();
  await binRecords(y('2020-03-05'), { month0, into });
  await binRecords(y('2021-03-05'), { month0, into });
  const months = at(into, 'modis', 20.05, 10.05);
  assert.deepEqual(months, { [midx]: 1, [midx + 12]: 1 });
  assert.equal(into.stats.read, 2);
});

test('records without a type field (NRT) never enter archive counts silently', async () => {
  const r = await binRecords([rec({ hasType: false }), rec({ hasType: false, utcDay: '2020-03-06' })], { month0 });
  assert.deepEqual(r.counts, {});
  assert.deepEqual(r.stats.skipped, { no_type: 2 });
  const live = await binRecords([rec({ hasType: false })], { month0, allowNoType: true });
  assert.equal(live.stats.counted, 1);
});

test('one year split over two calls is still deduplicated; dropYear frees it', async () => {
  const into = createBinResult();
  await binRecords([rec({})], { month0, into });
  await binRecords([rec({ satellite: 'Aqua' })], { month0, into });
  assert.equal(at(into, 'modis', 20.05, 10.05)[midx], 1);
  assert.equal(into.stats.duplicates, 1);
  into.dedupe.dropYear(2020);
  assert.equal(into.dedupe.size(), 0);
});
