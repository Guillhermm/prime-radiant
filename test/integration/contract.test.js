import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateManifest, validateTile } from '../../core/schema.js';
import { locate, cellId, tileOf } from '../../core/grid.js';

const fx = (p) => new URL(`../../fixtures/${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(fx(p), 'utf8'));
const manifest = json('manifest.json');
const sum = (a) => a.reduce((s, v) => s + (v ?? 0), 0);
const tiles = [];
for (const [dir, res] of [['0.1', 0.1], ['1', 1]]) {
  for (const f of readdirSync(fx(`tiles/${dir}/`))) tiles.push({ dir, res, id: f.replace('.json', ''), t: json(`tiles/${dir}/${f}`) });
}

test('fixture manifest validates', () => assert.deepEqual(validateManifest(manifest), []));
test('there are three tiles: antimeridian, empty month, coarse', () => assert.equal(tiles.length, 3));
test('every fixture tile validates against the manifest', () => {
  for (const { dir, res, id, t } of tiles) assert.deepEqual(validateTile(t, { manifest, res }), [], `${dir}/${id}`);
});
test('manifest lists the 0.1 tiles', () => {
  assert.deepEqual(tiles.filter((x) => x.dir === '0.1').map((x) => x.id).sort(), [...manifest.tiles].sort());
});
test('invalid tiles fail with a named error', () => {
  const base = tiles.find((x) => x.id === 'x0y15' && x.dir === '0.1').t;
  const bad = (patch) => validateTile({ ...structuredClone(base), ...patch }, { manifest }).map((e) => e.code);
  assert.deepEqual(bad({ modis: [2, 1] }), ['COLUMN_LENGTH_MISMATCH']);
  assert.deepEqual(bad({ month: [0, 2, 6] }), ['MONTH_OUT_OF_RANGE']);
  assert.deepEqual(bad({ modis: [2, -1, 0] }), ['BAD_COUNT']);
});
test('empty month: index 3 has no rows and null only before VIIRS coverage', () => {
  for (const { t } of tiles) assert.ok(!t.month.includes(3));
  const { t } = tiles.find((x) => x.id === 'x17y13' && x.dir === '0.1');
  t.month.forEach((m, i) => assert.equal(t.viirs[i] === null, m < 2));
});

function readCsv(name) {
  const [head, ...lines] = readFileSync(fx(name), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return { cols, rows: lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v]))) };
}
const fireCellDays = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const p = locate(Number(r.longitude), Number(r.latitude));
    assert.equal(p.tile, 'x17y13');
    const month = Number(r.acq_date.slice(5, 7)) - 1;
    const k = `${p.cell}:${month}`;
    (m.get(k) ?? m.set(k, new Set()).get(k)).add(r.acq_date);
  }
  return m;
};

test('CSV fixtures have 50 rows, FIRMS headers and agree with tile x17y13', () => {
  const { t } = tiles.find((x) => x.id === 'x17y13' && x.dir === '0.1');
  for (const [sensor, thermal, total] of [['modis', 'bright_t31', 35], ['viirs', 'bright_ti5', 35]]) {
    const { cols, rows } = readCsv(`firms-${sensor}-50.csv`);
    assert.equal(rows.length, 50);
    for (const c of ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'confidence', 'frp', 'daynight', thermal]) {
      assert.ok(cols.includes(c), `${sensor} has ${c}`);
    }
    const days = fireCellDays(rows);
    assert.equal(sum([...days.values()].map((s) => s.size)), total);
    t.cell.forEach((c, i) => assert.equal(t[sensor][i] ?? 0, days.get(`${c}:${t.month[i]}`)?.size ?? 0));
    assert.equal(sum(t[sensor]), total);
  }
});
test('hand-written tile totals match fixtures/README.md', () => {
  const sums = Object.fromEntries(tiles.map(({ dir, id, t }) => [`${dir}/${id}`, [t.cell.length, sum(t.modis), sum(t.viirs)]]));
  assert.deepEqual(sums, { '0.1/x0y15': [3, 3, 4], '0.1/x17y13': [23, 35, 35], '1/x17y13': [18, 35, 35] });
});
test('grid known answers on fixtures: antimeridian, edge, pole', () => {
  assert.equal(tileOf(180, 65), 'x0y15');
  assert.equal(cellId(-180, 60), 0);
  assert.equal(cellId(180, 60), 0);
  assert.equal(cellId(-170.05, 69.95), 9999);
  assert.equal(locate(-10, 40).cell, 0); // edge point belongs to the east/north cell
  assert.equal(locate(0, 90).row, 99);
});
test('coarse tile is the per-month sum of the fine tile per 1 deg cell, nulls kept', () => {
  const fine = tiles.find((x) => x.id === 'x17y13' && x.dir === '0.1').t;
  const coarse = tiles.find((x) => x.id === 'x17y13' && x.dir === '1').t;
  const acc = new Map();
  fine.cell.forEach((c, i) => {
    const key = `${fine.month[i]}:${Math.floor(c / 1000) * 10 + Math.floor((c % 100) / 10)}`;
    const o = acc.get(key) ?? acc.set(key, { modis: null, viirs: null }).get(key);
    for (const s of ['modis', 'viirs']) if (fine[s][i] !== null) o[s] = (o[s] ?? 0) + fine[s][i];
  });
  assert.equal(coarse.cell.length, acc.size);
  coarse.cell.forEach((c, i) => {
    const o = acc.get(`${coarse.month[i]}:${c}`);
    assert.ok(o, `coarse row ${i} has a fine source`);
    assert.deepEqual([coarse.modis[i], coarse.viirs[i]], [o.modis, o.viirs]);
  });
});
