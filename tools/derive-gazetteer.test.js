import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxOf, entriesOf, labelPoint } from './derive-gazetteer.mjs';

const sq = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const feature = (properties, coordinates) => ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } });

test('bboxOf rounds outward and picks the narrow side of the antimeridian', () => {
  assert.deepEqual(bboxOf([sq(-10.004, 1.006, 2.001, 3.009)]), [-10.01, 1, 2.01, 3.01]);
  assert.deepEqual(bboxOf([sq(178, -10, 180, -5), sq(-180, -10, -179, -5)]), [178, -10, -179, -5]);
});

test('labelPoint falls inside the shape, even a ring around a hole', () => {
  const ring = [sq(0, 0, 10, 10)[0], sq(2, 2, 8, 8)[0]];
  const [x, y] = labelPoint([ring], [0, 0, 10, 10]);
  assert.ok(x < 2 || x > 8 || y < 2 || y > 8);
});

test('entriesOf: one entry per kind with alt names, the largest feature for a repeated name', () => {
  const entries = entriesOf({
    admin0: { features: [feature({ NAME: 'Landia', NAME_LONG: 'Republic of Landia', NAME_EN: 'Landia', NAME_PT: 'Lândia', LABEL_X: 5, LABEL_Y: 5 }, sq(0, 0, 10, 10))] },
    admin1: { features: [feature({ name: 'North', name_alt: 'Upper|North', name_en: 'North', name_pt: 'Norte', admin: 'Landia', longitude: 5, latitude: 8 }, sq(0, 5, 10, 10))] },
    regions: { features: [
      feature({ NAME: 'WETLAND', NAME_EN: 'Wetland', NAMEALT: null, NAME_PT: 'Pântano' }, sq(1, 1, 2, 2)),
      feature({ NAME: 'WETLAND', NAME_EN: 'Wetland', NAMEALT: null, NAME_PT: 'Pântano' }, sq(1, 1, 4, 4)),
    ] },
  });
  assert.deepEqual(entries.map((e) => [e.name, e.kind]), [['Landia', 'country'], ['North', 'state'], ['Wetland', 'region']]);
  assert.deepEqual(entries[0].alt, ['Republic of Landia', 'Lândia']);
  assert.deepEqual(entries[1].alt, ['Upper', 'Norte']);
  assert.equal(entries[1].country, 'Landia');
  assert.deepEqual(entries[2].bbox, [1, 1, 4, 4]);
  assert.deepEqual(entries[2].alt, ['Pântano']);
});
