import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, validateAll, latestCompleteMonth, inPolygon, REGIONS } from './mock-data.mjs';

const opts = { last: '2014-12', now: new Date('2026-11-14T10:00:00Z') };
const data = generate(opts);

test('latest complete month is the month before today', () => {
  assert.equal(latestCompleteMonth(new Date('2026-11-14T00:00:00Z')), '2026-10');
  assert.equal(latestCompleteMonth(new Date('2027-01-02T00:00:00Z')), '2026-12');
});

test('manifest and tiles pass core/schema.js', () => {
  assert.deepEqual(validateAll(data), []);
  assert.ok(data.manifest.tiles.length > 10);
});

test('manifest is marked synthetic through dataVersion and citation', () => {
  assert.equal(data.manifest.dataVersion, 'synthetic-20261114');
  assert.match(data.manifest.citation, /SYNTHETIC/);
});

test('same seed gives the same output, another seed does not', () => {
  assert.deepEqual(generate(opts), data);
  assert.notDeepEqual(generate({ ...opts, seed: 1 }).tiles, data.tiles);
});

test('VIIRS is null before 2012-01 and present after; MODIS counts never exceed the days of a month', () => {
  const viirsFrom = 11 * 12 + 2; // 2000-11 .. 2012-01
  let viirsRows = 0;
  for (const t of Object.values(data.tiles)) {
    t.month.forEach((mo, i) => {
      assert.equal(t.viirs[i] === null, mo < viirsFrom);
      assert.ok(t.modis[i] <= 31);
      if (t.viirs[i] !== null) viirsRows++;
    });
  }
  assert.ok(viirsRows > 0);
});

test('VIIRS totals are a few times MODIS where both exist', () => {
  let m = 0;
  let v = 0;
  for (const t of Object.values(data.tiles)) t.month.forEach((_, i) => { if (t.viirs[i] !== null) { m += t.modis[i]; v += t.viirs[i]; } });
  assert.ok(v / m > 1.8 && v / m < 4.5, `ratio ${v / m}`);
});

test('Brazil peaks in Aug-Oct, California in summer-autumn', () => {
  const byMonth = (tileIds) => {
    const sum = Array(12).fill(0);
    for (const id of tileIds) {
      const t = data.tiles[id];
      if (t) t.month.forEach((mo, i) => { sum[(mo + 10) % 12] += t.modis[i]; });
    }
    return sum;
  };
  const peak = (s) => s.indexOf(Math.max(...s)) + 1;
  assert.ok([8, 9, 10].includes(peak(byMonth(['0.1/x12y8', '0.1/x12y7', '0.1/x13y8']))));
  assert.ok([7, 8, 9, 10].includes(peak(byMonth(Object.keys(data.tiles).filter((id) => /x6y12|x5y12|x5y11|x6y11/.test(id))))));
});

test('rows are sparse: no all-zero rows, and extreme years stand out', () => {
  const years = {};
  for (const t of Object.values(data.tiles)) {
    t.month.forEach((mo, i) => {
      assert.ok(t.modis[i] > 0 || t.viirs[i] > 0);
      const y = 2000 + Math.floor((mo + 10) / 12);
      years[y] = (years[y] ?? 0) + t.modis[i];
    });
  }
  assert.ok(years[2010] > 1.5 * years[2009], `2010 ${years[2010]} vs 2009 ${years[2009]}`);
});

test('point in polygon', () => {
  assert.equal(inPolygon(-55, -10, REGIONS[0].polygon), true);
  assert.equal(inPolygon(-30, -10, REGIONS[0].polygon), false);
});
