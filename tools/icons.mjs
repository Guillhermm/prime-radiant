// Rasterizes web/icons/mark.svg into the PWA PNGs with headless Chrome (no dependencies).
// Usage: node tools/icons.mjs            writes web/icons/*.png
//        node tools/icons.mjs --sheet f  also writes a contact sheet of all sizes to f
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../test/e2e/cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'web/icons');
const mark = readFileSync(join(iconsDir, 'mark.svg'), 'utf8');
const markUri = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`;
const BG = '#0c0d17'; // --color-bg in tokens.css

// fill: flame height as a share of the canvas. Maskable keeps the whole flame inside the 80% safe circle.
export const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, fill: 0.78 },
  { file: 'icon-192.png', size: 192, fill: 0.84 },
  { file: 'icon-512.png', size: 512, fill: 0.84 },
  { file: 'icon-maskable-512.png', size: 512, fill: 0.6, bg: BG },
];

export const iconHtml = ({ size, fill, bg }) =>
  `<body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg ?? 'transparent'}">` +
  `<img src="${markUri}" style="height:${Math.round(size * fill)}px">`;

const render = async (chrome, html, width, height = width) => {
  const page = await chrome.newPage({ width, height });
  await page.transparent();
  await page.goto(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await page.until('document.readyState === "complete" && [...document.images].every((i) => i.complete)', 'image load');
  const png = await page.screenshot();
  await page.close();
  return png;
};

const sheetHtml = () => {
  const tile = (bg, fg, size, scaled = false) =>
    `<div style="background:${bg};padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;color:${fg};font:12px sans-serif"><img src="${markUri}" style="height:${scaled ? 160 : size}px">${size}px${scaled ? " (shown at 160)" : ""}</div>`;
  const row = (bg, fg) => `<div style="background:${bg};display:flex;align-items:flex-end;gap:12px;padding:12px">${[16, 32, 180, 512].map((s) => tile(bg, fg, s, s === 512)).join('')}</div>`;
  const maskable = `data:image/png;base64,${readFileSync(join(iconsDir, 'icon-maskable-512.png')).toString('base64')}`;
  const crop = `<div style="background:#888;padding:16px;display:flex;gap:16px;color:#000;font:12px sans-serif"><div><img src="${maskable}" style="width:256px;border-radius:50%"><br>maskable, circle crop</div><div><img src="${maskable}" style="width:256px"><br>maskable, full</div></div>`;
  return `<body style="margin:0">${row('#151622', '#fff')}${row('#ffffff', '#000')}${crop}`;
};

const main = async () => {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome not found; set CHROME_PATH');
  const chrome = await launch(chromePath);
  try {
    for (const t of TARGETS) writeFileSync(join(iconsDir, t.file), await render(chrome, iconHtml(t), t.size));
    const i = process.argv.indexOf('--sheet');
    if (i > 0) writeFileSync(process.argv[i + 1], await render(chrome, sheetHtml(), 1000, 760));
  } finally {
    await chrome.close();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
