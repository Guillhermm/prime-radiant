// Downloads the public FIRMS yearly Brazil country files listed in docs/data.md into one folder.
//   node tools/fetch-country.mjs [--out raw/country] [--to 2025]
// A file already there and not empty is kept, so a local run only fetches what is missing.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const BASE = 'https://firms.modaps.eosdis.nasa.gov/data/country';
export const SOURCES = [
  { dir: 'modis', from: 2000 },
  { dir: 'viirs-snpp', from: 2012 },
  { dir: 'viirs-jpss1', from: 2018 },
];

/** Every {url, name} up to `to` inclusive (the last year FIRMS publishes as a country file). */
export const countryFiles = (to) => SOURCES.flatMap(({ dir, from }) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => {
  const name = `${dir}_${from + i}_Brazil.csv`;
  return { url: `${BASE}/${dir}/${from + i}/${name}`, name };
}));

const present = async (p) => (await stat(p).catch(() => null))?.size > 0;

export const fetchAll = async ({ out, to, fetchFn = fetch, log = console.log }) => {
  await mkdir(out, { recursive: true });
  for (const { url, name } of countryFiles(to)) {
    const dest = join(out, name);
    if (await present(dest)) continue;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`fetch-country: ${name} answered HTTP ${res.status}`);
    // Written to a .part file first, so an interrupted download is never mistaken for a complete one.
    await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`));
    await rename(`${dest}.part`, dest);
    log(`fetch-country: ${name}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'raw/country' }, to: { type: 'string', default: '2025' } } });
  const to = Number(values.to);
  if (!Number.isInteger(to) || to < 2018) {
    console.error('fetch-country: --to must be a year from 2018 on');
    process.exit(2);
  }
  fetchAll({ out: values.out, to }).catch((e) => { console.error(e.message); process.exit(1); });
}
