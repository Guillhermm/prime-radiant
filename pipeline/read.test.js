import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFirms, newStats, normalize } from './read.js';

const MODIS_H = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type';
const VIIRS_H = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-test-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function modisRow(lat, lon, date, time, sat = 'Terra', type = '0') {
  return `${lat},${lon},330.5,1.1,1.0,${date},${time},${sat},MODIS,80,6.1,295.2,12.4,D,${type}`;
}
async function collect(file) {
  const stats = newStats();
  const out = [];
  for await (const r of readFirms(file, stats)) out.push(r);
  return { out, stats };
}
function write(name, text) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
}

test('csv: normalizes MODIS and VIIRS rows, header-driven', async () => {
  const m = write('m.csv', [MODIS_H, modisRow(40.05, -9.95, '2023-01-01', '1015', 'Aqua')].join('\n') + '\n');
  const v = write('v.csv', [VIIRS_H, '40.05,-9.95,335.1,0.4,0.4,2023-03-01,0212,N,VIIRS,n,2.0,290.0,3.1,N,0'].join('\n'));
  assert.deepEqual((await collect(m)).out, [{ sensor: 'modis', satellite: 'Aqua', lat: 40.05, lon: -9.95, utcDay: '2023-01-01', hasType: true, daynight: 'D' }]);
  assert.deepEqual((await collect(v)).out, [{ sensor: 'viirs', satellite: 'SNPP', lat: 40.05, lon: -9.95, utcDay: '2023-03-01', hasType: true, daynight: 'N' }]);
});

test('csv: non-vegetation types excluded and counted, type=0 kept', async () => {
  const f = write('t.csv', [MODIS_H, modisRow(1, 1, '2023-01-01', '0100', 'Terra', '0'),
    modisRow(1, 1, '2023-01-01', '0100', 'Terra', '1'), modisRow(1, 1, '2023-01-01', '0100', 'Terra', '2'),
    modisRow(1, 1, '2023-01-01', '0100', 'Terra', '3'), modisRow(1, 1, '2023-01-01', '0100', 'Terra', 'x')].join('\n'));
  const { out, stats } = await collect(f);
  assert.equal(out.length, 1);
  assert.equal(out[0].hasType, true);
  assert.deepEqual(stats, { read: 5, accepted: 1, rejected: { type_excluded: 3, type_invalid: 1 } });
});

test('csv: 23:59 and 00:01 UTC fall on different days; Feb 29 parsed; Feb 29 of a common year rejected', async () => {
  const f = write('d.csv', [MODIS_H, modisRow(1, 1, '2023-05-01', '2359'), modisRow(1, 1, '2023-05-02', '0001'),
    modisRow(1, 1, '2024-02-29', '1200'), modisRow(1, 1, '2023-02-29', '1200')].join('\n'));
  const { out, stats } = await collect(f);
  assert.deepEqual(out.map((r) => r.utcDay), ['2023-05-01', '2023-05-02', '2024-02-29']);
  assert.deepEqual(stats.rejected, { date: 1 });
});

test('csv: malformed rows are rejected by reason, never dropped silently', async () => {
  const f = write('bad.csv', [MODIS_H,
    modisRow(91, 1, '2023-01-01', '0100'), modisRow(1, 181, '2023-01-01', '0100'), modisRow('abc', 1, '2023-01-01', '0100'),
    modisRow(1, 1, '2023-13-01', '0100'), modisRow(1, 1, '2023-01-01', '2400'), modisRow(1, 1, '2023-01-01', '99'),
    modisRow(1, 1, '2023-01-01', '0100', 'Landsat'), 'only,three,cols', '', modisRow(-90, -180, '2023-01-01', '0100')].join('\r\n'));
  const { out, stats } = await collect(f);
  assert.equal(out.length, 1);
  assert.equal(stats.read, 9);
  assert.deepEqual(stats.rejected, { lat: 2, lon: 1, date: 1, time: 2, satellite: 1, columns: 1 });
  assert.equal(stats.accepted + Object.values(stats.rejected).reduce((a, b) => a + b, 0), stats.read);
});

test('csv.gz and a CSV without a type column (hasType false)', async () => {
  const text = 'latitude,longitude,acq_date,acq_time,satellite\n1,2,2023-01-01,0100,Terra\n';
  const p = path.join(dir, 'g.csv.gz');
  fs.writeFileSync(p, zlib.gzipSync(text));
  const { out } = await collect(p);
  assert.equal(out.length, 1);
  assert.equal(out[0].hasType, false);
});

test('csv: a UTF-8 byte order mark before the header is ignored', async () => {
  const { out } = await collect(write('bom.csv', '\uFEFF' + [MODIS_H, modisRow(1, 1, '2023-01-01', '0100')].join('\n')));
  assert.equal(out.length, 1);
});

test('csv: missing required column throws; unknown extension throws', async () => {
  await assert.rejects(collect(write('h.csv', 'latitude,longitude\n1,2\n')), /acq_date/);
  assert.throws(() => readFirms('x.txt'), /Unsupported/);
});

test('normalize: satellite codes map to families', () => {
  const base = { lat: '0', lon: '0', date: '2023-01-01', time: '0000', type: undefined };
  const got = (s) => normalize({ ...base, satellite: s }, newStats());
  assert.deepEqual(['Terra', 'Aqua', 'T', 'A', 'N', 'SNPP', 'N20', 'N21'].map((s) => got(s).satellite),
    ['Terra', 'Aqua', 'Terra', 'Aqua', 'SNPP', 'SNPP', 'NOAA20', 'NOAA21']);
  assert.equal(got('N20').sensor, 'viirs');
  assert.equal(got('L8'), null);
});

