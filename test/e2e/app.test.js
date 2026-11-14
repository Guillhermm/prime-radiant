import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, wait } from './cdp.mjs';
import { createStaticServer, loadSite } from '../../tools/serve.mjs';
import { toCsv } from '../../core/index.js';
import { createDataSource } from '../../web/src/data-source.js';
import { buildResult, csvMeta } from '../../web/src/view-data.js';
import { guardCsv, withSyntheticNote } from '../../web/src/components/export-menu.js';
import { parseHash } from '../../web/src/state.js';
import { spanFromManifest } from '../../web/src/components/date-range.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (set CHROME_PATH to run the end-to-end tests)';
if (!chrome && process.env.REQUIRE_CHROME) throw new Error('REQUIRE_CHROME is set but no Chrome was found');

let server;
let synthServer;
let browser;
let base;
let synthBase;
let downloadDir;

before(async () => {
  if (skip) return;
  const site = await loadSite(root, { extra: ['fixtures'] });
  server = createStaticServer(site);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // The same site, but the fixture manifest says synthetic, so the band and its About show.
  const serveFile = server.listeners('request')[0];
  const synthetic = JSON.stringify({ ...JSON.parse(await readFile(join(root, 'fixtures/manifest.json'), 'utf8')), dataVersion: 'synthetic-test' });
  synthServer = createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/fixtures/manifest.json') return serveFile(req, res);
    res.writeHead(200, { ...site.headers, 'content-type': 'application/json' });
    return res.end(synthetic);
  });
  await new Promise((r) => synthServer.listen(0, '127.0.0.1', r));
  synthBase = `http://127.0.0.1:${synthServer.address().port}`;
  browser = await launch(chrome);
  downloadDir = await mkdtemp(join(tmpdir(), 'pr-dl-'));
});

after(async () => {
  await browser?.close();
  server?.close();
  synthServer?.close();
  if (downloadDir) await rm(downloadDir, { recursive: true, force: true });
});

const open = async (width, query = '?fixtures=1', origin = base) => {
  const page = await browser.newPage({ width, height: width < 600 ? 860 : 900, downloadDir });
  await page.goto(`${origin}/web/${query}`);
  return page;
};

const EXAMPLE = '.ex.chip-example';
const CALENDAR_READY = `document.querySelector('.view-calendar .cal-grid') && !document.querySelector('.view-calendar').hidden`;
const lastYear = `[...document.querySelectorAll('.view-calendar .cal-year-row .cal-year')].pop()?.textContent`;
const focusedLabel = `document.activeElement.getAttribute('aria-label')`;

// Clicks land by coordinates, so wait for entrance animations to stop moving the target.
const settle = (page) => page.until(`document.getAnimations().every((a) => a.playState !== 'running')`, 'animations settle');

const openExample = async (page) => {
  await page.until(`document.querySelector('${EXAMPLE}')`, 'first-run example cards');
  await page.click(EXAMPLE);
  await page.until(CALENDAR_READY, 'calendar after an example');
};

