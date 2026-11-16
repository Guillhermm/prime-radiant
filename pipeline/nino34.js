/**
 * NOAA CPC monthly Nino 3.4 anomaly table (method.md section 7). The file is fetched once by hand and
 * converted here; this script never touches the network.
 *   node pipeline/nino34.js --in detrend.nino34.ascii.txt --url <source url> --retrieved YYYY-MM-DD [--out core/data/nino34.json]
 * Input columns: YR MON TOTAL ClimAdjust ANOM (CPC detrended Nino 3.4). Output:
 * {source, url, retrieved, header, values: {"YYYY-MM": anomaly}}.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Parse the CPC ascii text into {"YYYY-MM": ANOM}; the header line and malformed rows are skipped. */
export function parseNino34(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length !== 5 || !f.every((x) => Number.isFinite(Number(x)))) continue;
    const [yr, mon, , , anom] = f.map(Number);
    if (!Number.isInteger(yr) || !Number.isInteger(mon) || mon < 1 || mon > 12 || Math.abs(anom) > 9) continue;
    values[`${yr}-${String(mon).padStart(2, '0')}`] = anom;
  }
  return values;
}

export function buildTable(text, { url, retrieved }) {
  const values = parseNino34(text);
  if (!Object.keys(values).length) throw new Error('no Nino 3.4 rows found');
  return { source: 'NOAA CPC detrended Nino 3.4 index (ANOM, deg C)', url, retrieved, header: text.split(/\r?\n/)[0].trim(), values };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: a } = parseArgs({ options: { in: { type: 'string' }, url: { type: 'string' }, retrieved: { type: 'string' }, out: { type: 'string', default: 'core/data/nino34.json' } } });
  if (!a.in || !a.url || !a.retrieved) { console.error('usage: node pipeline/nino34.js --in <file> --url <url> --retrieved YYYY-MM-DD [--out core/data/nino34.json]'); process.exit(2); }
  fs.writeFileSync(a.out, `${JSON.stringify(buildTable(fs.readFileSync(a.in, 'utf8'), a), null, 1)}\n`);
}
