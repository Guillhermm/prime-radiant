import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, wait } from './cdp.mjs';
import { createStaticServer, loadSite } from '../../tools/serve.mjs';
import { createDataSource } from '../../web/src/data-source.js';
import { buildResult, csvMeta } from '../../web/src/view-data.js';
import { csvExport } from '../../web/src/components/export-menu.js';
import { imageModel, pngSize } from '../../web/src/components/export-image.js';
import { generate } from '../../tools/mock-data.mjs';
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
let synthOverview;

before(async () => {
  if (skip) return;
  const site = await loadSite(root, { extra: ['fixtures'] });
  server = createStaticServer(site);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // The same site serving a synthetic data/ built in memory by the mock generator, as production
  // does until real tiles are hosted: Brazil only, 2000-11 to 2019-12, so the band, the Sensors
  // ratios and the preview ranks all have data.
  const serveFile = server.listeners('request')[0];
  const synth = generate({ last: '2019-12', now: new Date('2026-11-14T00:00:00Z') });
  synthOverview = synth.overview;
  const files = new Map([['/data/manifest.json', synth.manifest], ['/data/domain.json', synth.domain], ['/data/overview.json', synth.overview],
    ...Object.entries(synth.tiles).map(([id, t]) => [`/data/tiles/0.1/${id}.json`, t]),
    ...Object.entries(synth.coarse).map(([id, t]) => [`/data/tiles/1/${id}.json`, t])]);
  synthServer = createServer((req, res) => {
    const body = files.get(new URL(req.url, 'http://x').pathname);
    if (!body) return serveFile(req, res);
    res.writeHead(200, { ...site.headers, 'content-type': 'application/json' });
    return res.end(JSON.stringify(body));
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
const focusedLabel = `document.activeElement.getAttribute('aria-label')`;

// Clicks land by coordinates, so wait for entrance animations to stop moving the target.
// Infinite loops (the Live freshness dot) never settle and move nothing, so they are skipped.
const settle = (page) => page.until(`document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity)`, 'animations settle');

// Export is a menu: open it and pick CSV or Image (PNG).
const exportAs = async (page, id) => {
  await settle(page);
  await page.click('.export-button');
  await page.until(`document.querySelector('.export-menu').matches(':popover-open') && document.activeElement?.dataset.id === 'csv'`, 'export menu open, CSV focused');
  await page.click(`.export-menu [data-id="${id}"]`);
};

// Width and height from a PNG's IHDR chunk, after checking the signature.
const pngHeader = (buf) => {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

const openExample = async (page) => {
  await page.until(`document.querySelector('${EXAMPLE}')`, 'first-run example cards');
  await page.click(EXAMPLE);
  await page.until(CALENDAR_READY, 'calendar after an example');
};

// The fixture span is 2023-01 to 2023-06: from March leaves four months.
const applyFromMarch = async (page) => {
  await settle(page);
  await page.evaluate(`(() => { const i = document.querySelector('#date-from'); i.value = '2023-03'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await page.click('.query-form .actions .btn-primary');
  await page.until(`location.hash.includes('from=2023-03')`, 'apply commits from=2023-03');
  await page.until(`document.querySelectorAll('.view-calendar .calendar:not(.anomaly-layer) .cal-cell[data-row]').length === 4`, 'calendar starts at March 2023');
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
    await settle(page);
    await page.click('.cta .btn:nth-child(2)');
    await page.until(`document.activeElement.id === 'aoi-south' && document.querySelector('.query-form').getBoundingClientRect().height > 0`, 'coordinates form visible, South focused');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').getAttribute('aria-modal')`), 'true');
    await page.press('Escape');
    await page.until(`!document.querySelector('.query-bar').classList.contains('sheet-open')`, 'Esc closes the form');
    assert.equal(await page.evaluate(`document.activeElement.textContent`), 'Enter coordinates', 'focus back on the button');

    await settle(page);
    await page.click('.cta .btn-primary');
    await page.until(`document.querySelector('.map-canvas .leaflet-pane') && document.querySelector('.map-canvas').getBoundingClientRect().height > 100`, 'map visible in the form');
    await page.evaluate(`(() => { const set = (id, v) => { const i = document.querySelector(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('#aoi-south', '41'); set('#aoi-west', '-9'); set('#aoi-north', '49'); set('#aoi-east', '-1'); })()`);
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
  const page = await open(1280, '', synthBase);
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
    // Scrolling closes it from the frame after it opened.
    await page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
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
  const page = await open(1280, '', synthBase);
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
    assert.equal(await page.evaluate(`document.querySelector('.synth-tag').parentElement.nextElementSibling?.dataset.slot`), 'method', 'tag sits right before Method, then the place button');
    await page.click('.synth-tag');
    await page.until(`document.querySelector('#synth-about').matches(':popover-open')`, 'About from the tag');
    assert.match(await page.evaluate(`document.querySelector('#synth-about').textContent`), /not real fire detections/);
    await page.press('Escape');
    await page.goto(`${synthBase}/web/`);
    await page.until(visible('.synth-tag'), 'tag after reload');
    assert.equal(await page.evaluate(visible('.synth-band')), false, 'banner stays closed in this session');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
  const next = await open(400, '', synthBase);
  try {
    await next.until(visible('.synth-band'), 'banner back in a new session');
    assert.equal(await next.evaluate(visible('.synth-tag')), false);
    await next.click('.synth-close');
    await next.until(`document.querySelector('.synth-band').hidden`, 'banner closed on phone');
    const [tagRight, methodLeft, brandRight, tagLeft, methodRight, areasLeft, areasRight] = await next.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return [r('.synth-tag').right, r('[data-slot=method]').left, r('.brand').right, r('.synth-tag').left, r('[data-slot=method]').right, r('[data-slot=areas]').left, r('[data-slot=areas]').right]; })()`);
    assert.ok(tagRight <= methodLeft && brandRight <= tagLeft && methodRight <= areasLeft && areasRight <= 400, `phone header order brand, tag, Method, place button without overlap: ${[brandRight, tagLeft, tagRight, methodLeft, methodRight, areasLeft, areasRight]}`);
    await openExample(next);
    await next.evaluate(`(() => { const c = [...document.querySelectorAll('.view-calendar .calendar:not(.anomaly-layer) .cal-cell[data-row]')].pop(); c.scrollIntoView({ block: 'end' }); c.focus(); })()`);
    await next.press('Enter');
    await next.until(`document.querySelector('.panel-host.is-sheet .panel[role=dialog]')`, 'sheet on phone');
    assert.equal(await next.evaluate(`document.querySelector('.panel-host .panel-top .eyebrow').textContent`), 'Selected month · Synthetic data', 'the sheet says synthetic while it covers the top bar');
    assert.equal(await next.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'no horizontal scroll at 400px');
  } finally { await next.close(); }
});

test('offline chip: saved data while offline, plain Offline and the offline error for an area not loaded, gone on reconnect', { skip }, async () => {
  const page = await open(1280);
  const chip = `(() => { const c = document.querySelector('.topbar .offline-chip'); return c && !c.hidden ? c.textContent : null; })()`;
  try {
    await openExample(page);
    assert.equal(await page.evaluate(chip), null, 'hidden while online');
    assert.equal(await page.evaluate(`document.querySelector('.offline-chip').closest('[role=status]') !== null`), true, 'announced through a status region');
    await page.setOffline(true);
    await page.until(`${chip} === 'Offline · showing saved data'`, 'offline chip over loaded data');
    await page.evaluate(`location.hash = location.hash.replace(/aoi=bbox:[^&]*/, 'aoi=bbox:-179,61,-175,65')`);
    await page.until(`${chip} === 'Offline'`, 'plain Offline when the area cannot load');
    await page.until(`/not saved for offline use/.test(document.querySelector('[data-slot=empty]').textContent)`, 'offline error copy').catch(async (e) => { throw new Error(`${e.message}: ${await page.evaluate(`document.querySelector('[data-slot=empty]').textContent`)}`); });
    await page.setOffline(false);
    await page.until(`${chip} === null`, 'chip gone on reconnect');
    // That tile lies outside the fixture domain: once loaded, the area says so instead of showing zeros.
    await page.until(`/Outside the data domain/.test(document.querySelector('[data-slot=empty]').textContent)`, 'the area loads again once online');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar').hidden`), true, 'no grid of no-data cells');
  } finally { await page.setOffline(false).catch(() => {}); await page.close(); }
});