const applyFrom2005 = async (page) => {
  await settle(page);
  await page.evaluate(`(() => { const i = document.querySelector('#date-from'); i.value = '2005-01'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.click('.query-form .actions .btn-primary');
  await page.until(`location.hash.includes('from=2005-01')`, 'apply commits from=2005-01');
  await page.until(`${lastYear} === '2005'`, 'calendar ends at 2005');
};

test('the site root redirects to the app and the default load shows the first-run screen', { skip }, async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/web/');
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('${EXAMPLE}')`, 'example cards');
    assert.equal(await page.evaluate(`document.documentElement.classList.contains('is-first-run')`), true);
    assert.equal(await page.evaluate(`document.querySelector('.export-button')?.offsetParent ?? null`), null, 'nothing to export before an area is chosen');
    assert.equal(await page.evaluate(`document.querySelector('.method-button') !== null`), true);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

// Regression: the first-run buttons opened a form inside a hidden section. The other tests entered
// through the example cards, so nothing clicked these buttons.
test('first run, desktop: Enter coordinates opens the form at South, Draw an area opens the map, Apply loads the calendar', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('.cta .btn')`, 'first-run buttons');
    await page.click('.cta .btn:nth-child(2)');
    await page.until(`document.activeElement.id === 'aoi-south' && document.querySelector('.query-form').getBoundingClientRect().height > 0`, 'coordinates form visible, South focused');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').getAttribute('aria-modal')`), 'true');
    await page.press('Escape');
    await page.until(`!document.querySelector('.query-bar').classList.contains('sheet-open')`, 'Esc closes the form');
    assert.equal(await page.evaluate(`document.activeElement.textContent`), 'Enter coordinates', 'focus back on the button');

    await settle(page);
    await page.click('.cta .btn-primary');
    await page.until(`document.querySelector('.map-canvas .leaflet-pane') && document.querySelector('.map-canvas').getBoundingClientRect().height > 100`, 'map visible in the form');
    await page.evaluate(`(() => { const set = (id, v) => { const i = document.querySelector(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('#aoi-south', '-20'); set('#aoi-west', '-58'); set('#aoi-north', '-15'); set('#aoi-east', '-55'); })()`);
    await settle(page);
    await page.click('.query-form .actions .btn-primary');
    await page.until(CALENDAR_READY, 'calendar after Apply');
    assert.equal(await page.evaluate(`document.documentElement.classList.contains('is-first-run')`), false);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('first run, phone: Draw an area opens the map full screen, Enter coordinates the sheet', { skip }, async () => {
  const page = await open(400);
  try {
    await page.until(`document.querySelector('.hero-art .rad-labels text')`, 'first-run Radiant labels');
    const labelPx = await page.evaluate(`(() => { const svg = document.querySelector('.hero-art svg.radiant'); const t = svg.querySelector('.rad-labels text'); return parseFloat(getComputedStyle(t).fontSize) * svg.clientWidth / svg.viewBox.baseVal.width; })()`);
    assert.ok(labelPx >= 11, `month labels render at ${labelPx.toFixed(1)}px, at least 0.6875rem`);
    await page.until(`document.querySelector('.cta .btn')`, 'first-run buttons');
    await page.click('.cta .btn-primary');
    await page.until(`document.querySelector('.map-panel.is-full .map-canvas .leaflet-pane')`, 'full map');
    assert.deepEqual(await page.evaluate(`(() => { const r = document.querySelector('.map-panel.is-full').getBoundingClientRect(); return [r.top, r.left, r.width === innerWidth, r.height === innerHeight]; })()`), [0, 0, true, true], 'the map covers the screen, not the sheet');
    await page.click('.map-cancel');
    await page.until(`!document.querySelector('.map-panel').classList.contains('is-full')`, 'Cancel leaves the map');
    await page.press('Escape');
    await page.until(`!document.querySelector('.query-bar').classList.contains('sheet-open')`, 'sheet closed');
    await settle(page);
    await page.click('.cta .btn:nth-child(2)');
    await page.until(`document.activeElement.id === 'aoi-south' && document.querySelector('.query-form').getBoundingClientRect().height > 0`, 'coordinates sheet, South focused');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('header: the brand goes home to the first run; footer authors link to GitHub without leaking the referrer', { skip }, async () => {
  const page = await open(1280);
  try {
    await openExample(page);
    await page.click('.topbar .brand');
    await page.until(`document.documentElement.classList.contains('is-first-run') && document.querySelector('${EXAMPLE}')`, 'first run again');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar').hidden`), true);
    const authors = await page.evaluate(`[...document.querySelectorAll('.footer-authors a')].map((a) => [a.textContent, a.href, a.rel])`);
    assert.deepEqual(authors, [
      ['Guilherme Almeida Zeni', 'https://github.com/Guillhermm', 'noopener noreferrer'],
      ['Kauê Melo', 'https://github.com/kauemelo01', 'noopener noreferrer'],
    ]);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('synthetic About: a popover that explains the data, with one link to Method', { skip }, async () => {
  const page = await open(1280, '?fixtures=1', synthBase);
  try {
    await page.until(`document.querySelector('.synth-about')`, 'synthetic band');
    await page.click('.synth-about');
    await page.until(`document.querySelector('#synth-about').matches(':popover-open')`, 'About popover open');
    assert.match(await page.evaluate(`document.querySelector('#synth-about').textContent`), /not real fire detections/);
    assert.equal(await page.evaluate(`document.querySelector('.drawer-panel')`), null, 'About alone does not open the drawer');
    await page.press('Escape');
    await page.until(`!document.querySelector('#synth-about').matches(':popover-open')`, 'Esc closes the popover');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('synth-about')`), true, 'Esc returns focus to About');
    await page.click('.synth-about');
    await page.until(`document.querySelector('#synth-about').matches(':popover-open')`, 'About open again');
    await page.evaluate(`document.querySelector('.synth-more').focus(); scrollBy(0, 200)`);
    await page.until(`!document.querySelector('#synth-about').matches(':popover-open')`, 'scroll closes the popover');
    await page.until(`document.activeElement.classList.contains('synth-about')`, 'focus back on About after scroll');
    // Scroll events are dispatched on the next frame; let them land before reopening the popover.
    await page.evaluate(`scrollTo(0, 0); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await page.click('.synth-about');
    await page.click('.synth-more');
    await page.until(`document.querySelector('.drawer-panel[aria-modal="true"]') && !document.querySelector('#synth-about').matches(':popover-open')`, 'Method drawer from the popover link');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('synthetic banner: closes with an animation, a persistent tag stays and opens About, closed for the session only', { skip }, async () => {
  const page = await open(1280, '?fixtures=1', synthBase);
  const visible = (sel) => `(() => { const el = document.querySelector('${sel}'); return Boolean(el && el.getClientRects().length); })()`;
  try {
    await page.until(visible('.synth-band'), 'banner');
    assert.equal(await page.evaluate(visible('.synth-tag')), false, 'no tag while the banner shows');
    assert.equal(await page.evaluate(`document.querySelector('.synth-frame')`), null, 'no frame around the page');
    assert.equal(await page.evaluate(`document.querySelector('.synth-close').getAttribute('aria-label')`), 'Hide the synthetic data notice');
    const topbarBefore = await page.evaluate(`document.querySelector('.topbar').getBoundingClientRect().top`);
    assert.ok(topbarBefore > 0, 'banner sits above the top bar');
    await settle(page);
    await page.click('.synth-close');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('synth-tag')`), true, 'focus moves to the tag');
    await page.until(`document.querySelector('.synth-band').hidden`, 'banner collapsed');
    assert.equal(await page.evaluate(`document.querySelector('.topbar').getBoundingClientRect().top`), 0, 'content moved up into place');
    assert.equal(await page.evaluate(`sessionStorage.getItem('pr-synth-banner-closed')`), '1');
    assert.match(await page.evaluate(`document.querySelector('.topbar .synth-tag').textContent`), /Synthetic data/);
    assert.equal(await page.evaluate(`document.querySelector('.synth-tag').parentElement.nextElementSibling?.dataset.slot`), 'method', 'tag sits right before Method');
    await page.click('.synth-tag');
    await page.until(`document.querySelector('#synth-about').matches(':popover-open')`, 'About from the tag');
    assert.match(await page.evaluate(`document.querySelector('#synth-about').textContent`), /not real fire detections/);
    await page.press('Escape');
    await page.goto(`${synthBase}/web/?fixtures=1`);
    await page.until(visible('.synth-tag'), 'tag after reload');
    assert.equal(await page.evaluate(visible('.synth-band')), false, 'banner stays closed in this session');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
  const next = await open(400, '?fixtures=1', synthBase);
  try {
    await next.until(visible('.synth-band'), 'banner back in a new session');
    assert.equal(await next.evaluate(visible('.synth-tag')), false);
    await next.click('.synth-close');
    await next.until(`document.querySelector('.synth-band').hidden`, 'banner closed on phone');
    const [tagRight, methodLeft, brandRight, tagLeft] = await next.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return [r('.synth-tag').right, r('[data-slot=method]').left, r('.brand').right, r('.synth-tag').left]; })()`);
    assert.ok(tagRight <= methodLeft && brandRight <= tagLeft, `phone header order brand, tag, Method without overlap: ${[brandRight, tagLeft, tagRight, methodLeft]}`);
    await openExample(next);
    await next.evaluate(`(() => { const c = [...document.querySelectorAll('.view-calendar .cal-cell[data-row]')].pop(); c.scrollIntoView({ block: 'end' }); c.focus(); })()`);
    await next.press('Enter');
    await next.until(`document.querySelector('.panel-host.is-sheet .panel[role=dialog]')`, 'sheet on phone');
    assert.equal(await next.evaluate(`document.querySelector('.panel-host .panel-top .eyebrow').textContent`), 'Selected month · Synthetic data', 'the sheet says synthetic while it covers the top bar');
    assert.equal(await next.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'no horizontal scroll at 400px');
  } finally { await next.close(); }
});

test('toast: hover pauses the countdown, the close button dismisses it; drawer lock keeps the layout still', { skip }, async () => {
  const page = await open(1280);
  try {
    await openExample(page);
    const right = await page.evaluate(`document.querySelector('.export-button').getBoundingClientRect().right`);
    await page.click('.method-button');
    await page.until(`document.querySelector('.drawer-panel')`, 'drawer open');
    assert.equal(await page.evaluate(`document.querySelector('.export-button').getBoundingClientRect().right`), right, 'no layout shift when the page scroll locks');
    await page.press('Escape');
    await page.until(`!document.querySelector('.drawer-panel')`, 'drawer closed');

    await page.evaluate(`import('./src/components/toast.js').then((t) => t.show('Hello', { ms: 600 }))`);
    await page.until(`document.querySelector('.toast')`, 'toast shown');
    const box = await page.evaluate(`(() => { const r = document.querySelector('.toast').getBoundingClientRect(); return [r.right <= innerWidth && r.right > innerWidth - 60, r.bottom > innerHeight - 80]; })()`);
    assert.deepEqual(box, [true, true], 'bottom right');
    await page.evaluate(`document.querySelector('.toast').dispatchEvent(new PointerEvent('pointerenter'))`);
    await wait(900);
    assert.equal(await page.evaluate(`document.querySelector('.toast.is-paused') !== null`), true, 'still there while hovered');
    await page.click('.toast-close');
    await page.until(`!document.querySelector('.toast')`, 'close dismisses');
    // A toast that appears under a resting pointer pauses, as it should; move the pointer away first.
    await page.moveMouse(20, 400);
    await page.evaluate(`import('./src/components/toast.js').then((t) => t.show('Oops', { kind: 'error', ms: 300 }))`);
    assert.equal(await page.evaluate(`document.querySelector('.toast-host [role=alert] .toast-msg')?.textContent`), 'Oops', 'errors use the alert region');
    await page.until(`!document.querySelector('.toast')`, 'auto-dismiss');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('example, apply, docked panel follows arrow keys, Method drawer and CSV export', { skip }, async () => {
  const page = await open(1280);
  try {
    await openExample(page);
    assert.equal(await page.evaluate(`document.querySelector('.caveat .badge')?.textContent`), 'Preliminary');
    await page.click('.area-chip');
    await page.until(`document.querySelector('.query-form[aria-modal="true"]')`, 'area popover opens');
    await applyFrom2005(page);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.view-calendar .cal-year-row .cal-year')].every((y) => Number(y.textContent) >= 2005)`), true);

    await page.evaluate(`document.querySelector('.view-calendar .cal-cell[tabindex="0"]').focus()`);
    const label = await page.evaluate(focusedLabel);
    await page.press('Enter');
    await page.until(`document.querySelector('.panel-host.is-open:not(.is-sheet) .panel[role=region]')`, 'docked panel opens on Enter');
    assert.equal(await page.evaluate(focusedLabel), label, 'focus stays on the cell in the grid');
    assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('.view-calendar .cal-total')).display`), 'none', 'year totals stay with the panel open at 80rem');
    assert.equal(await page.evaluate(`document.querySelector('#panel-title').textContent`), label.split(',')[0]);

    await page.press('ArrowRight');
    const next = await page.evaluate(focusedLabel);
    assert.notEqual(next, label, 'arrow moves to the next month');
    assert.equal(await page.evaluate(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).boxShadow !== 'none'`), true, 'roving cell keeps its focus ring');
    await page.until(`document.querySelector('#panel-title').textContent === ${JSON.stringify(next.split(',')[0])}`, 'panel follows the selection');
    assert.equal(await page.evaluate(`document.querySelectorAll('.view-calendar .cal-cell.is-selected').length`), 1);

    await page.press('Escape');
    await page.until(`!document.querySelector('.panel-host.is-open')`, 'Esc closes the panel');
    assert.equal(await page.evaluate(focusedLabel), next);

    await page.click('.method-button');
    await page.until(`document.querySelector('.drawer-panel[aria-modal="true"]')`, 'Method drawer opens');
    assert.equal(await page.evaluate(`document.querySelector('.method-button').getAttribute('aria-expanded')`), 'true');
    for (let i = 0; i < 6; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.drawer-panel').contains(document.activeElement)`), true, 'focus stays in the drawer');
    await page.press('Escape');
    await page.until(`!document.querySelector('.drawer-panel')`, 'Esc closes the drawer');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('method-button')`), true);

    await page.click('.export-button');
    await page.until(`document.querySelector('.toast-host [role=status] .toast-msg')?.textContent.startsWith('CSV saved: prime-radiant-2005-01-')`, 'CSV export toast');
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
    const expected = guardCsv(toCsv(result.series, csvMeta(result)));
    assert.equal(actual, withSyntheticNote(expected, Boolean(m.synthetic)));
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('phone width (400px): chips wrap, popover traps focus, sheet keeps the cell visible, no horizontal scroll', { skip }, async () => {
  const page = await open(400);
  try {
    await openExample(page);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.summary-chip')].every((c) => c.scrollWidth <= c.clientWidth + 1)`), true, 'period and area chips are not truncated');
    await page.click('.area-chip');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').getAttribute('aria-modal')`), 'true');
    for (let i = 0; i < 25; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').contains(document.activeElement)`), true, 'focus trapped in the sheet');
    await applyFrom2005(page);
    assert.equal(await page.evaluate(`!document.querySelector('.query-bar').classList.contains('sheet-open') && document.activeElement.classList.contains('area-chip')`), true, 'sheet closed, focus back on the chip');
    assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'no horizontal page scroll');
    assert.equal(await page.evaluate(`(() => { const s = document.querySelector('.cal-scroll'); return s.scrollWidth <= s.clientWidth; })()`), true, 'all 12 months fit without scrolling');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.tabs')).position`), 'fixed', 'views become a bottom bar');

    // The bottom sheet must not cover the tapped cell (WCAG 2.4.11).
    await page.evaluate(`(() => { const c = [...document.querySelectorAll('.view-calendar .cal-cell[data-row]')].pop(); c.scrollIntoView({ block: 'end' }); c.focus(); })()`);
    const label = await page.evaluate(focusedLabel);
    await page.press('Enter');
    await page.until(`document.querySelector('.panel-host.is-sheet .panel[role=dialog][aria-modal="true"]')`, 'modal sheet opens on phone');
    assert.equal(await page.evaluate(`document.activeElement.id`), 'panel-title', 'focus moves into the sheet');
    await wait(500);
    assert.equal(await page.evaluate(`(() => { const c = document.querySelector('.view-calendar .cal-cell.is-selected').getBoundingClientRect(); const p = document.querySelector('.panel-host .panel'); return c.bottom <= innerHeight - p.offsetHeight; })()`), true, 'cell is above the sheet');
    assert.equal(await page.evaluate(`document.querySelector('.panel-host .panel .panel-copy')?.textContent`), 'Copy link', 'phone users can copy the link from the sheet');
    await page.evaluate(`document.querySelector('.panel-host .panel .panel-copy').click()`);
    await page.until(`document.querySelector('.toast-host .toast-msg')?.textContent.length > 0`, 'copy reports its result in a toast');
    for (let i = 0; i < 15; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.panel-host .panel').contains(document.activeElement)`), true, 'focus trapped in the sheet');
    await page.press('Escape');
    await page.until(`!document.querySelector('.panel-host.is-open')`, 'Esc closes the sheet');
    assert.equal(await page.evaluate(focusedLabel), label, 'focus returns to the cell');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('?preview=1: anomaly layer with rank in the panel, then the Live view and its table', { skip }, async () => {
  const page = await open(1280, '?fixtures=1&preview=1');
  try {
    await openExample(page);
    await page.click('input[name="layer"][value="anomaly"]');
    await page.until(`location.hash.includes('layer=anomaly') && document.querySelector('.view-calendar .anomaly-layer')?.offsetParent !== null`, 'anomaly layer shown');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar .anomaly-preview-note').textContent`), 'Preview: placeholder anomaly and live numbers, not validated.');

    await page.evaluate(`document.querySelector('.view-calendar .anomaly-layer .cal-cell[tabindex="0"]').focus()`);
    await page.press('Enter');
    await page.until(`document.querySelector('.panel-host.is-open')`, 'panel opens from the anomaly layer');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.panel .detail-list dt')].some((d) => d.textContent === 'Percentile rank')`), true);
    assert.equal(await page.evaluate(`document.querySelectorAll('.panel .tag').length >= 1 && [...document.querySelectorAll('.panel .tag')].every((t) => t.textContent === 'Preview')`), true, 'Preview tag on the preview numbers in the panel');
    await page.press('Escape');
    await page.until(`!document.querySelector('.panel-host.is-open')`, 'Esc closes the panel');

    await page.click('#tab-anomalies');
    await page.until(`document.querySelector('.view-anomalies .anomaly-layer')?.offsetParent !== null && document.querySelector('.view-calendar').hidden`, 'Anomalies view owned by the shell');
    await settle(page);
    await page.click('#tab-live');
    await page.until(`!document.querySelector('.view-live').hidden && document.querySelector('.view-live .live-chart')`, 'Live view with its chart');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar').hidden && document.querySelector('.view-anomalies').hidden`), true);
    await settle(page);
    await page.click('.view-live .cal-toggle');
    await page.until(`document.querySelector('.view-live .live-table')?.offsetParent !== null`, 'Live table shown');
    assert.equal(await page.evaluate(`document.querySelectorAll('.view-live .live-table tbody tr').length`), 12);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('tab switch updates the hash, back restores the previous view, disabled views are absent', { skip }, async () => {
  const page = await open(1280);
  try {
    await openExample(page);
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

test('phone full map from the sheet: Leaflet stays isolated, and the Method drawer closes the map first', { skip }, async () => {
  const page = await open(400);
  try {
    await openExample(page);
    await page.click('.area-chip');
    await settle(page);
    await page.click('.query-form .draw-map');
    await page.until(`document.querySelector('.map-panel.is-full .map-canvas .leaflet-pane') && document.body.classList.contains('map-open')`, 'full map open');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.map-canvas')).isolation`), 'isolate', 'Leaflet z-indexes stay inside the map');
    // The tiles must not paint over the full-screen chrome (Done and Cancel).
    await page.until(`document.querySelector('.map-canvas .leaflet-tile')`, 'tiles present');
    await page.evaluate(`document.styleSheets[0].insertRule('.leaflet-tile { pointer-events: auto !important; visibility: visible !important; }')`);
    assert.equal(await page.evaluate(`(() => { const b = document.querySelector('.map-full-bar .map-done').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.map-done') !== null; })()`), true);

    // The full map covers the top bar, so the drawer is opened from script here.
    await page.evaluate(`document.querySelector('.method-button').click()`);
    await page.until(`document.querySelector('.drawer-panel[aria-modal="true"]')`, 'drawer open');
    assert.equal(await page.evaluate(`!document.querySelector('.map-panel').classList.contains('is-full') && !document.body.classList.contains('map-open') && !document.querySelector('.query-bar').classList.contains('sheet-open')`), true, 'map and popover closed, page scroll unlocked');
    assert.equal(await page.evaluate(`document.querySelector('.drawer-panel').contains(document.activeElement)`), true);
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('theme: choosing light sets data-theme, persists across reload, system removes it', { skip }, async () => {
  const page = await open(1280);
  const pick = (id) => page.click(`.site-footer .theme-opt[data-theme-id="${id}"]`);
  try {
    await page.until(`document.querySelector('.site-footer .theme-opt')`, 'theme control');
    assert.equal(await page.evaluate(`document.querySelector('.topbar .theme-opt')`), null, 'no theme switch in the header');
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-theme')`), false);
    await pick('light');
    await page.until(`document.documentElement.getAttribute('data-theme') === 'light'`, 'light applied');
    await page.goto(`${base}/web/?fixtures=1`);
    await page.until(`document.querySelector('.site-footer .theme-opt')`, 'reloaded');
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-theme')`), 'light', 'restored by the early script');
    assert.equal(await page.evaluate(`document.querySelector('.site-footer .theme-opt[data-theme-id="light"]').getAttribute('aria-checked')`), 'true');
    await pick('system');
    await page.until(`!document.documentElement.hasAttribute('data-theme')`, 'system removes data-theme');
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
