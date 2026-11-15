import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPlaces, GAZETTEER, inDomain } from './gazetteer.js';
import { validatePlaces } from '../core/schema.js';

// One in-domain 0.1 deg cell: row 700 (lat -20.0..-19.9), column 1220 (lon -58.0..-57.9).
const domain = { rows: { 700: [[1220, 1220]] } };
const entry = (name, label) => ({ name, alt: [], kind: 'region', country: null, bbox: [-60, -21, -55, -15], label });
const gaz = { source: { id: 'ne10m', version: '5.1.2' }, entries: [entry('Inside', [-57.95, -19.95]), entry('Outside', [-50, -10])] };

test('inDomain reads the domain mask at 0.1 deg', () => {
  assert.equal(inDomain(domain, [-57.95, -19.95]), true);
  assert.equal(inDomain(domain, [-57.85, -19.95]), false);
  assert.equal(inDomain(domain, [-57.95, -19.85]), false);
});

test('buildPlaces keeps entries whose label point is in the domain, drops the label, and validates', () => {
  const p = buildPlaces(gaz, domain);
  assert.deepEqual(p.entries.map((e) => e.name), ['Inside']);
  assert.equal('label' in p.entries[0], false);
  assert.deepEqual(validatePlaces(p), []);
  assert.equal(buildPlaces(gaz).entries.length, 2);
});

test('validatePlaces names a bad entry', () => {
  const p = buildPlaces(gaz);
  const codes = (x) => validatePlaces(x).map((e) => e.code);
  assert.deepEqual(codes({ ...p, entries: [{ ...p.entries[0], kind: 'city' }] }), ['BAD_PLACE']);
  assert.deepEqual(codes({ ...p, entries: [{ ...p.entries[0], bbox: [-60, -15, -55, -21] }] }), ['BAD_PLACE']);
  assert.deepEqual(codes({ ...p, entries: [{ ...p.entries[0], name: '' }] }), ['BAD_PLACE']);
  assert.deepEqual(codes(null), ['NOT_OBJECT']);
});

test('the committed gazetteer validates and holds the places the brief names', () => {
  const g = JSON.parse(fs.readFileSync(GAZETTEER, 'utf8'));
  assert.deepEqual(validatePlaces({ schema: 1, ...g }), []);
  const find = (name, kind) => g.entries.find((e) => e.name === name && e.kind === kind);
  assert.ok(find('Pantanal', 'region') && find('Caatinga', 'region') && find('Amazon basin', 'region'));
  assert.equal(find('Mato Grosso', 'state').country, 'Brazil');
  assert.ok(find('Sahel', 'region'), 'global, not Brazil only');
  const fiji = find('Fiji', 'country');
  assert.ok(fiji.bbox[0] > fiji.bbox[2], 'Fiji crosses the antimeridian, so west > east');
});
