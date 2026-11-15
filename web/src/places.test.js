import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heatBin, HEAT_LABELS, centerLabel, hotspotPresets, placeLabel, hotspotLabels, hotspotAt, valueLine, sensorValueLine, defaultArea, suggestionCaption,
  drawerModel, mapModel, squareFor, stepSquare, squareText,
} from './places.js';

const overview = {
  region: { id: 'r', name: 'Testland' }, sensor: 'viirs', year: 2025,
  // A 3x2 block with a gap at (-44, -6), and one square two degrees east of the block.
  cells: [[-46, -7, 0], [-45, -7, 3391], [-44, -7, 49], [-46, -6, 50], [-45, -6, 2000], [-41, -6, 1999]],
  hotspots: [{ bbox: [-45, -7, -44, -6], value: 3391 }, { bbox: [-41, -6, -40, -5], value: 1999, place: { country: 'Testland', state: 'Eaststate' } }],
};

test('heat classes have fixed edges, zero apart from 1-49', () => {
  assert.deepEqual([0, 1, 49, 50, 199, 200, 499, 500, 999, 1000, 1999, 2000, 36500].map(heatBin), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.equal(HEAT_LABELS.length, 7);
});

test('labels: the center of a 1 degree square, and the value with its year', () => {
  assert.equal(centerLabel([-45, -7, -44, -6]), '6.5°S 44.5°W');
  assert.equal(centerLabel([10, 0, 11, 1]), '0.5°N 10.5°E');
  assert.equal(valueLine(3391, overview), '3,391 fire-cell-days in 2025');
  assert.equal(sensorValueLine(1201, overview), '1,201 VIIRS fire-cell-days in 2025');
});

test('hotspots become example areas in rank order, labeled by place when the file has one', () => {
  const p = hotspotPresets(overview);
  assert.deepEqual(p.map((x) => [x.id, x.rank, x.label, x.coords, x.value]), [
    ['hotspot-1', 1, '6.5°S 44.5°W', null, 3391],
    ['hotspot-2', 2, 'Eaststate, Testland', '5.5°S 40.5°W', 1999],
  ]);
  // The area name a pick carries: the place only, never the coordinates.
  assert.deepEqual(p.map((x) => x.name), [null, 'Eaststate, Testland']);
  assert.deepEqual(hotspotPresets(null), []);
});

test('place labels: state and country, country alone, or none', () => {
  assert.equal(placeLabel({ place: { country: 'Testland', state: 'North' } }), 'North, Testland');
  assert.equal(placeLabel({ place: { country: 'Testland', state: null } }), 'Testland');
  assert.equal(placeLabel({ bbox: [0, 0, 1, 1] }), null);
  assert.deepEqual(hotspotLabels({ bbox: [-45, -7, -44, -6] }), { label: '6.5°S 44.5°W', coords: null });
  assert.equal(hotspotAt(overview, [-41, -6, -40, -5]).value, 1999);
  assert.equal(hotspotAt(overview, [0, 0, 1, 1]), null);
});

test('default area: the link wins, then the last chosen area, then the suggestion', () => {
  const link = [1, 1, 2, 2];
  const last = [3, 3, 4, 4];
  const hot = [5, 5, 6, 6];
  assert.deepEqual(defaultArea({ bbox: link, last, suggestion: hot }), { bbox: link, kind: 'hash' });
  assert.deepEqual(defaultArea({ last, suggestion: hot }), { bbox: last, kind: 'last' });
  assert.deepEqual(defaultArea({ suggestion: hot }), { bbox: hot, kind: 'suggested' });
  assert.equal(defaultArea({}), null);
});

test('copy names the region from the file, or stays generic without one', () => {
  const m = drawerModel(overview, { home: true });
  assert.equal(m.title, 'Where did it burn in 2025?');
  assert.equal(m.unit, 'Fire-cell-days of 0.1° cells, summed per 1° square · VIIRS S-NPP 2025 · Testland');
  assert.equal(m.listTitle, 'Hottest in Testland');
  assert.equal(m.listSub, 'Most fire activity in 2025, one sensor');
  assert.equal(m.border, 'Squares on the edge of Testland count only the part inside it.');
  assert.equal(m.primary, 'Open calendar');
  const g = drawerModel({ ...overview, region: null, sensor: 'noaa20' });
  assert.equal(g.listTitle, 'Hottest areas');
  assert.equal(g.unit, 'Fire-cell-days of 0.1° cells, summed per 1° square · VIIRS NOAA-20 2025');
  assert.match(g.border, /edge of the data domain/);
  assert.equal(g.primary, 'Use this area');
  assert.equal(g.rowSub, null);
  assert.deepEqual(drawerModel(null), { title: 'Choose an area', unit: null, primary: 'Use this area' });
  assert.equal(suggestionCaption(overview), 'Suggested: the 1° area with most VIIRS fire-cell-days in Testland, 2025. Rings are years, slices are months.');
  assert.equal(suggestionCaption({ ...overview, region: null }), 'Suggested: the 1° area with most VIIRS fire-cell-days in the data, 2025. Rings are years, slices are months.');
  for (const t of [m.unit, m.border, g.unit, suggestionCaption(overview)]) assert.doesNotMatch(t, /Brazil/);
});

test('map model: extent from the cells, squares with their class, hotspot ranks', () => {
  const mm = mapModel(overview);
  assert.deepEqual([mm.west, mm.east, mm.south, mm.north], [-46, -40, -7, -5]);
  assert.equal(mm.squares.length, 6);
  assert.equal(mm.byKey.get('-45,-7').bin, 6);
  assert.equal(mm.ranks.get('-45,-7'), 1);
  assert.equal(squareFor(mm, [-45, -7, -44, -6]).value, 3391);
  assert.equal(squareFor(mm, [-45, -7, -43, -6]), null, 'not a 1 degree square');
  assert.equal(squareFor(mm, [0, 0, 1, 1]), null, 'no square there');
  assert.equal(mapModel({ cells: [] }), null);
});

test('keys: arrows move a degree and skip gaps, stop at the edge, Shift moves five, Home goes to hotspot 1', () => {
  const mm = mapModel(overview);
  const at = (k) => mm.byKey.get(k);
  assert.equal(stepSquare(mm, at('-46,-7'), 'ArrowRight').key, '-45,-7');
  assert.equal(stepSquare(mm, at('-46,-7'), 'ArrowUp').key, '-46,-6', 'up is north');
  assert.equal(stepSquare(mm, at('-45,-6'), 'ArrowRight').key, '-41,-6', 'skips the gap to the next square east');
  assert.equal(stepSquare(mm, at('-41,-6'), 'ArrowRight').key, '-41,-6', 'stays at the edge');
  assert.equal(stepSquare(mm, at('-46,-6'), 'ArrowRight', { by: 5 }).key, '-41,-6');
  assert.equal(stepSquare(mm, at('-41,-6'), 'Home').key, '-45,-7');
  assert.equal(stepSquare(mm, at('-41,-6'), 'Tab'), null, 'not a map key');
  assert.equal(squareText(mm, at('-45,-7'), overview), '6.5°S 44.5°W, 3,391 fire-cell-days in 2025, hotspot 1.');
  assert.equal(squareText(mm, at('-46,-7'), overview), '6.5°S 45.5°W, 0 fire-cell-days in 2025.');
});
