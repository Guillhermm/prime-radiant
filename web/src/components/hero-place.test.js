import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasRecord, heroRadiantLabel, NO_RECORD, previewCaption, recordStrip, previewModel, selectionLine } from './hero-place.js';
import { mapModel } from '../places.js';

const overview = {
  region: { id: 'r', name: 'Testland' }, sensor: 'viirs', year: 2025,
  cells: [[-45, -7, 3391], [-44, -7, 0], [-41, -6, 1999]],
  hotspots: [{ bbox: [-45, -7, -44, -6], value: 3391, place: { country: 'Testland', state: 'Weststate' } }, { bbox: [-41, -6, -40, -5], value: 1999 }],
};
const model = mapModel(overview);
const manifest = { month0: '2000-11', last_month: '2026-10' };

test('suggested: hotspot 1 by its place, the center and country under it, the value with its sensor', () => {
  const m = previewModel({ kind: 'suggested', bbox: [-45, -7, -44, -6], overview, model });
  assert.deepEqual([m.tag, m.note, m.heading, m.sub], ['Suggested', 'Hottest 1° area in Testland, 2025', 'Weststate', '6.5°S 44.5°W · Testland']);
  assert.deepEqual(m.value, { n: 3391, bin: 6, year: 2025, sensor: 'VIIRS S-NPP' });
  assert.equal(m.cta, true);
});

test('a pick: a hotspot says its rank, a plain square says it is a map square', () => {
  const hot = previewModel({ kind: 'pick', bbox: [-41, -6, -40, -5], overview, model });
  assert.deepEqual([hot.tag, hot.note, hot.heading, hot.sub], ['Your pick', 'Hotspot #2 in Testland', '5.5°S 40.5°W', 'Testland · 1° square, about 110 km across']);
  const plain = previewModel({ kind: 'pick', bbox: [-44, -7, -43, -6], overview, model });
  assert.equal(plain.note, '1° area on the map');
  assert.equal(plain.zero, true, 'a square with no fire that year');
  assert.equal(plain.value.n, 0, '0 is a value, not missing');
  assert.equal(previewModel({ kind: 'pick', bbox: [-44, -7, -43, -6], overview: { ...overview, region: null }, model }).sub, '1° square, about 110 km across');
});

test('current area: a named custom box shows its name and range, no value', () => {
  const m = previewModel({ kind: 'current', bbox: [-50, -12, -48, -10], name: 'Ranch', overview, model });
  assert.deepEqual([m.tag, m.note, m.heading, m.sub, m.value], ['Current area', null, 'Ranch', '12°S–10°S · 50°W–48°W', null]);
  assert.equal(previewModel({ kind: 'current', bbox: [-50, -12, -48, -10], overview, model }).heading, '12°S–10°S · 50°W–48°W');
});

test('without overview.json: the whole data region has no call to action; pending says nothing yet', () => {
  assert.deepEqual(previewModel({ kind: 'region' }), { tag: null, note: null, heading: 'Whole data region', sub: null, value: null, zero: false, cta: false });
  assert.equal(previewModel({ kind: 'pending' }).heading, '');
  const ex = previewModel({ kind: 'example', bbox: [-10, 40, 0, 50], label: 'Fixture area' });
  assert.deepEqual([ex.tag, ex.heading, ex.value, ex.cta], [null, 'Fixture area', null, true]);
});

test('captions: the record years from the manifest, the zero case, the whole region', () => {
  const m = previewModel({ kind: 'suggested', bbox: [-45, -7, -44, -6], overview, model });
  assert.equal(previewCaption(m, { manifest, overview, kind: 'suggested' }), '2000–2026. Rings are years, newest outside; slices are months. Pick a month to open it in the calendar.');
  const zero = previewModel({ kind: 'pick', bbox: [-44, -7, -43, -6], overview, model });
  assert.match(previewCaption(zero, { manifest, overview, kind: 'pick', synthetic: true }), /^No fire detected here in 2025\. Earlier years still show in the rings\. .*Synthetic data\.$/);
  assert.match(previewCaption(previewModel({ kind: 'region' }), { manifest, kind: 'region' }), /^The whole data region, 2000–2026\./);
});

test('labels for the Radiant and the phone selection bar', () => {
  assert.match(heroRadiantLabel('Weststate'), /^Fire calendar of Weststate: .*Enter opens the month in the calendar\.$/);
  assert.match(heroRadiantLabel(null), /loading/);
  assert.equal(selectionLine(previewModel({ kind: 'pick', bbox: [-45, -7, -44, -6], overview, model })), '3,391 in 2025 · Radiant updated above');
});

test('hasRecord: a record of only null months (no sensor there) has nothing to draw; zeros are a record', () => {
  assert.equal(hasRecord([{ value: null }, { value: null }]), false);
  assert.equal(hasRecord([{ value: null }, { value: 0 }]), true);
  assert.equal(hasRecord([]), false);
  assert.equal(NO_RECORD, 'No record for this area in the data.');
});

test('recordStrip: lanes on a 2000-to-latest axis from the manifest, with its accessible sentence', () => {
  const m = recordStrip({ coverage: { modis: ['2000-11', '2025-12'], viirs: ['2012-01', '2025-12'], noaa20: ['2018-04', '2025-12'] }, last_month: '2025-12' });
  assert.equal(m.label, 'MODIS from Nov 2000, VIIRS from Jan 2012, latest Dec 2025.');
  assert.equal(m.latest, 'Latest Dec 2025');
  assert.deepEqual(m.lanes.map((l) => [l.key, l.label, Number(l.from.toFixed(4)), l.to]), [['modis', 'MODIS 2000', Number((10 / 312).toFixed(4)), 1], ['viirs', 'VIIRS 2012', Number((144 / 312).toFixed(4)), 1]]);
  const short = recordStrip({ coverage: { modis: ['2000-11', '2019-12'] }, last_month: '2019-12' });
  assert.equal(short.label, 'MODIS from Nov 2000, latest Dec 2019.');
  assert.equal(recordStrip({ coverage: {} , last_month: '2019-12' }), null);
  assert.equal(recordStrip(null), null);
});
