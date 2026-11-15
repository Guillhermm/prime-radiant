import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlaces } from '../../core/schema.js';
import { fold, indexPlaces, matchKind, matchPlaces, placeSub } from './place-search.js';

const entry = (name, kind, country, bbox, alt = []) => ({ name, alt, kind, country, bbox });
const PLACES = {
  schema: 1,
  source: { id: 'test', version: '1' },
  entries: [
    entry('Amazon basin', 'region', null, [-78.77, -20.13, -46.17, 4.82], ['Bacia do rio Amazonas']),
    entry('Amazonas', 'state', 'Brazil', [-73.82, -9.84, -56.31, 2.24]),
    entry('Brazil', 'country', 'Brazil', [-74, -34, -34, 5.3], ['Brasil']),
    entry('Mato Grosso', 'state', 'Brazil', [-61.6, -18.1, -50.2, -7.3]),
    entry('Mato Grosso do Sul', 'state', 'Brazil', [-58.2, -24.1, -50.9, -17.2]),
    entry('Pantanal', 'region', null, [-60.63, -21.4, -54.87, -15.58]),
    entry('Pará', 'state', 'Brazil', [-58.9, -9.9, -46.1, 2.6]),
    entry('Paraguay', 'country', 'Paraguay', [-62.7, -27.6, -54.3, -19.3]),
    entry('Paraná', 'state', 'Brazil', [-54.62, -26.71, -48.03, -22.52]),
    entry('Paraná', 'region', null, [-60, -34, -44, -15], ['Paraná Basin']),
    entry('São Paulo', 'state', 'Brazil', [-53.1, -25.3, -44.2, -19.8]),
    entry('Wraps the antimeridian', 'region', null, [179, -10, -179, -5]),
  ],
};
const index = indexPlaces(PLACES);
const names = (q, opts) => matchPlaces(index, q, opts).map((e) => `${e.name}/${e.kind}`);

test('the fixture is a valid places file', () => {
  assert.deepEqual(validatePlaces(PLACES), []);
});

test('fold drops case and accents', () => {
  assert.equal(fold('São PAULO'), 'sao paulo');
  assert.equal(fold('Pará'), 'para');
});

test('matchKind tells exact, prefix and word start apart, and ignores mid-word hits', () => {
  assert.equal(matchKind('para', 'para'), 'exact');
  assert.equal(matchKind('parana', 'para'), 'prefix');
  assert.equal(matchKind('mato grosso do sul', 'grosso'), 'word');
  assert.equal(matchKind('bacia do rio amazonas', 'amaz'), 'word');
  assert.equal(matchKind('amazonas', 'zonas'), null);
  assert.equal(matchKind('anything', ''), null);
});

test('matching is case- and accent-insensitive, on the name and the alternates', () => {
  assert.deepEqual(names('PANT'), ['Pantanal/region']);
  assert.deepEqual(names('sao p'), ['São Paulo/state']);
  assert.deepEqual(names('brasil'), ['Brazil/country']);
  assert.deepEqual(names('  pará '), ['Pará/state', 'Paraná/region', 'Paraná/state', 'Paraguay/country']);
});

test('ranking: exact, then prefix, then word start; ties by kind (region, state, country), then name', () => {
  assert.deepEqual(names('para'), ['Pará/state', 'Paraná/region', 'Paraná/state', 'Paraguay/country']);
  assert.deepEqual(names('amazon'), ['Amazon basin/region', 'Amazonas/state']);
  assert.deepEqual(names('grosso'), ['Mato Grosso/state', 'Mato Grosso do Sul/state']);
  assert.deepEqual(names('mato grosso'), ['Mato Grosso/state', 'Mato Grosso do Sul/state']);
  // "Basin" starts a word of an alternate name of Paraná and of the name of Amazon basin.
  assert.deepEqual(names('basin'), ['Amazon basin/region', 'Paraná/region']);
});

test('at most eight results, none for a blank query or no match', () => {
  const many = indexPlaces({ entries: Array.from({ length: 20 }, (_, i) => entry(`Area ${i}`, 'region', null, [0, 0, 1, 1])) });
  assert.equal(matchPlaces(many, 'area').length, 8);
  assert.equal(matchPlaces(many, 'area', { limit: 3 }).length, 3);
  assert.deepEqual(names(''), []);
  assert.deepEqual(names('   '), []);
  assert.deepEqual(names('zzz'), []);
});

test('entries the area form could not apply are not suggested', () => {
  assert.deepEqual(names('wraps'), []);
  assert.deepEqual(indexPlaces(null), []);
});

test('placeSub names the kind and the country', () => {
  assert.equal(placeSub(PLACES.entries[1]), 'State or province · Brazil');
  assert.equal(placeSub(PLACES.entries[5]), 'Region');
  assert.equal(placeSub(PLACES.entries[2]), 'Country');
});
