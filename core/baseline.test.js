import test from 'node:test';
import assert from 'node:assert/strict';
import { baseline } from './baseline.js';
import { validateSeries } from './schema.js';

/** January-only helper: one value per year starting `y0`, other months filled with 0 via 12-step series. */
const yearly = (y0, vals) => {
  const values = [];
  vals.forEach((v) => { values.push(v, ...Array(11).fill(0)); });
  return { id: 'harmonized', unit: 'fire-cell-days', start: `${y0}-01`, values, method: { id: 'x', version: 1 }, comparable: true };
};
const janIdx = (k) => k * 12;

test('odd count: median of earlier years, own year excluded', () => {
  const b = baseline(yearly(2013, [5, 1, 9, 3, 7, 100]), { minYears: 5 });
  assert.equal(b.series.values[janIdx(5)], 5); // sorted 1,3,5,7,9
  assert.deepEqual(b.yearsUsed[janIdx(5)], [2013, 2014, 2015, 2016, 2017]);
  assert.equal(b.reasons[janIdx(5)], null);
});

test('even count averages the two middles', () => {
  const b = baseline(yearly(2013, [1, 2, 10, 20, 3, 4, 0]), { minYears: 6 });
  assert.equal(b.series.values[janIdx(6)], 3.5); // 1,2,3,4,10,20 -> (3+4)/2
});

test('fewer than minYears: null with reason; default is 5', () => {
  const s = yearly(2013, [1, 2, 3, 4, 5]);
  const b = baseline(s);
  assert.equal(b.series.values[janIdx(4)], null);
  assert.match(b.reasons[janIdx(4)], /4 .*need 5/);
  assert.deepEqual(b.yearsUsed[janIdx(4)], [2013, 2014, 2015, 2016]);
  assert.equal(baseline(s, { minYears: 3 }).series.values[janIdx(4)], 2.5);
});

test('null is not counted as 0', () => {
  const b = baseline(yearly(2013, [4, null, 6, null, 8, 0]), { minYears: 3 });
  assert.equal(b.series.values[janIdx(5)], 6); // 4,6,8 not 0,4,6,8...
  assert.deepEqual(b.yearsUsed[janIdx(5)], [2013, 2015, 2017]);
});

test('zero is a real value and a zero history gives 0', () => {
  const b = baseline(yearly(2013, [0, 0, 0, 0, 0, 3]), { minYears: 5 });
  assert.equal(b.series.values[janIdx(5)], 0);
});

test('partialMonths (outages) are excluded', () => {
  const s = yearly(2013, [1, 2, 3, 4, 5, 6, 7]);
  const b = baseline(s, { minYears: 5, partialMonths: ['2013-01', '2015-01'] });
  assert.deepEqual(b.yearsUsed[janIdx(6)], [2014, 2016, 2017, 2018]);
  assert.equal(b.series.values[janIdx(6)], null);
});

test('VIIRS S-NPP partial months 2012-01 and 2026-11 are always excluded', () => {
  const values = Array(12 * 18).fill(1); // 2010-01 .. 2027-12
  const s = { id: 'harmonized', unit: 'fire-cell-days', start: '2010-01', values, method: { id: 'x', version: 1 }, comparable: true };
  const b = baseline(s, { minYears: 1 });
  assert.ok(!b.yearsUsed[(2013 - 2010) * 12].includes(2012));
  assert.deepEqual(b.yearsUsed[(2013 - 2010) * 12 + 1], [2010, 2011, 2012]); // 2012-02 counts
  const nov = (y) => b.yearsUsed[(y - 2010) * 12 + 10];
  assert.ok(!nov(2027).includes(2026));
  assert.ok(nov(2027).includes(2025));
});

test('Terra-only era and partial 2002-07 are excluded, 2002-08 onward counts', () => {
  const values = Array(12 * 8).fill(10); // 2002-01 .. 2009-12
  const s = { id: 'modis', unit: 'fire-cell-days', start: '2002-01', values, method: { id: 'x', version: 1 }, comparable: true };
  const b = baseline(s, { minYears: 1 });
  const jul2009 = (2009 - 2002) * 12 + 6, aug2009 = jul2009 + 1, jan2009 = (2009 - 2002) * 12;
  assert.deepEqual(b.yearsUsed[jul2009], [2003, 2004, 2005, 2006, 2007, 2008]); // 2002-07 out
  assert.deepEqual(b.yearsUsed[aug2009], [2002, 2003, 2004, 2005, 2006, 2007, 2008]);
  assert.deepEqual(b.yearsUsed[jan2009], [2003, 2004, 2005, 2006, 2007, 2008]); // 2002-01 Terra-only
});

test('output passes the schema', () => {
  const b = baseline(yearly(2013, [1, 2, 3, 4, 5, 6]));
  assert.deepEqual(validateSeries(b.series), []);
  assert.equal(b.series.values.length, b.yearsUsed.length);
  assert.equal(b.reasons.length, b.yearsUsed.length);
});
