import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { text } from 'node:stream/consumers';
import { zipEntries, zipEntryStream } from './zip.js';
import { readFirms, newStats } from './read.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-zip-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Writes a plain zip: entries [{name, data, deflate}]; a name ending in / is a folder.
const writeZip = (file, entries) => {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data = '', deflate = false } of entries) {
    const raw = Buffer.from(data);
    const body = deflate ? zlib.deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    locals.push(local, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
};

const HEAD = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type';
const row = (lat, lon, day) => `${lat},${lon},310.1,1.0,1.0,${day},1340,Aqua,MODIS,80,6.1NRT,290.0,10.0,D,0`;

test('zipEntries lists files (folders left out); zipEntryStream reads stored and deflated entries', async () => {
  const f = path.join(dir, 'a.zip');
  writeZip(f, [{ name: 'modis/2023/' }, { name: 'modis/2023/a.csv', data: 'stored text' }, { name: 'modis/2023/b.csv', data: 'deflated '.repeat(50), deflate: true }]);
  const entries = zipEntries(f);
  assert.deepEqual(entries.map((e) => e.name), ['modis/2023/a.csv', 'modis/2023/b.csv']);
  assert.equal(await text(zipEntryStream(f, entries[0])), 'stored text');
  assert.equal(await text(zipEntryStream(f, entries[1])), 'deflated '.repeat(50));
});

test('readFirms reads every CSV of a zip, each with its own header, and skips other entries', async () => {
  const f = path.join(dir, 'modis_2023_all_countries.zip');
  writeZip(f, [
    { name: 'modis/2023/modis_2023_Chile.csv', data: [HEAD, row(-33.1, -70.5, '2023-02-03')].join('\n'), deflate: true },
    { name: 'modis/2023/readme.txt', data: 'not data' },
    { name: 'modis/2023/modis_2023_Peru.csv', data: [HEAD, row(-12.0, -77.0, '2023-08-01'), row(-12.1, -77.1, '2023-08-02')].join('\n') },
  ]);
  const stats = newStats();
  const recs = [];
  for await (const r of readFirms(f, stats)) recs.push(r);
  assert.deepEqual(recs.map((r) => r.utcDay), ['2023-02-03', '2023-08-01', '2023-08-02']);
  assert.equal(stats.accepted, 3);
});

test('a file that is not a zip, or a zip64 one, fails loudly', () => {
  const bad = path.join(dir, 'bad.zip');
  fs.writeFileSync(bad, 'not a zip at all, just text that is long enough');
  assert.throws(() => zipEntries(bad), /no end of central directory/);
  const z64 = path.join(dir, 'z64.zip');
  writeZip(z64, [{ name: 'x.csv', data: 'x' }]);
  const b = fs.readFileSync(z64);
  b.writeUInt32LE(0xffffffff, b.length - 6);
  fs.writeFileSync(z64, b);
  assert.throws(() => zipEntries(z64), /zip64/);
});
