/**
 * Minimal zip reader, standard library only: lists the entries of a zip file and streams one
 * entry, stored or deflated, without extracting it to disk. Enough for the FIRMS yearly
 * `{sensor}_{year}_all_countries.zip` archives (one CSV per country, each well under 4 GB).
 * Zip64 archives, encryption and multi-disk archives are refused with an error.
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

const readAt = (fd, pos, len) => {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
};

/** @returns {{name: string, method: number, compressedSize: number, size: number, offset: number}[]} file entries, folders left out */
export const zipEntries = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const tailLen = Math.min(size, 22 + MAX_COMMENT);
    const tail = readAt(fd, size - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { at = i; break; }
    if (at < 0) throw new Error(`zip: no end of central directory in ${file}`);
    const disk = tail.readUInt16LE(at + 4);
    const count = tail.readUInt16LE(at + 10);
    const dirSize = tail.readUInt32LE(at + 12);
    const dirOffset = tail.readUInt32LE(at + 16);
    if (disk !== 0) throw new Error(`zip: multi-disk archives are not supported (${file})`);
    if (count === 0xffff || dirOffset === 0xffffffff) throw new Error(`zip: zip64 archives are not supported (${file})`);
    const dir = readAt(fd, dirOffset, dirSize);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (dir.readUInt32LE(p) !== CENTRAL) throw new Error(`zip: bad central directory entry ${i} in ${file}`);
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const compressedSize = dir.readUInt32LE(p + 20);
      const entrySize = dir.readUInt32LE(p + 24);
      const nameLen = dir.readUInt16LE(p + 28);
      const extraLen = dir.readUInt16LE(p + 30);
      const commentLen = dir.readUInt16LE(p + 32);
      const offset = dir.readUInt32LE(p + 42);
      const name = dir.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if (flags & 1) throw new Error(`zip: encrypted entry ${name} in ${file}`);
      if (compressedSize === 0xffffffff || entrySize === 0xffffffff || offset === 0xffffffff) throw new Error(`zip: zip64 entry ${name} in ${file}`);
      if (method !== 0 && method !== 8) throw new Error(`zip: entry ${name} uses compression method ${method}; only stored and deflate are supported`);
      out.push({ name, method, compressedSize, size: entrySize, offset });
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
};

/** Readable stream of one entry's uncompressed bytes. */
export const zipEntryStream = (file, entry) => {
  const fd = fs.openSync(file, 'r');
  let head;
  try {
    head = readAt(fd, entry.offset, 30);
  } finally {
    fs.closeSync(fd);
  }
  if (head.length < 30 || head.readUInt32LE(0) !== LOCAL) throw new Error(`zip: bad local header for ${entry.name} in ${file}`);
  const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (entry.compressedSize === 0) return Readable.from([]);
  const raw = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1, highWaterMark: 1 << 20 });
  return entry.method === 0 ? raw : raw.pipe(zlib.createInflateRaw());
};
