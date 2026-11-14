import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, validateTile } from '../../core/schema.js';
import { locate, parseTileId } from '../../core/grid.js';
import { monthIndex } from '../../core/months.js';

const read = (p) => readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const monthCount = monthIndex(manifest.month0, manifest.last_month) + 1;
const coverage = Object.fromEntries(['modis', 'viirs'].map((s) => [s, manifest.coverage[s].map((m) => monthIndex(manifest.month0, m))]));

test('the fixture manifest validates', () => {
  assert.deepEqual(validateManifest(manifest), []);
});

test('every tile listed in the manifest exists and validates', () => {
  for (const id of manifest.tiles) {
    const { res } = parseTileId(id);
    const tile = JSON.parse(read(`tiles/${id}.json`));
    assert.deepEqual(validateTile(tile, { monthCount, coverage, cellsPerSide: Math.round(manifest.grid.tile_deg / res) }), [], id);
  }
});

test('a tile with null inside coverage fails with a named error', () => {
  const tile = JSON.parse(read('tiles/0.1/x12y7.json'));
  tile.viirs[0] = null;
  assert.deepEqual(validateTile(tile, { monthCount, coverage }).map((e) => e.code), ['tile.null-vs-coverage']);
});

test('a tile with a broken column fails with a named error', () => {
  const tile = JSON.parse(read('tiles/0.1/x12y7.json'));
  tile.modis.pop();
  assert.equal(validateTile(tile, { monthCount })[0].code, 'tile.length-mismatch');
});

const parseCsv = (text) => {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};

const binFireCellDays = (rows, res) => {
  const days = new Set();
  const counts = {};
  for (const r of rows) {
    const l = locate(Number(r.longitude), Number(r.latitude), res);
    const key = `${l.tileId}|${l.cell}|${r.acq_date}`;
    if (days.has(key)) continue;
    days.add(key);
    const k = `${l.tileId}|${l.cell}|${monthIndex(manifest.month0, r.acq_date.slice(0, 7))}`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
};

test('hand-computed totals: 50 rows per CSV bin to 46 MODIS and 45 VIIRS fire-cell-days', () => {
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const modisRows = parseCsv(read('firms-modis-50.csv'));
  const viirsRows = parseCsv(read('firms-viirs-50.csv'));
  assert.equal(modisRows.length, 50);
  assert.equal(viirsRows.length, 50);
  assert.equal(sum(binFireCellDays(modisRows, 0.1)), 46);
  assert.equal(sum(binFireCellDays(viirsRows, 0.1)), 45);
  const coarse = (rows) => Object.fromEntries(Object.entries(binFireCellDays(rows, 1)).filter(([k]) => k.startsWith('1/x12y7|')));
  assert.equal(sum(coarse(modisRows)), 19);
  assert.equal(sum(coarse(viirsRows)), 22);
});

test('the fixture tiles equal the binned CSVs, cell by cell', () => {
  for (const [sensor, file] of [['modis', 'firms-modis-50.csv'], ['viirs', 'firms-viirs-50.csv']]) {
    const rows = parseCsv(read(file));
    const binned = { ...binFireCellDays(rows, 0.1), ...binFireCellDays(rows, 1) };
    for (const k of Object.keys(binned)) if (k.startsWith('1/') && !k.startsWith('1/x12y7|')) delete binned[k];
    const fromTiles = {};
    for (const id of manifest.tiles) {
      const tile = JSON.parse(read(`tiles/${id}.json`));
      tile.cell.forEach((c, i) => { if (tile[sensor][i]) fromTiles[`${id}|${c}|${tile.month[i]}`] = tile[sensor][i]; });
    }
    assert.deepEqual(fromTiles, binned, sensor);
  }
});
