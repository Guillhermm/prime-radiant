import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heatBin, HEAT_LABELS, centerLabel, hotspotPresets, placeLabel, hotspotLabels, hotspotAt, valueLine, sensorValueLine, defaultArea, suggestionCaption,
  drawerModel, mapModel, dataRegionBbox, regionCaption, squareFor, stepSquare, squareText,
  hotspotRowLabels, isZoomable, zoomWindow, inWindow,
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

test('dataRegionBbox: the domain cells when there is a domain, else the manifest tiles', () => {
  // Rows are latitude indexes from -90 at 0.1 deg, runs are inclusive longitude indexes from -180.
  const domain = { rows: { 562: [[1265, 1266]], 563: [[1264, 1268], [1270, 1272]], 600: [] } };
  assert.deepEqual(dataRegionBbox({ tiles: ['x0y0'] }, domain), [-53.6, -33.8, -52.7, -33.6]);
  assert.deepEqual(dataRegionBbox({ tiles: ['x17y13', 'x18y13', 'x17y14'] }), [-10, 40, 10, 60]);
  assert.equal(dataRegionBbox({ tiles: [] }), null);
  assert.equal(regionCaption(2000, 2026), 'The whole data region, 2000–2026. Rings are years, slices are months.');
});

test('hotspot rows: state over country, country over itself, coordinates without a place', () => {
  const long = { bbox: [23, -8, 24, -7], place: { country: 'Democratic Republic of the Congo', state: 'Kasaï-Oriental' } };
  assert.deepEqual(hotspotRowLabels(long), { title: 'Kasaï-Oriental', sub: 'Democratic Republic of the Congo', full: 'Kasaï-Oriental, Democratic Republic of the Congo' });
  assert.deepEqual(hotspotRowLabels({ bbox: [0, 0, 1, 1], place: { country: 'Testland', state: null } }), { title: 'Testland', sub: 'Testland', full: 'Testland' });
  assert.deepEqual(hotspotRowLabels({ bbox: [-45, -7, -44, -6] }), { title: '6.5°S 44.5°W', sub: null, full: '6.5°S 44.5°W' });
});

const world = { west: -180, east: 180, south: -60, north: 114 - 60 };

test('zoom: only an extent wider than 40 degrees', () => {
  assert.equal(isZoomable(mapModel(overview)), false);
  assert.equal(isZoomable(world), true);
  assert.equal(isZoomable({ west: 0, east: 40, south: 0, north: 10 }), false);
  assert.equal(isZoomable(null), false);
});

test('zoom window: 20 x 10 at most, narrower to keep a square at 24 px, kept inside the extent', () => {
  // 600 px wide: 30 px per degree already, so the full 20 x 10 window.
  assert.deepEqual(zoomWindow(world, [0, 0], 600, 300), { west: -10, north: 5, width: 20, height: 10 });
  // 344 px (a phone): 24 px / 0.9 deg sets the scale, about 12.9 deg wide.
  const phone = zoomWindow(world, [0, 0], 344, 172);
  assert.ok(Math.abs(phone.width - 12.9) < 0.01 && Math.abs(phone.height - 6.45) < 0.01);
  assert.ok((344 / phone.width) * 0.9 >= 24 - 1e-9);
  // At the corners it slides back inside the extent.
  assert.deepEqual(zoomWindow(world, [-179, 53], 600, 300), { west: -180, north: 54, width: 20, height: 10 });
  assert.deepEqual(zoomWindow(world, [179, -59], 600, 300), { west: 160, north: -50, width: 20, height: 10 });
});

test('a square is in the window only when all of it is', () => {
  const win = { west: -10, north: 5, width: 20, height: 10 };
  assert.equal(inWindow(win, { w: -10, s: -5 }), true);
  assert.equal(inWindow(win, { w: 9, s: 4 }), true);
  assert.equal(inWindow(win, { w: 10, s: 0 }), false);
  assert.equal(inWindow(win, { w: 0, s: 5 }), false);
  assert.equal(inWindow(win, { w: 0, s: -6 }), false);
});