test('share menu on the area chip: arrows move, Escape returns focus, copy reports in a toast, at desktop and phone width', { skip }, async () => {
  for (const width of [1280, 400]) {
    const page = await open(width);
    const open_ = `document.querySelector('.share-menu').matches(':popover-open')`;
    try {
      await openExample(page);
      await settle(page);
      await page.click('.share-chip');
      await page.until(`${open_} && document.activeElement?.dataset.id === 'link'`, 'menu open, first item focused');
      await page.press('ArrowDown');
      assert.equal(await page.evaluate(`document.activeElement.dataset.id`), 'coords');
      await page.press('ArrowDown');
      assert.equal(await page.evaluate(`document.activeElement.dataset.id`), 'link', 'wraps around');
      await page.press('Escape');
      await page.until(`!${open_} && document.activeElement.classList.contains('share-chip')`, 'Escape closes, focus back on the button');
      await page.click('.share-chip');
      await page.until(open_, 'menu open again');
      await page.evaluate(`document.querySelector('.share-item[data-id=coords]').click()`);
      await page.until(`/oordinates/.test(document.querySelector('.toast-host .toast-msg')?.textContent ?? '')`, 'coordinates result in a toast');
      assert.match(await page.evaluate(`document.querySelector('.toast-host .toast-msg').textContent`), /-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?/);
      const box = await page.evaluate(`(() => { const r = document.querySelector('.share-chip').getBoundingClientRect(); return [r.right <= innerWidth, r.width >= 40, document.documentElement.scrollWidth <= innerWidth]; })()`);
      assert.deepEqual(box, [true, true, true], `share button fits at ${width}px`);
    } finally { await page.close(); }
  }
});

test('without the Popover API, About and the share menu still close on Escape and return focus', { skip }, async () => {
  const page = await browser.newPage({ width: 1280, height: 900, downloadDir });
  await page.addInitScript('for (const k of ["showPopover", "hidePopover", "togglePopover"]) delete HTMLElement.prototype[k];');
  await page.goto(`${synthBase}/web/`);
  const shown = (sel) => `(() => { const e = document.querySelector('${sel}'); return Boolean(e && !e.hidden && e.getClientRects().length); })()`;
  try {
    await page.until(`document.querySelector('.synth-about')`, 'band');
    assert.equal(await page.evaluate(`typeof HTMLElement.prototype.showPopover`), 'undefined');
    assert.equal(await page.evaluate(shown('#synth-about')), false, 'closed at start');
    await page.click('.synth-about');
    await page.until(shown('#synth-about'), 'About opens');
    assert.equal(await page.evaluate(`document.querySelector('.synth-about').getAttribute('aria-expanded')`), 'true');
    await page.evaluate(`document.querySelector('.synth-more').focus()`);
    await page.press('Escape');
    await page.until(`!${shown('#synth-about')} && document.activeElement.classList.contains('synth-about')`, 'Escape closes, focus on About');
    await page.click('.synth-about');
    await page.until(shown('#synth-about'), 'About again');
    await page.click('.hero-title');
    await page.until(`!${shown('#synth-about')}`, 'outside click closes');
    await openExample(page);
    await settle(page);
    await page.click('.share-chip');
    await page.until(`${shown('.share-menu')} && document.activeElement?.dataset.id === 'link'`, 'share menu opens');
    await page.press('Escape');
    await page.until(`!${shown('.share-menu')} && document.activeElement.classList.contains('share-chip')`, 'share menu closes on Escape');
  } finally { await page.close(); }
});

