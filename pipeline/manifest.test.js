import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoverage, buildManifest, coverageIndexes } from './manifest.js';
import { validateManifest } from '../core/schema.js';

const rec = (sensor, satellite, utcDay, hasType = true) => ({ sensor, satellite, utcDay, hasType, lat: 0, lon: 0 });
function days(list) {
  const c = createCoverage();
  list.forEach((r) => c.add(r));
  return c.days();
}
const base = [
  rec('modis', 'Terra', '2002-01-05'), rec('modis', 'Aqua', '2002-07-04'), rec('modis', 'Aqua', '2002-09-30'),
  rec('viirs', 'SNPP', '2012-01-20'), rec('viirs', 'SNPP', '2012-03-31'),
  rec('viirs', 'NOAA20', '2018-04-01'), rec('viirs', 'NOAA20', '2018-04-15'),
];
const make = (d) => buildManifest({ month0: '2000-01', days: d, tiles: ['x1y1'], dataVersion: 'v', generatedAt: '2026-11-14T00:00:00Z' });

test('coverage is first to last archive day per sensor, Terra-only counted as modis', () => {
  assert.deepEqual(days(base).modis, { first: '2002-01-05', last: '2002-09-30' });
});
test('NRT records, NOAA-21 and unknown satellites do not extend coverage', () => {
  const d = days([...base, rec('viirs', 'SNPP', '2026-11-01', false), rec('viirs', 'NOAA21', '2024-01-01')]);
  assert.equal(d.viirs.last, '2012-03-31');
});
test('partial months: start mid-month, end before month end; full months are not partial', () => {
  const m = make(days(base));
  assert.deepEqual(m.partial_months, { modis: ['2002-01'], viirs: ['2012-01'], noaa20: ['2018-04'] });
  assert.deepEqual(m.coverage.modis, ['2002-01', '2002-09']);
  assert.equal(m.last_month, '2018-04');
});
test('a single partial month is listed once', () => {
  const m = make(days([...base.slice(0, 5), rec('viirs', 'NOAA20', '2018-04-05'), rec('viirs', 'NOAA20', '2018-04-06')]));
  assert.deepEqual(m.partial_months.noaa20, ['2018-04']);
});
test('manifest passes the schema; coverage indexes count from month0', () => {
  const m = make(days(base));
  assert.deepEqual(validateManifest(m), []);
  assert.deepEqual(coverageIndexes(m).viirs, [144, 146]);
  assert.equal(m.satellites.eras.modis_aqua_from, '2002-07-04');
  assert.match(m.citation, /Fire Information for Resource Management System/);
});
test('a sensor with no records warns and gets null coverage; the build still validates', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const m = make(days(base.slice(0, 5)));
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /no archive records for noaa20/);
  assert.equal(m.coverage.noaa20, null);
  assert.deepEqual(m.partial_months.noaa20, []);
  assert.equal(coverageIndexes(m).noaa20, null);
  assert.equal(m.last_month, '2012-03');
  assert.deepEqual(validateManifest(m), []);
});
test('no records for any sensor is still an error', () => {
  assert.throws(() => make({}), /no archive records for any sensor/);
});
test('a domain passes through to the manifest', () => {
  const domain = { id: 'd', version: '1', file: 'domain.json', res: 0.1 };
  const m = buildManifest({ month0: '2000-01', days: days(base), tiles: [], dataVersion: 'v', generatedAt: 'x', domain });
  assert.deepEqual(m.domain, domain);
});

test('acquisition days: a month with a gap inside a satellite span is partial for its sensor only', () => {
  const full = (sat, sensor, ym, n) => Array.from({ length: n }, (_, i) => rec(sensor, sat, `${ym}-${String(i + 1).padStart(2, '0')}`));
  const c = createCoverage();
  [...full('SNPP', 'viirs', '2022-06', 30), ...full('SNPP', 'viirs', '2022-07', 26), ...full('SNPP', 'viirs', '2022-08', 31),
    ...full('NOAA20', 'viirs', '2022-07', 31), ...full('Terra', 'modis', '2022-07', 31), ...full('Aqua', 'modis', '2022-07', 30)].forEach((r) => c.add(r));
  c.addDay('SNPP', '2022-07-27'); // an excluded-type record still proves the satellite acquired that day
  c.addDay('Aqua', '2022-07-31');
  const m = buildManifest({ month0: '2000-01', days: c.days(), acquisition: c.acquisition(), tiles: [], dataVersion: 'v', generatedAt: 'x' });
  assert.deepEqual(m.partial_months.viirs, ['2022-07']);
  assert.deepEqual(m.partial_months.modis, []);
  assert.deepEqual(m.partial_months.noaa20, []);
  assert.equal(m.acquisition_days.SNPP['2022-07'], 27);
  assert.deepEqual(validateManifest(m), []);
});
test('a satellite month between its first and last month with no record is partial', () => {
  const c = createCoverage();
  [rec('viirs', 'SNPP', '2022-05-01'), rec('viirs', 'SNPP', '2022-07-31')].forEach((r) => c.add(r));
  const m = buildManifest({ month0: '2000-01', days: c.days(), acquisition: c.acquisition(), tiles: [], dataVersion: 'v', generatedAt: 'x' });
  assert.ok(m.partial_months.viirs.includes('2022-06'));
});