test('normalize: exponent-form coordinates near 0 (seen in real DBF) parse; junk is rejected', () => {
  const base = { date: '2023-01-01', time: '0000', satellite: 'Terra', type: '0' };
  assert.equal(normalize({ ...base, lat: '-7e-05', lon: '1E-04' }, newStats()).lat, -0.00007);
  const st = newStats();
  for (const lat of ['', '*****', '1e', '--1', '0x10']) normalize({ ...base, lat, lon: '0' }, st);
  assert.deepEqual(st.rejected, { lat: 5 });
});

// Minimal dBase III writer: fields [{name, type, len}], rows of strings, optional deleted flags.
function buildDbf(fields, rows, deleted = []) {
  const recLen = 1 + fields.reduce((a, f) => a + f.len, 0);
  const headerLen = 32 + 32 * fields.length + 1;
  const b = Buffer.alloc(headerLen + recLen * rows.length + 1, 0x20);
  b[0] = 3;
  b.writeUInt32LE(rows.length, 4);
  b.writeUInt16LE(headerLen, 8);
  b.writeUInt16LE(recLen, 10);
  fields.forEach((f, i) => {
    const p = 32 + 32 * i;
    b.fill(0, p, p + 32);
    b.write(f.name, p, 'latin1');
    b.write(f.type, p + 11, 'latin1');
    b[p + 16] = f.len;
  });
  b[32 + 32 * fields.length] = 0x0d;
  rows.forEach((r, i) => {
    let p = headerLen + recLen * i;
    b[p] = deleted.includes(i) ? 0x2a : 0x20;
    p++;
    fields.forEach((f, j) => { b.write(String(r[j]).padEnd(f.len), p, 'latin1'); p += f.len; });
  });
  b[b.length - 1] = 0x1a;
  return b;
}
const ARCHIVE = [
  { name: 'LATITUDE', type: 'N', len: 32 }, { name: 'LONGITUDE', type: 'N', len: 32 },
  { name: 'ACQ_DATE', type: 'D', len: 8 }, { name: 'ACQ_TIME', type: 'C', len: 4 },
  { name: 'SATELLITE', type: 'C', len: 5 }, { name: 'CONFIDENCE', type: 'N', len: 6 },
  { name: 'TYPE', type: 'N', len: 11 },
];
const NRT = ARCHIVE.filter((f) => f.name !== 'TYPE');

test('dbf: archive records, types, deleted flag, rejection counts', async () => {
  const rows = [
    ['-18.99333', '-174.76727', '20260101', '0025', 'N20', '90', '0'],
    ['10.5', '20.5', '20240229', '2359', 'Aqua', '75', '0'],
    ['10.5', '20.5', '20260102', '0001', 'SNPP', '75', '2'],
    ['10.5', '20.5', '20260102', '0001', 'N21', '75', '0'],
    ['10.5', '20.5', '20260102', '0001', 'Terra', '75', '0'],
    ['10.5', '20.5', '20260102', '0001', 'L8', '75', '0'],
    ['10.5', '20.5', '20260132', '0001', 'Terra', '75', '0'],
  ];
  const p = path.join(dir, 'a.dbf');
  fs.writeFileSync(p, buildDbf(ARCHIVE, rows, [4]));
  const { out, stats } = await collect(p);
  assert.deepEqual(out.map((r) => [r.sensor, r.satellite, r.utcDay]), [
    ['viirs', 'NOAA20', '2026-01-01'], ['modis', 'Aqua', '2024-02-29'], ['viirs', 'NOAA21', '2026-01-02']]);
  assert.equal(out[0].lat, -18.99333);
  assert.equal(out[0].hasType, true);
  assert.deepEqual(stats, { read: 7, accepted: 3, rejected: { type_excluded: 1, deleted: 1, satellite: 1, date: 1 } });
});

test('dbf: NRT file without TYPE gives hasType false', async () => {
  const p = path.join(dir, 'n.dbf');
  fs.writeFileSync(p, buildDbf(NRT, [['1', '2', '20260801', '0001', 'SNPP', 'n']]));
  const { out } = await collect(p);
  assert.deepEqual(out, [{ sensor: 'viirs', satellite: 'SNPP', lat: 1, lon: 2, utcDay: '2026-08-01', hasType: false }]);
});

test('dbf: records straddling stream chunks, and a truncated file is counted', async () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ['1', '2', '20230101', '0100', i % 2 ? 'Aqua' : 'Terra', '80', '0']);
  const full = buildDbf(ARCHIVE, rows);
  const p = path.join(dir, 'big.dbf');
  fs.writeFileSync(p, full);
  assert.equal((await collect(p)).out.length, 20000); // > 1 MiB, several chunks
  const recLen = 1 + ARCHIVE.reduce((a, f) => a + f.len, 0);
  fs.writeFileSync(p, full.subarray(0, full.length - 1 - recLen * 5 - 10)); // lose 5 records and part of one
  const { out, stats } = await collect(p);
  assert.equal(out.length, 19994);
  assert.equal(stats.rejected.truncated, 6);
});

test('csv: daynight is carried when the file has the column and absent otherwise', async () => {
  const withCol = write('dn.csv', ['latitude,longitude,acq_date,acq_time,satellite,daynight', '1,2,2026-11-01,0100,N20,N'].join('\n') + '\n');
  const without = write('nodn.csv', ['latitude,longitude,acq_date,acq_time,satellite', '1,2,2026-11-01,0100,N20'].join('\n') + '\n');
  assert.equal((await collect(withCol)).out[0].daynight, 'N');
  assert.equal('daynight' in (await collect(without)).out[0], false);
});