test('iOS install hint: a permanent footer line, and a card once after the first area loads, never on first run', { skip }, async () => {
  const page = await browser.newPage({ width: 400, height: 860, downloadDir });
  await page.emulateDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 });
  await page.goto(`${base}/web/?fixtures=1`);
  try {
    await page.until(`document.querySelector('.site-footer .ios-hint')`, 'footer line');
    assert.match(await page.evaluate(`document.querySelector('.site-footer .ios-hint').textContent`), /Share, then Add to Home Screen/);
    assert.equal(await page.evaluate(`document.querySelector('.ios-card')`), null, 'no card on first run');
    await openExample(page);
    await page.until(`document.querySelector('.ios-card')`, 'card after the first area loads');
    await settle(page);
    const [cardBottom, barTop] = await page.evaluate(`[document.querySelector('.ios-card').getBoundingClientRect().bottom, document.querySelector('.tabs').getBoundingClientRect().top]`);
    assert.ok(cardBottom <= barTop, `card sits above the tab bar (${cardBottom} <= ${barTop})`);
    assert.equal(await page.evaluate(`localStorage.getItem('pr-ios-hint-closed')`), '1', 'shown once');
    await settle(page);
    await page.click('.ios-card .ios-hint-close');
    await page.until(`!document.querySelector('.ios-card')`, 'closed');
    await page.evaluate(`window.__stale = true`);
    await page.goto(`${base}/web/?fixtures=1`);
    await page.until(`!window.__stale && document.readyState === 'complete'`, 'reloaded');
    await openExample(page);
    await page.evaluate(`new Promise((r) => setTimeout(r, 300))`);
    assert.equal(await page.evaluate(`document.querySelector('.ios-card')`), null, 'never again');
    assert.ok(await page.evaluate(`document.querySelector('.site-footer .ios-hint')`), 'the footer line stays');
  } finally { await page.close(); }
  const other = await open(400);
  try {
    await openExample(other);
    assert.equal(await other.evaluate(`document.querySelector('.ios-hint, .ios-card')`), null, 'not on other devices');
  } finally { await other.close(); }
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
    assert.equal(await page.evaluate(`document.querySelector('.caveat .badge')`), null, 'gate V1 passed: no Preliminary badge');
    await page.click('.range-chip');
    await page.until(`document.querySelector('.query-form[aria-modal="true"]')`, 'area and period popover opens');
    await applyFromMarch(page);
    assert.match(await page.evaluate(`document.querySelector('.view-calendar .cal-cell.is-partial')?.getAttribute('aria-label') ?? ''`), /^June 2023, 10 fire-cell-days, .*partial month, sensor outage$/, 'the partial month is marked and named');

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

    await exportAs(page, 'csv');
    await page.until(`document.querySelector('.toast-host [role=status] .toast-msg')?.textContent.startsWith('CSV saved: prime-radiant-2023-03-')`, 'CSV export toast');
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
    const { manifest: m, tiles, domain } = await source.load(state.bbox);
    const result = buildResult({ bbox: state.bbox, from: state.from, to: state.to, manifest: m, tiles, domain });
    const expected = csvExport('calendar', { series: result.series, cells: result.cells, meta: csvMeta(result, { aoi: 'Fixture area (tile x17y13)' }) }).text;
    assert.equal(actual, expected);
    assert.match(actual, /\r\n2023,6,10,partial,false,\r\n$/);

    // Menu keys: Down and End reach the image item, Escape closes and returns focus to Export.
    await settle(page);
    await page.click('.export-button');
    await page.until(`document.activeElement?.dataset.id === 'csv'`, 'menu opens on CSV');
    await page.press('ArrowDown');
    assert.equal(await page.evaluate(`document.activeElement.textContent`), 'Image (PNG)');
    await page.press('ArrowDown');
    assert.equal(await page.evaluate(`document.activeElement.dataset.id`), 'csv', 'Down wraps to the first item');
    await page.press('End');
    assert.equal(await page.evaluate(`document.activeElement.dataset.id`), 'png');
    await page.press('Escape');
    await page.until(`document.activeElement.classList.contains('export-button') && !document.querySelector('.export-menu').matches(':popover-open')`, 'Escape closes the menu, focus on Export');
    await exportAs(page, 'png');
    await page.until(`document.querySelector('.toast-host [role=status] .toast-msg')?.textContent.startsWith('Image saved: prime-radiant-2023-03-2023-06.png')`, 'image export toast');
    for (let i = 0; i < 50 && !(await readdir(downloadDir)).some((f) => f.endsWith('.png')); i++) await wait(100);
    const pngs = (await readdir(downloadDir)).filter((f) => f.endsWith('.png'));
    assert.deepEqual(pngs, ['prime-radiant-2023-03-2023-06.png']);
    const model = imageModel({
      cells: result.cells, aoiCells: result.aoiCells, title: 'Fixture area (tile x17y13)', bbox: result.bbox,
      dataVersion: m.dataVersion, citation: m.citation, synthetic: false, generated: '2026-11-15',
    });
    assert.deepEqual(pngHeader(await readFile(join(downloadDir, pngs[0]))), pngSize(model));
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('outside the domain: a state card with Draw an area in the data domain and the examples; Export disabled and says why', { skip }, async () => {
  const page = await open(1280, '?fixtures=1#aoi=bbox:-179,61,-175,65');
  try {
    await page.until(`document.querySelector('.state-box-outside')`, 'outside state');
    assert.equal(await page.evaluate(`document.querySelector('.state-box-outside .state-action').textContent`), 'Draw an area in the data domain', 'fixture mode has no overview.json, so no region name');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.state-box-outside .state-chip')].map((c) => c.textContent)`), ['Fixture area (tile x17y13)']);
    const btn = `document.querySelector('.export-button')`;
    assert.equal(await page.evaluate(`${btn}.getAttribute('aria-disabled')`), 'true');
    assert.match(await page.evaluate(`document.getElementById(${btn}.getAttribute('aria-describedby')).textContent`), /^Nothing to export: this area lies outside the data domain\.$/);
    await page.click('.export-button');
    await wait(300);
    assert.equal(await page.evaluate(`document.querySelector('.export-menu').matches(':popover-open')`), false, 'a disabled Export opens no menu');
    assert.equal(await page.evaluate(`document.querySelector('.toast-host [role=status] .toast-msg')?.textContent ?? null`), null, 'a disabled Export does nothing');
    await settle(page);
    await page.click('.state-box-outside .state-action');
    await page.until(`document.querySelector('.map-canvas .leaflet-pane') && document.querySelector('.map-canvas').getBoundingClientRect().height > 100`, 'the map opens');
    await page.press('Escape');
    await settle(page);
    await page.click('.state-box-outside .state-chip');
    await page.until(CALENDAR_READY, 'an example loads the calendar');
    assert.equal(await page.evaluate(`${btn}.hasAttribute('aria-disabled')`), false, 'Export is back');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('phone width (400px): chips wrap, popover traps focus, sheet keeps the cell visible, no horizontal scroll', { skip }, async () => {
  const page = await open(400);
  try {
    await openExample(page);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.summary-chip')].every((c) => c.scrollWidth <= c.clientWidth + 1)`), true, 'period and area chips are not truncated');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.caveat-text'), '::after').content`), 'none', 'no Preliminary word once gate V1 passed');
    await page.click('.range-chip');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').getAttribute('aria-modal')`), 'true');
    for (let i = 0; i < 25; i++) await page.press('Tab');
    assert.equal(await page.evaluate(`document.querySelector('.query-form').contains(document.activeElement)`), true, 'focus trapped in the sheet');
    await applyFromMarch(page);
    assert.equal(await page.evaluate(`!document.querySelector('.query-bar').classList.contains('sheet-open') && document.activeElement.classList.contains('range-chip')`), true, 'sheet closed, focus back on the chip');
    assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'no horizontal page scroll');
    assert.equal(await page.evaluate(`(() => { const s = document.querySelector('.cal-scroll'); return s.scrollWidth <= s.clientWidth; })()`), true, 'all 12 months fit without scrolling');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.tabs')).position`), 'fixed', 'views become a bottom bar');

    // The bottom sheet must not cover the tapped cell (WCAG 2.4.11).
    await page.evaluate(`(() => { const c = [...document.querySelectorAll('.view-calendar .calendar:not(.anomaly-layer) .cal-cell[data-row]')].pop(); c.scrollIntoView({ block: 'end' }); c.focus(); })()`);
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
  // Ranks need years of history, which the six fixture months lack.
  const page = await open(1280, '?preview=1', synthBase);
  try {
    await openExample(page);
    await page.click('input[name="layer"][value="anomaly"]');
    await page.until(`location.hash.includes('layer=anomaly') && document.querySelector('.view-calendar .anomaly-layer')?.offsetParent !== null`, 'anomaly layer shown');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar .anomaly-preview-note').textContent`), 'Synthetic data. Preview: placeholder anomaly and live numbers, not validated.');

    await page.evaluate(`document.querySelector('.view-calendar .anomaly-layer .cal-cell[tabindex="0"]').focus()`);
    await page.press('Enter');
    await page.until(`document.querySelector('.panel-host.is-open')`, 'panel opens from the anomaly layer');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.panel .detail-list dt')].some((d) => d.textContent === 'Percentile rank')`), true);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.panel .tag')].every((t) => t.textContent === 'Preview')`), true, 'only Preview tags in the panel');
    await page.press('Escape');
    await page.until(`!document.querySelector('.panel-host.is-open')`, 'Esc closes the panel');

    await page.click('#tab-anomalies');
    await page.until(`document.querySelector('.view-anomalies .anomaly-layer')?.offsetParent !== null && document.querySelector('.view-calendar').hidden`, 'Anomalies view owned by the shell');
    await settle(page);
    assert.equal(await page.evaluate(`(() => { const d = document.querySelector('#tab-live .tab-dot'); return Boolean(d && !d.hidden && d.getClientRects().length); })()`), true, 'Live tab shows the freshness dot');
    const gap = await page.evaluate(`(() => { const t = document.querySelector('#tab-live'); return t.querySelector('.tab-label').getBoundingClientRect().left - t.querySelector('.tab-dot').getBoundingClientRect().right; })()`);
    assert.ok(Math.abs(gap - 8) < 0.5, `dot sits 0.5rem before the label (${gap}px)`);
    assert.match(await page.evaluate(`document.querySelector('#tab-live').textContent`), /updated in the last 48 hours/);
    await page.click('#tab-live');
    await page.until(`!document.querySelector('.view-live').hidden && document.querySelector('.view-live .live-chart')`, 'Live view with its chart');
    assert.equal(await page.evaluate(`document.querySelector('.view-calendar').hidden && document.querySelector('.view-anomalies').hidden`), true);
    await settle(page);
    await page.click('.view-live .live-card .seg-opt[data-id="table"]');
    await page.until(`document.querySelector('.view-live .live-table')?.offsetParent !== null`, 'Live table shown');
    assert.equal(await page.evaluate(`document.querySelectorAll('.view-live .live-table tbody tr').length`), 12, 'the last twelve months');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('first run: Home is the selected tab; a view opens the first example there with nothing selected; Home and the brand go home', { skip }, async () => {
  for (const width of [1280, 400]) {
    const page = await open(width, '', synthBase);
    const selected = `[...document.querySelectorAll('[role=tab][aria-selected="true"]')].map((b) => b.dataset.view)`;
    const visibleTabs = `Boolean(document.querySelector('[role=tablist][aria-label="Views"]')?.getClientRects().length)`;
    const firstRun = `document.documentElement.classList.contains('is-first-run') && document.querySelector('${EXAMPLE}')`;
    try {
      await page.until(`document.querySelector('${EXAMPLE}')`, 'example cards');
      assert.equal(await page.evaluate(visibleTabs), true, `switcher on the first screen at ${width}`);
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.view)`), ['home', 'calendar', 'sensors', 'anomalies', 'live']);
      assert.deepEqual(await page.evaluate(selected), ['home'], 'exactly one selected tab: Home');
      assert.equal(await page.evaluate(`document.getElementById('main-view').getAttribute('aria-labelledby')`), 'tab-home');
      assert.equal(await page.evaluate(`document.getElementById('tab-home').getAttribute('aria-label')`), 'Home');
      const homeLabelWidth = await page.evaluate(`document.querySelector('#tab-home .tab-label').getBoundingClientRect().width`);
      assert.ok(width < 640 ? homeLabelWidth > 20 : homeLabelWidth <= 1, `Home is icon only on desktop, icon and label in the phone bar (${homeLabelWidth})`);
      await settle(page);
      await page.click('[role=tab][data-view="anomalies"]');
      await page.until(`!document.querySelector('.view-anomalies').hidden && document.querySelector('.anomaly-answer .answer-big')`, 'Anomalies with the first example');
      const hash = await page.evaluate('location.hash');
      assert.ok(hash.includes(`aoi=bbox:${synthOverview.hotspots[0].bbox.join(',')}`), 'the suggestion, hotspot 1, in the hash');
      assert.match(hash, /view=anomalies/);
      assert.deepEqual(await page.evaluate(selected), ['anomalies']);
      await settle(page);
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.panel-host.is-open'))`), false, 'no month preselected');
      await page.click('.brand');
      await page.until(firstRun, 'the brand goes home');
      assert.deepEqual(await page.evaluate(selected), ['home']);
      await settle(page);
      await page.click('[role=tab][data-view="sensors"]');
      await page.until(`!document.querySelector('.view-sensors').hidden && document.querySelector('.sensors-answer')`, 'Sensors with the first example');
      await settle(page);
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.panel-host.is-open'))`), false, 'Sensors opens with no panel');
      await page.evaluate(`document.getElementById('tab-calendar').focus()`);
      await page.press('ArrowLeft');
      assert.equal(await page.evaluate('document.activeElement.id'), 'tab-home', 'arrows reach Home');
      assert.equal(await page.evaluate(`document.documentElement.classList.contains('is-first-run')`), false, 'arrowing onto Home keeps the area');
      await page.click('#tab-home');
      await page.until(firstRun, 'Home goes home');
      assert.deepEqual(await page.evaluate(selected), ['home']);
      assert.deepEqual(page.problems, []);
    } finally { await page.close(); }
  }
});

