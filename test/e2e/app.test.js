import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, wait } from './cdp.mjs';
import { createStaticServer, loadSite } from '../../tools/serve.mjs';
import { toCsv } from '../../core/index.js';
import { createDataSource } from '../../web/src/data-source.js';
import { buildResult, csvMeta } from '../../web/src/view-data.js';
import { guardCsv } from '../../web/src/components/export-menu.js';
import { parseHash } from '../../web/src/state.js';
import { spanFromManifest } from '../../web/src/components/date-range.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (set CHROME_PATH to run the end-to-end tests)';
if (!chrome && process.env.REQUIRE_CHROME) throw new Error('REQUIRE_CHROME is set but no Chrome was found');

let server;
let browser;
let base;
let downloadDir;

before(async () => {
  if (skip) return;
  server = createStaticServer(await loadSite(root, { extra: ['fixtures'] }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch(chrome);
  downloadDir = await mkdtemp(join(tmpdir(), 'pr-dl-'));
});

after(async () => {
  await browser?.close();
  server?.close();
  if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
});

const open = async (width, query = '?fixtures=1') => {
  const page = await browser.newPage({ width, height: width < 600 ? 860 : 900, downloadDir });
  await page.goto(`${base}/web/${query}`);
  return page;
};

const applyFrom2005 = async (page) => {
  await page.evaluate(`(() => { const i = document.querySelector('#date-from'); i.value = '2005-01'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.click('.query-form .btn-primary');
  await page.until(`location.hash.includes('from=2005-01')`, 'apply commits from=2005-01');
  await page.until(`document.querySelector('.cal-row:not(.cal-head):last-child .cal-year')?.textContent === '2005' && !document.querySelector('.view-calendar').hidden`, 'calendar ends at 2005');
};

test('the site root redirects to the app and the default load shows the empty state', { skip }, async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/web/');
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('.state-box-empty .chip')`, 'empty state with preset chips');
    assert.equal(await page.evaluate(`document.querySelector('.caveat .badge')?.textContent`), 'Preliminary');
    assert.equal(await page.evaluate(`document.querySelector('.method-button') !== null`), true);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('preset, apply, calendar, cell detail, Method drawer and CSV export', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('.state-box-empty .chip')`, 'preset chips');
    await page.click('.state-box-empty .chip');
    await page.until(`document.querySelector('.cal-grid') && !document.querySelector('.view-calendar').hidden`, 'calendar after preset');
    await applyFrom2005(page);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.cal-row:not(.cal-head) .cal-year')].every((y) => Number(y.textContent) >= 2005)`), true);

    await page.evaluate(`document.querySelector('.cal-cell[tabindex="0"]').focus()`);
    const label = await page.evaluate(`document.activeElement.getAttribute('aria-label')`);
    await page.press('Enter');
    await page.until(`document.querySelector('.detail-panel')`, 'cell detail opens on Enter');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('detail-title')`), true);
    assert.equal(await page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'none', 'no ring on the programmatically focused heading');
    await page.press('Escape');
    await page.until(`!document.querySelector('.detail-panel')`, 'Esc closes the detail');
    assert.equal(await page.evaluate(`document.activeElement.getAttribute('aria-label')`), label);
    await page.press('ArrowRight');
    assert.notEqual(await page.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'none', 'roving cell keeps its focus ring');

    await page.click('.method-button');
    await page.until(`document.querySelector('.drawer-panel[aria-modal="true"]')`, 'Method drawer opens');
    assert.equal(await page.evaluate(`document.querySelector('.method-button').getAttribute('aria-expanded')`), 'true');
    for (let i = 0; i < 6; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.drawer-panel').contains(document.activeElement)`), true, 'focus stays in the drawer');
    await page.press('Escape');
    await page.until(`!document.querySelector('.drawer-panel')`, 'Esc closes the drawer');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('method-button')`), true);

    await page.click('.export-button');
    await page.click('.export-item[data-action="csv"]');
    await page.until(`document.querySelector('.export-status').textContent === 'CSV downloaded'`, 'CSV export status');
    for (let i = 0; i < 50 && !(await readdir(downloadDir)).some((f) => f.endsWith('.csv')); i++) await wait(100);
    const files = (await readdir(downloadDir)).filter((f) => f.endsWith('.csv'));
    assert.equal(files.length, 1, 'one CSV downloaded');
    const actual = await readFile(join(downloadDir, files[0]), 'utf8');

    // The same query computed in Node from the fixture files, through core.
    const manifest = JSON.parse(await readFile(join(root, 'fixtures/manifest.json'), 'utf8'));
    const { state } = parseHash(await page.evaluate('location.hash'), { span: spanFromManifest(manifest) });
    const source = createDataSource({
      manifestUrl: 'fixtures/manifest.json',
      fetchFn: async (url) => ({ ok: true, json: async () => JSON.parse(await readFile(join(root, url), 'utf8')) }),
    });
    const { manifest: m, tiles } = await source.load(state.bbox);
    const result = buildResult({ bbox: state.bbox, from: state.from, to: state.to, manifest: m, tiles });
    assert.equal(actual, guardCsv(toCsv(result.series, csvMeta(result))));
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('phone width (400px): sheet traps focus, apply works, no horizontal scroll', { skip }, async () => {
  const page = await open(400);
  try {
    await page.until(`document.querySelector('.state-box-empty .chip')`, 'preset chips');
    await page.click('.state-box-empty .chip');
    await page.until(`document.querySelector('.cal-grid') && !document.querySelector('.view-calendar').hidden`, 'calendar after preset');
    await page.click('.area-chip');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').getAttribute('aria-modal')`), 'true');
    for (let i = 0; i < 25; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').contains(document.activeElement)`), true, 'focus trapped in the sheet');
    await applyFrom2005(page);
    assert.equal(await page.evaluate(`!document.querySelector('.query-bar').classList.contains('sheet-open') && document.activeElement.classList.contains('area-chip')`), true, 'sheet closed, focus back on the chip');
    assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'no horizontal page scroll');
    assert.equal(await page.evaluate(`(() => { const s = document.querySelector('.cal-scroll'); return s.scrollWidth <= s.clientWidth; })()`), true, 'all 12 months fit without scrolling');

    // The bottom sheet must not cover the tapped cell (WCAG 2.4.11).
    await page.evaluate(`(() => { const c = [...document.querySelectorAll('.cal-cell:not(.is-empty)')].pop(); c.scrollIntoView({ block: 'end' }); c.focus(); })()`);
    await page.press('Enter');
    await page.until(`document.querySelector('.detail-panel')`, 'detail sheet opens on phone');
    await wait(150);
    assert.equal(await page.evaluate(`(() => { const c = [...document.querySelectorAll('.cal-cell:not(.is-empty)')].pop().getBoundingClientRect(); return c.bottom <= document.querySelector('.detail').getBoundingClientRect().top; })()`), true, 'cell is above the sheet');
    assert.ok(await page.evaluate(`parseFloat(document.documentElement.style.getPropertyValue('--sheet-height')) > 100`), 'page padded by the sheet height');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('?preview=1: anomaly layer with rank in the detail, then the Live view and its table', { skip }, async () => {
  const page = await open(1280, '?fixtures=1&preview=1');
  try {
    await page.until(`document.querySelector('.state-box-empty .chip')`, 'preset chips');
    await page.click('.state-box-empty .chip');
    await page.until(`document.querySelector('.view-calendar .cal-grid') && !document.querySelector('.view-calendar').hidden`, 'calendar after preset');
    await page.click('input[name="layer"][value="anomaly"]');
    await page.until(`location.hash.includes('layer=anomaly') && document.querySelector('.view-calendar .anomaly-layer')?.offsetParent !== null`, 'anomaly layer shown');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar .legend-ramp')?.children.length`), 11);
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar .anomaly-preview-note').textContent`), 'Preview: placeholder anomaly and live numbers, not validated.');

    await page.evaluate(`document.querySelector('.view-calendar .anomaly-layer .cal-cell[tabindex="0"]').focus()`);
    await page.press('Enter');
    await page.until(`document.querySelector('.detail-panel')`, 'cell detail opens from the anomaly layer');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.detail-list dt')].some((d) => d.textContent === 'Percentile rank')`), true);
    await page.press('Escape');
    await page.until(`!document.querySelector('.detail-panel')`, 'Esc closes the detail');

    await page.click('#tab-anomalies');
    await page.until(`document.querySelector('.view-anomalies .anomaly-layer')?.offsetParent !== null && document.querySelector('.view-calendar').hidden`, 'Anomalies view owned by the shell');
    await page.click('#tab-live');
    await page.until(`!document.querySelector('.view-live').hidden && document.querySelector('.view-live .live-chart')`, 'Live view with its chart');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar').hidden && document.querySelector('.view-anomalies').hidden`), true);
    await page.click('.view-live .cal-toggle');
    await page.until(`document.querySelector('.view-live .live-table')?.offsetParent !== null`, 'Live table shown');
    assert.equal(await page.evaluate(`document.querySelectorAll('.view-live .live-table tbody tr').length`), 12);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('tab switch updates the hash, back restores the previous view, disabled views are absent', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('.state-box-empty .chip')`, 'preset chips');
    await page.click('.state-box-empty .chip');
    await page.until(`location.hash.includes('view=calendar')`, 'calendar view in hash');
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.view)`);
    assert.deepEqual(tabs, ['calendar', 'sensors'], 'only enabled views get a tab');
    await page.click('[role=tab][data-view="sensors"]');
    await page.until(`location.hash.includes('view=sensors')`, 'sensors in hash');
    await page.evaluate('history.back()');
    await page.until(`location.hash.includes('view=calendar') && document.querySelector('[role=tab][data-view="calendar"]').getAttribute('aria-selected') === 'true'`, 'back returns to calendar');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('map open, then Method drawer: the drawer paints over the Leaflet panes', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('.map-toggle')`, 'map toggle');
    await page.click('.map-toggle');
    await page.until(`document.querySelector('.map-canvas .leaflet-pane')`, 'Leaflet map mounted');
    await page.click('.method-button');
    await page.until(`document.querySelector('.drawer-panel[aria-modal="true"]')`, 'drawer open');
    // Tiles are pointer-events: none (and hidden here, offline), so hit-testing skips them; undo that so
    // elementFromPoint follows paint order and a tile painted over the drawer is caught (CSSOM, so the CSP allows it).
    await page.until(`document.querySelector('.map-canvas .leaflet-tile')`, 'tiles present');
    await page.evaluate(`document.styleSheets[0].insertRule('.leaflet-tile { pointer-events: auto !important; visibility: visible !important; }')`);
    const topAt = (sel, xFrom) => page.evaluate(`(() => { const m = document.querySelector('.map-canvas').getBoundingClientRect(); const x = Math.max(m.x, ${xFrom}) + 40; const y = Math.min(Math.max(m.y + m.height / 2, 1), innerHeight - 1); return document.querySelector('${sel}').contains(document.elementFromPoint(x, y)); })()`);
    assert.equal(await topAt('.drawer-panel', `document.querySelector('.drawer-panel').getBoundingClientRect().x`), true, 'the drawer paints over the map where they overlap');
    assert.equal(await topAt('.drawer-backdrop', 0), true, 'the backdrop covers the rest of the map');
  } finally { await page.close(); }
});

test('theme: choosing dark sets data-theme, persists across reload, system removes it', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('#theme-select')`, 'theme control');
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-theme')`), false);
    await page.evaluate(`(() => { const s = document.querySelector('#theme-select'); s.value = 'light'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-theme')`), 'light');
    await page.goto(`${base}/web/?fixtures=1`);
    await page.until(`document.querySelector('#theme-select')`, 'reloaded');
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-theme')`), 'light', 'restored by the early script');
    assert.equal(await page.evaluate(`document.querySelector('#theme-select').value`), 'light');
    await page.evaluate(`(() => { const s = document.querySelector('#theme-select'); s.value = 'system'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-theme')`), false);
  } finally { await page.close(); }
});

test('PWA: the manifest is valid and the service worker registers and activates', { skip }, async () => {
  const page = await open(1280);
  try {
    const m = await (await fetch(`${base}/web/manifest.webmanifest`)).json();
    assert.equal(m.id, '/prime-radiant');
    assert.equal(await page.evaluate(`document.querySelector('link[rel=manifest]').href`), `${base}/web/manifest.webmanifest`);
    await page.until(`navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`, 'service worker activated');
    assert.equal(await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.scope)`), `${base}/web/`);
    assert.equal(await page.evaluate(`caches.keys().then((k) => k.some((n) => n.startsWith('pr-shell-')))`), true);
    assert.equal(await fetch(`${base}/web/manifest.webmanifest`).then((r) => r.headers.get('content-type')), 'application/manifest+json');
  } finally { await page.close(); }
});
