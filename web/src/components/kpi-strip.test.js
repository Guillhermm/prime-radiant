import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kpiCards, sensorEra } from './kpi-strip.js';

const cov = { modis: ['2000-11', '2012-12'], viirs: ['2012-02', '2012-12'] };
const cell = (o) => ({ year: 2012, month: 10, value: 10, status: 'harmonized', estimated: true, ...o });

test('sensorEra by month', () => {
  assert.equal(sensorEra(cov, '2012-10'), 'MODIS+VIIRS');
  assert.equal(sensorEra(cov, '2012-01'), 'MODIS');
  assert.equal(sensorEra(cov, '2001-01'), 'MODIS');
  assert.equal(sensorEra(cov, '1999-01'), null);
});

test('current month vs median with years used', () => {
  const [cur] = kpiCards([cell({ value: 1204, median: 872 })], { total: 1204 }, { yearsUsed: 22 });
  assert.equal(cur.title, 'Oct 2012 vs median');
  assert.equal(cur.value, '1,204');
  assert.equal(cur.delta, '+38%');
  assert.equal(cur.note, 'median of 22 yrs: 872');
});

test('below the median shows a minus sign, equal median 0 is not a division', () => {
  assert.equal(kpiCards([cell({ value: 50, median: 100 })], { total: 50 })[0].delta, '-50%');
  assert.equal(kpiCards([cell({ value: 0, median: 0 })], { total: 0 })[0].delta, 'equal to the median');
  assert.equal(kpiCards([cell({ value: 3, median: 0 })], { total: 3 })[0].delta, 'median is 0');
});

test('missing median says not enough history, never 0', () => {
  const [cur] = kpiCards([cell({ value: 7 })], { total: 7 });
  assert.equal(cur.value, '7');
  assert.equal(cur.delta, null);
  assert.equal(cur.note, 'Not enough history for a median');
});

test('null current month is No data, not 0', () => {
  const [cur, total] = kpiCards([cell({ value: null, status: 'no-data', estimated: false })], { total: 0 });
  assert.equal(cur.value, 'No data');
  assert.equal(total.value, 'No data');
});

test('zero total with data says sensors were operating', () => {
  const cards = kpiCards([cell({ value: 0, estimated: false, status: 'observed' })], { total: 0 }, { coverage: cov });
  assert.equal(cards[1].value, '0');
  assert.match(cards[1].note, /sensors were operating/);
  assert.equal(cards[2].value, 'MODIS+VIIRS');
});

test('partial month is named in the title; empty list gives total and era only', () => {
  assert.match(kpiCards([cell({ status: 'partial' })], { total: 10 })[0].title, /partial month/);
  assert.deepEqual(kpiCards([], { total: 0 }).map((c) => c.id), ['total', 'era']);
});