test('Home resets everything: bare hash, panel closed, hero shown, its own history entry', { skip }, async () => {
  for (const width of [1280, 400]) {
    const page = await open(width, '', synthBase);
    const home = `document.documentElement.classList.contains('is-first-run') && document.querySelector('${EXAMPLE}') && document.getElementById('tab-home').getAttribute('aria-selected') === 'true'`;
    const openPanel = async () => {
      await page.until(CALENDAR_READY, 'calendar');
      await settle(page);
      await page.evaluate(`document.querySelector('.view-calendar .cal-cell[tabindex="0"]').focus()`);
      await page.press('Enter');
      await page.until(`document.querySelector('.panel-host.is-open')`, 'panel open');
    };
    try {
      await page.until(`document.querySelector('${EXAMPLE}')`, 'example cards');
      await settle(page);
      await page.click('#tab-calendar');
      await page.until(CALENDAR_READY, 'calendar from Home');
      await settle(page);
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.panel-host.is-open'))`), false, 'Calendar opens with no panel');
      const areaHash = await page.evaluate('location.hash');
      await openPanel();
      // The phone sheet is modal, so the Home tab under it is clicked directly.
      await page.evaluate(`document.getElementById('tab-home').click()`);
      await page.until(home, 'Home tab goes home');
      assert.equal(await page.evaluate('location.hash'), '', 'no parameters left');
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.panel-host.is-open, .sheet-open, .drawer-backdrop, :popover-open'))`), false, 'nothing left open');
      await page.evaluate('history.back()');
      await page.until(`location.hash === ${JSON.stringify(areaHash)} && !document.documentElement.classList.contains('is-first-run')`, 'Back returns to the area');
      await page.evaluate('history.forward()');
      await page.until(home, 'Forward returns home');
      assert.equal(await page.evaluate('location.hash'), '');
      await settle(page);
      await page.click(EXAMPLE);
      await openPanel();
      await page.evaluate(`document.querySelector('.brand').click()`);
      await page.until(home, 'the brand goes home');
      assert.equal(await page.evaluate('location.hash'), '');
      assert.equal(await page.evaluate(`Boolean(document.querySelector('.panel-host.is-open'))`), false, 'the brand closes the panel');
      assert.deepEqual(page.problems, []);
    } finally { await page.close(); }
  }
});

