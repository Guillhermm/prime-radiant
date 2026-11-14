import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGETS } from './icons.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

test('committed PNGs match the declared sizes and carry alpha unless they have a background', () => {
  for (const t of TARGETS) {
    const b = readFileSync(join(web, 'icons', t.file));
    assert.equal(b.toString('latin1', 1, 4), 'PNG', t.file);
    assert.equal(b.readUInt32BE(16), t.size, `${t.file} width`);
    assert.equal(b.readUInt32BE(20), t.size, `${t.file} height`);
    if (!t.bg) assert.equal(b[25], 6, `${t.file} is RGBA`);
  }
});

test('manifest lists 192, 512 and a maskable 512, all from TARGETS', () => {
  const { icons } = JSON.parse(readFileSync(join(web, 'manifest.webmanifest'), 'utf8'));
  const has = (sizes, purpose) => icons.some((i) => i.sizes === sizes && i.purpose === purpose && i.type === 'image/png');
  assert.ok(has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable'));
  for (const i of icons) assert.ok(TARGETS.some((t) => i.src === `icons/${t.file}`) || i.src === 'icons/mark.svg', i.src);
});

test('mark.svg is transparent and index.html wires the icons and per-scheme theme-color', () => {
  const svg = readFileSync(join(web, 'icons/mark.svg'), 'utf8');
  assert.ok(!/<rect[^>]*width="512"/.test(svg), 'no background rect');
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  assert.match(html, /rel="icon" href="icons\/mark\.svg"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /name="theme-color" content="#0c0d17" media="\(prefers-color-scheme: dark\)"/);
  assert.match(html, /name="theme-color" content="#f4f6fb" media="\(prefers-color-scheme: light\)"/);
});
