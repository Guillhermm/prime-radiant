import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, validateAll, latestCompleteMonth, brazilDomain } from './mock-data.mjs';
import { seriesForAoi } from '../core/index.js';

const opts = { last: '2019-12', now: new Date('2026-11-14T10:00:00Z') };
const data = generate(opts);
const month = (mo) => 2000 * 12 + 10 + mo; // index from 2000-11 to months since year 0
const yearOf = (mo) => Math.floor(month(mo) / 12);

test('latest complete month is the month before today', () => {
  assert.equal(latestCompleteMonth(new Date('2026-11-14T00:00:00Z')), '2026-10');
  assert.equal(latestCompleteMonth(new Date('2027-01-02T00:00:00Z')), '2026-12');
});

test('manifest, fine and coarse tiles and the domain pass core/schema.js', () => {
  assert.deepEqual(validateAll(data), []);
  assert.ok(data.manifest.tiles.length > 5);
  assert.deepEqual(Object.keys(data.coarse).sort(), Object.keys(data.tiles).sort());
});

test('manifest has the pipeline shape: noaa20 coverage, partial months, Brazil domain, satellite names', () => {
  const m = data.manifest;
  assert.deepEqual(m.coverage, { modis: ['2000-11', '2019-12'], viirs: ['2012-01', '2019-12'], noaa20: ['2018-04', '2019-12'] });
  assert.deepEqual(m.partial_months, { modis: [], viirs: ['2012-01'], noaa20: [] });
  assert.deepEqual(m.domain, { id: 'ne10m-brazil', version: '5.1.2', file: 'domain.json', res: 0.1 });
  assert.deepEqual(m.satellites.viirs, ['S-NPP']);
  assert.ok(m.tiles.every((id) => /^x\d+y\d+$/.test(id)));
});

test('S-NPP ends at 2026-10 while MODIS and NOAA-20 go on; a sensor with no month yet has null coverage', () => {
  const late = generate({ ...opts, last: '2026-12' }).manifest.coverage;
  assert.deepEqual(late.viirs, ['2012-01', '2026-10']);
  assert.deepEqual(late.noaa20, ['2018-04', '2026-12']);
  const early = generate({ ...opts, last: '2005-12' }).manifest;
  assert.equal(early.coverage.viirs, null);
  assert.equal(early.coverage.noaa20, null);
  assert.deepEqual(early.partial_months.viirs, []);
});

test('marked synthetic through dataVersion and citation', () => {
  assert.equal(data.manifest.dataVersion, 'synthetic-20261114');
  assert.match(data.manifest.citation, /SYNTHETIC/);
});

test('same seed gives the same output, another seed does not', () => {
  assert.deepEqual(generate(opts), data);
  assert.notDeepEqual(generate({ ...opts, seed: 1 }).tiles, data.tiles);
});

test('every fire lies inside the Brazil domain; an area outside reads as outside-domain', () => {
  const { domain } = brazilDomain();
  assert.deepEqual(data.domain, domain);
  const tiles = { fine: data.tiles, coarse: data.coarse };
  const pantanal = seriesForAoi([-58, -20, -55, -15], tiles, data.manifest, { domain });
  assert.ok(pantanal.modis.values.some((v) => v > 0));
  const atlantic = seriesForAoi([-30, -20, -28, -18], tiles, data.manifest, { domain });
  assert.deepEqual(atlantic.domain, { cells: 400, inside: 0, partial: false });
  assert.ok(atlantic.modis.values.every((v) => v === null));
});

test('VIIRS a few times MODIS, NOAA-20 close to VIIRS, MODIS never above the days of a month', () => {
  const sum = { modis: 0, viirs: 0, noaa20: 0, overlapModis: 0, overlapViirs: 0 };
  for (const t of Object.values(data.tiles)) {
    t.month.forEach((mo, i) => {
      assert.ok(t.modis[i] <= 31);
      if (t.viirs[i] !== null) { sum.overlapModis += t.modis[i]; sum.overlapViirs += t.viirs[i]; }
      if (t.noaa20[i] !== null) { sum.noaa20 += t.noaa20[i]; sum.viirs += t.viirs[i]; }
    });
  }
  const r = sum.overlapViirs / sum.overlapModis;
  assert.ok(r > 1.8 && r < 4.5, `R ${r}`);
  const k = sum.viirs / sum.noaa20;
  assert.ok(k > 0.85 && k < 1.15, `K ${k}`);
});

test('Brazil south of the equator peaks in Aug-Oct, and extreme years stand out', () => {
  const byMonth = Array(12).fill(0);
  const years = {};
  for (const id of ['x12y7', 'x12y8', 'x13y7']) {
    const t = data.tiles[id];
    t.month.forEach((mo, i) => {
      assert.ok(t.modis[i] > 0 || t.viirs[i] > 0 || t.noaa20[i] > 0, 'rows are sparse');
      byMonth[month(mo) % 12] += t.modis[i];
      years[yearOf(mo)] = (years[yearOf(mo)] ?? 0) + t.modis[i];
    });
  }
  assert.ok([8, 9, 10].includes(byMonth.indexOf(Math.max(...byMonth)) + 1));
  assert.ok(years[2010] > 1.5 * years[2009], `2010 ${years[2010]} vs 2009 ${years[2009]}`);
});