test('phone (360px): Live and Sensors tables scroll inside their card, never the page', { skip }, async () => {
  const page = await open(360, '', synthBase);
  const noPageScroll = `document.documentElement.scrollWidth <= innerWidth`;
  try {
    await page.until(`document.querySelector('${EXAMPLE}')`, 'example cards');
    await settle(page);
    await page.click('#tab-live');
    await page.until(`!document.querySelector('.view-live').hidden && document.querySelector('.live-card')`, 'Live from Home');
    assert.equal(await page.evaluate(noPageScroll), true, 'Live chart fits');
    for (const [tab, card, table] of [['live', '.live-card', '.live-table'], ['sensors', '.sensors-card', '.sensors-table']]) {
      await settle(page);
      await page.evaluate(`document.getElementById('tab-${tab}').click()`);
      await page.until(`!document.querySelector('.view-${tab}').hidden && document.querySelector('${card}')`, tab);
      await settle(page);
      // The toggle can sit under the fixed bottom bar at this height, so it is clicked directly.
      await page.evaluate(`document.querySelector('${card} .seg[aria-label="Display"] [data-id="table"]').click()`);
      await page.until(`document.querySelector('${table} .data-table')?.offsetParent != null`, `${tab} table shown`);
      assert.equal(await page.evaluate(noPageScroll), true, `${tab} table keeps the page at 360px`);
      assert.ok(await page.evaluate(`document.querySelector('${table} .data-table-scroll').scrollWidth > document.querySelector('${table} .data-table-scroll').clientWidth`), `${tab} table scrolls in its own box`);
    }
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('phone: picking an example lands at the top of the result, not scrolled past it', { skip }, async () => {
  const page = await open(400, '', synthBase);
  try {
    await page.until(`document.querySelector('${EXAMPLE}')`, 'example cards');
    await settle(page);
    // Under load the home layout can still grow after settling, so scroll until it holds.
    await page.until(`(document.querySelector('${EXAMPLE}').scrollIntoView({ block: 'center' }), scrollY > 300)`, 'the example sits below the fold');
    await page.evaluate(`document.querySelector('${EXAMPLE}').click()`);
    await page.until(CALENDAR_READY, 'calendar after an example');
    assert.equal(await page.evaluate('scrollY'), 0);
    assert.equal(await page.evaluate('document.activeElement.id'), 'main-view', 'focus moves off the removed card');
  } finally { await page.close(); }
});

test('synthetic data turns on every tab; Sensors shows R, the steps, a keyboard chart, a table and its own CSV', { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pr-sensors-'));
  const page = await browser.newPage({ width: 1280, height: 900, downloadDir: dir });
  try {
    await page.goto(`${synthBase}/web/#aoi=bbox:-58.2,-20.1,-55,-15.3&view=calendar`);
    await page.until(CALENDAR_READY, 'calendar of a box that crosses the border');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.view)`), ['home', 'calendar', 'sensors', 'anomalies', 'live']);
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[role=tab] .tab-tag')].map((t) => t.closest('[role=tab]').dataset.view)`), ['anomalies', 'live'], 'Sensors lost its preview tag at gate V1');
    assert.match(await page.evaluate(`document.querySelector('.domain-note').textContent`), new RegExp(`Part of this area lies outside ${synthOverview.region.name}, the data domain`), 'the box reaches past the border, named from overview.json');
    await page.click('#tab-sensors');
    await page.until(`!document.querySelector('.view-sensors').hidden && document.querySelector('.sensors-chart')`, 'Sensors view');
    assert.equal(await page.evaluate(`document.querySelector('[data-slot=verdict]').hidden`), true, 'the calendar verdict gives way to the answer card');
    assert.match(await page.evaluate(`document.querySelector('.context .eyebrow').textContent`), /^Sensors · two records, one series · Synthetic data$/);
    const answer = await page.evaluate(`document.querySelector('.sensors-answer').textContent`);
    assert.match(answer, /R fitted on 2012-02 to 2019-12/, 'the months R used, not core\'s nominal window');
    assert.match(await page.evaluate(`document.querySelector('.sensors-foot').textContent`), /Hollow: partial years, off the lines\./);
    assert.equal(await page.evaluate(`document.querySelectorAll('.sensors-hollow').length > 0`), true);
    assert.match(answer, /Synthetic/);
    assert.match(answer, /\d\.\d\d×VIIRS ÷ MODIS/);
    assert.match(answer, /95% interval \d\.\d\d–\d\.\d\d/);
    assert.match(answer, /K = \d\.\d\d: S-NPP ÷ NOAA-20/);
    assert.doesNotMatch(answer, /Preview/, 'gate V1 validated R and K');
    assert.equal(await page.evaluate(`document.querySelectorAll('.sensors-steps .build-step').length`), 3);
    assert.equal(await page.evaluate(`document.querySelector('.sensors-stamp').textContent`), 'SYNTHETIC DATA');
    assert.match(await page.evaluate(`document.querySelector('.sensors-chart').getAttribute('aria-label')`), /^Synthetic data\. /);
    // The chart repaints (new svg node) while the container settles: wait for one node to survive 400 ms.
    await page.evaluate(`window.__svg = null`);
    for (let i = 0; i < 40; i++) {
      const same = await page.evaluate(`(() => { const s = document.querySelector('.sensors-chart'); const ok = s === window.__svg; window.__svg = s; return ok; })()`);
      if (same) break;
      await wait(400);
    }
    await page.evaluate(`document.querySelector('.sensors-chart').focus()`);
    await page.press('Home');
    await page.until(`document.querySelector('#sensors-readout').textContent.startsWith('2000.')`, 'readout on the first year');
    await page.press('ArrowRight');
    await page.until(`document.querySelector('#sensors-readout').textContent.startsWith('2001.')`, 'arrow moves a year');
    assert.equal(await page.evaluate(`!document.querySelector('.sensors-tip').hidden`), true, 'tooltip follows the keyboard');
    await settle(page);
    await page.click('.sensors-card .seg[aria-label="Display"] [data-id="table"]');
    await page.until(`document.querySelector('.sensors-table .data-table')?.offsetParent !== null`, 'table shown');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.sensors-table thead th')].map((t) => t.textContent)`), ['Year', 'MODIS', 'S-NPP', 'NOAA-20', 'Harmonized', 'Source']);
    assert.match(await page.evaluate(`document.querySelector('.sensors-table caption').textContent`), /Synthetic data/);
    await exportAs(page, 'csv');
    for (let i = 0; i < 50 && !(await readdir(dir)).some((f) => f.endsWith('.csv')); i++) await wait(100);
    const [file] = (await readdir(dir)).filter((f) => f.endsWith('.csv'));
    assert.match(file, /^prime-radiant-sensors-/);
    const lines = (await readFile(join(dir, file), 'utf8')).split('\r\n');
    assert.match(lines[0], /^# SYNTHETIC DEMO DATA/);
    assert.ok(lines.includes('year,month,sensor,value'));
    assert.ok(lines.some((l) => /^2019,9,noaa20,\d+$/.test(l)), 'NOAA-20 is in the export');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); await rm(dir, { recursive: true, force: true }); }
});

test('synthetic Anomalies and Live: answer cards, percentile words, the anomaly Radiant, labels on every number', { skip }, async () => {
  const page = await open(1280, '', synthBase);
  try {
    await openExample(page);
    await page.click('#tab-anomalies');
    await page.until(`!document.querySelector('.view-anomalies').hidden && document.querySelector('.anomaly-answer .radiant')`, 'Anomalies view');
    assert.match(await page.evaluate(`document.querySelector('.anomaly-answer').textContent`), /Synthetic.*Preview.*\d+(st|nd|rd|th) percentile/);
    assert.equal(await page.evaluate(`document.querySelectorAll('.anomaly-answer .radiant path.rb[class*="rd-"]').length > 0 && !document.querySelector('.anomaly-answer .radiant [class*="rb-"]')`), true, 'the Radiant uses the diverging ramp');
    assert.match(await page.evaluate(`document.querySelector('.view-anomalies .cal-cell[data-row] .long')?.textContent ?? 'none'`), /^(\d+(st|nd|rd|th)|Low|High)?$/);
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.view-anomalies .legend .legend-item')].map((li) => li.textContent)`), ['Flagged as unusual', 'No rank (baseline too short)', 'No data'], 'the foot keeps only the marks');
    assert.equal(await page.evaluate(`document.querySelector('.view-anomalies .chart-stamp-html').textContent`), 'SYNTHETIC DATA');
    await settle(page);
    await page.click('.anomaly-card .seg-opt[data-id="table"]');
    await page.until(`document.querySelector('.anomaly-card .data-table')?.offsetParent !== null`, 'anomaly table');
    await page.click('#tab-live');
    await page.until(`!document.querySelector('.view-live').hidden && document.querySelector('.live-answer')`, 'Live view');
    const live = await page.evaluate(`document.querySelector('.live-answer').textContent`);
    assert.match(live, /Synthetic/);
    assert.match(live, /Provisional/);
    assert.match(live, /Fetched (just now|\d+ (min|h) ago) · \d+ [A-Z][a-z]{2}, \d\d:\d\d UTC/);
    assert.equal(await page.evaluate(`document.querySelector('.live-chart .chart-stamp').textContent`), 'SYNTHETIC DATA');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.live-tick')).fontSize`), '12px', 'axis text is not scaled');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('tab switch updates the hash, back restores the previous view, disabled views are absent', { skip }, async () => {
  const plain = await open(1280);
  try {
    await openExample(plain);
    assert.deepEqual(await plain.evaluate(`[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.view)`), ['home', 'calendar', 'sensors'], 'only enabled views get a tab, after Home');
    assert.equal(await plain.evaluate(`document.querySelector('[role=tablist]').hidden`), false, 'Home keeps the switcher');
  } finally { await plain.close(); }
  // Ranks need years of history, which the six fixture months lack.
  const page = await open(1280, '?preview=1', synthBase);
  try {
    await openExample(page);
    await page.until(`location.hash.includes('view=calendar')`, 'calendar view in hash');
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role=tab]')].map((t) => t.dataset.view)`);
    assert.deepEqual(tabs, ['home', 'calendar', 'sensors', 'anomalies', 'live'], 'preview turns on every view');
    await page.click('#tab-sensors');
    await page.until(`location.hash.includes('view=sensors')`, 'sensors in hash');
    await page.evaluate('history.back()');
    await page.until(`location.hash.includes('view=calendar') && document.querySelector('#tab-calendar').getAttribute('aria-selected') === 'true'`, 'back returns to calendar');
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('phone full map from the sheet: Leaflet stays isolated, and the Method drawer closes the map first', { skip }, async () => {
  const page = await open(400);
  try {
    await openExample(page);
    await page.click('.range-chip');
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
    // Page.navigate can return while the old document still answers, so mark it and wait for a fresh one.
    await page.evaluate(`window.__stale = true`);
    await page.goto(`${base}/web/?fixtures=1`);
    await page.until(`!window.__stale && document.readyState === 'complete' && document.querySelector('.site-footer .theme-opt')`, 'reloaded');
    assert.equal(await page.evaluate(`document.documentElement.getAttribute('data-theme')`), 'light', 'restored by the early script');
    assert.equal(await page.evaluate(`document.querySelector('.site-footer .theme-opt[data-theme-id="light"]').getAttribute('aria-checked')`), 'true');
    await pick('system');
    await page.until(`document.querySelector('.site-footer .theme-opt[data-theme-id="system"]').getAttribute('aria-checked') === 'true'`, 'system checked');
    await page.until(`!document.documentElement.hasAttribute('data-theme')`, 'system removes data-theme');
  } finally { await page.close(); }
});

test('PWA: the manifest is valid and the service worker registers and activates', { skip }, async () => {
  const page = await open(1280);
  try {
    const m = await (await fetch(`${base}/web/manifest.webmanifest`)).json();
    assert.equal(m.id, '/prime-radiant');
    await page.until(`document.querySelector('link[rel=manifest]')`, 'page loaded');
    assert.equal(await page.evaluate(`document.querySelector('link[rel=manifest]').href`), `${base}/web/manifest.webmanifest`);
    await page.until(`navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`, 'service worker activated');
    assert.equal(await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.scope)`), `${base}/web/`);
    assert.equal(await page.evaluate(`caches.keys().then((k) => k.some((n) => n.startsWith('pr-shell-')))`), true);
    assert.equal(await fetch(`${base}/web/manifest.webmanifest`).then((r) => r.headers.get('content-type')), 'application/manifest+json');
  } finally { await page.close(); }
});

const AREAS_OPEN = `document.querySelector('.area-drawer[aria-modal="true"] .hm-map')`;
const bboxHash = (b) => `aoi=bbox:${b.join(',')}`;

test('place picker from the header on Anomalies: keys and rows stage a pick, Use this area keeps the view, Escape discards', { skip }, async () => {
  const [first, second, third] = synthOverview.hotspots;
  const page = await open(1280, `?preview=1#${bboxHash(first.bbox)}&view=anomalies`, synthBase);
  try {
    await page.until(`document.querySelector('.view-anomalies:not([hidden]) .anomaly-answer .answer-big')`, 'Anomalies view');
    await settle(page);
    const btn = `document.querySelector('.areas-button')`;
    assert.equal(await page.evaluate(`${btn}.getAttribute('aria-expanded')`), 'false');
    await page.click('.areas-button');
    await page.until(AREAS_OPEN, 'the drawer opens');
    assert.equal(await page.evaluate(`${btn}.getAttribute('aria-expanded')`), 'true');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('hm-map')`), true, 'focus starts on the map');
    const region = synthOverview.region?.name;
    assert.equal(await page.evaluate(`document.querySelector('#ad-list-title').textContent`), region ? `Hottest in ${region}` : 'Hottest areas');
    assert.match(await page.evaluate(`document.querySelector('.ad-unit').textContent`), new RegExp(`^Fire-cell-days of 0\\.1° cells, summed per 1° square · VIIRS S-NPP ${synthOverview.year}`));
    assert.match(await page.evaluate(`document.querySelector('.plate-note').textContent`), /count only the part inside it\.$/);
    assert.equal(await page.evaluate(`document.querySelectorAll('.hs-row').length`), synthOverview.hotspots.length);
    const primary = `document.querySelector('.ad-primary')`;
    assert.deepEqual(await page.evaluate(`[${primary}.textContent, ${primary}.disabled, document.querySelector('.ad-hint').textContent]`), ['Use this area', true, 'Pick a square or a hotspot']);

    // Arrow keys move the focus square and Enter stages it.
    await page.press('ArrowLeft');
    await page.press('Enter');
    await page.until(`!${primary}.disabled`, 'Enter stages the focused square');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.hs-row[aria-pressed="true"]')].length`), 0, 'a plain square is not a hotspot row');

    await page.evaluate(`document.querySelectorAll('.hs-row')[1].click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.hs-row')[1].getAttribute('aria-pressed')`), 'true');
    assert.match(await page.evaluate(`document.querySelector('.ad-sel').textContent`), new RegExp(`${second.value.toLocaleString('en-US')} fire-cell-days in ${synthOverview.year}`));
    await settle(page);
    await page.click('.ad-primary');
    await page.until(`location.hash.includes(${JSON.stringify(bboxHash(second.bbox))})`, 'the area changes in the hash');
    assert.match(await page.evaluate('location.hash'), /view=anomalies/, 'the view stays');
    await page.until(`document.querySelector('.view-anomalies:not([hidden])') && !document.querySelector('.area-drawer')`, 'Anomalies again, drawer closed');
    assert.equal(await page.evaluate(`document.activeElement === ${btn} && ${btn}.getAttribute('aria-expanded') === 'false'`), true, 'focus back on Areas');

    // The pencil on the area chip opens the same drawer; Escape discards the staged pick.
    await settle(page);
    await page.click('.area-chip');
    await page.until(AREAS_OPEN, 'the pencil opens the drawer');
    await page.evaluate(`document.querySelectorAll('.hs-row')[2].click()`);
    await page.press('Escape');
    await page.until(`!document.querySelector('.area-drawer')`, 'Escape closes');
    assert.equal(await page.evaluate(`document.activeElement.classList.contains('area-chip')`), true, 'focus back on the chip');
    assert.ok((await page.evaluate('location.hash')).includes(bboxHash(second.bbox)), 'nothing committed');
    assert.ok(!(await page.evaluate('location.hash')).includes(bboxHash(third.bbox)));

    // Draw or enter coordinates hands over to the area form.
    await settle(page);
    await page.click('.areas-button');
    await page.until(AREAS_OPEN, 'open again');
    await page.evaluate(`document.querySelector('.ad-manual').click()`);
    await page.until(`!document.querySelector('.area-drawer') && document.querySelector('.query-bar').classList.contains('sheet-open')`, 'the area form opens');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('first run suggests hotspot 1 without writing the hash; Open calendar from Home; tabs open the last chosen area', { skip }, async () => {
  const [first, second] = synthOverview.hotspots;
  for (const width of [1280, 400]) {
    const page = await open(width, '', synthBase);
    try {
      await page.until(`document.querySelector('.hero-art figcaption')`, 'the suggested Radiant');
      const region = synthOverview.region?.name;
      assert.equal(await page.evaluate(`document.querySelector('.hero-art figcaption').textContent`), `Suggested: the 1° area with most VIIRS fire-cell-days in ${region ?? 'the data'}, ${synthOverview.year}. Rings are years, slices are months. Synthetic data.`);
      assert.equal(await page.evaluate('location.hash'), '', 'a suggestion is not written to the hash');
      assert.equal(await page.evaluate(`document.querySelectorAll('${EXAMPLE}').length`), 3, 'the top three hotspots are the examples');
      assert.equal(await page.evaluate(`document.querySelector('${EXAMPLE} .ex-v').textContent`), `${first.value.toLocaleString('en-US')} VIIRS fire-cell-days in ${synthOverview.year}`);
      assert.match(await page.evaluate(`document.querySelector('${EXAMPLE} .ex-c').textContent`), /^\d+°[NS]–\d+°[NS] · \d+°[EW]–\d+°[EW]$/, 'the coordinate line is the range only');
      await settle(page);
      await page.click('.areas-button');
      await page.until(AREAS_OPEN, 'drawer from Home');
      assert.equal(await page.evaluate(`document.querySelector('.ad-primary').textContent`), 'Open calendar');
      await page.evaluate(`document.querySelectorAll('.hs-row')[1].click()`);
      await page.evaluate(`document.querySelector('.ad-primary').click()`);
      await page.until(`${CALENDAR_READY} && location.hash.includes(${JSON.stringify(bboxHash(second.bbox))})`, 'the calendar of the pick');
      await page.evaluate(`document.getElementById('tab-home').click()`);
      await page.until(`document.documentElement.classList.contains('is-first-run')`, 'home');
      await settle(page);
      await page.evaluate(`document.getElementById('tab-sensors').click()`);
      await page.until(`!document.querySelector('.view-sensors').hidden`, 'Sensors');
      assert.ok((await page.evaluate('location.hash')).includes(bboxHash(second.bbox)), 'the last chosen area, not the suggestion');
      assert.deepEqual(page.problems, []);
    } finally { await page.close(); }
  }
});

test('a shared link wins over the suggestion, and is the area the tabs reopen after Home', { skip }, async () => {
  const shared = [-50, -12, -48, -10];
  const page = await open(1280, `#${bboxHash(shared)}&view=calendar`, synthBase);
  try {
    await page.until(CALENDAR_READY, 'the linked calendar');
    assert.equal(await page.evaluate(`document.querySelector('.context h1').textContent`), 'Custom area');
    assert.ok((await page.evaluate('location.hash')).includes(bboxHash(shared)));
    await page.evaluate(`document.getElementById('tab-home').click()`);
    await page.until(`document.documentElement.classList.contains('is-first-run')`, 'home');
    await settle(page);
    await page.evaluate(`document.getElementById('tab-calendar').click()`);
    await page.until(CALENDAR_READY, 'calendar again');
    assert.ok((await page.evaluate('location.hash')).includes(bboxHash(shared)), 'the linked area, not hotspot 1');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});

test('without overview.json the picker offers the manual path, quietly', { skip }, async () => {
  const page = await open(1280);
  try {
    await page.until(`document.querySelector('${EXAMPLE}')`, 'fixture example');
    assert.equal(await page.evaluate(`document.querySelector('.hero-art figcaption')?.textContent.startsWith('Suggested') ?? false`), false, 'no suggestion');
    await settle(page);
    await page.click('.areas-button');
    await page.until(`document.querySelector('.area-drawer .ad-empty')`, 'unavailable state');
    assert.equal(await page.evaluate(`document.querySelector('.ad-empty p').textContent`), "The hotspot map isn't available right now. You can still choose an area yourself.");
    assert.equal(await page.evaluate(`document.activeElement.id`), 'area-title');
    await page.evaluate(`[...document.querySelectorAll('.ad-empty .btn')].find((b) => b.textContent === 'Enter coordinates').click()`);
    await page.until(`document.activeElement.id === 'aoi-south'`, 'the coordinates form, South focused');
    await page.press('Escape');
    await page.until(`document.activeElement.classList.contains('areas-button')`, 'focus back on Areas');
    assert.deepEqual(page.problems, []);
  } finally { await page.close(); }
});
