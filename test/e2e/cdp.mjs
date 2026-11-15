import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

// An explicit CHROME_PATH wins even when it does not exist, so the e2e skip path can be exercised.
export const findChrome = () => {
  const explicit = process.env.CHROME_PATH;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
};

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts headless Chrome and returns { newPage, close }. Offline: nothing here touches the network. */
export const launch = async (chromePath) => {
  const dir = await mkdtemp(join(tmpdir(), 'pr-e2e-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--disable-gpu', 'about:blank'];
  if (process.env.CI) args.push('--no-sandbox');
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools URL in 15 s')), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chrome exited early (${code})`)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`)); else resolve(msg.result);
    } else listeners.forEach((l) => l(msg));
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

  const newPage = async ({ width, height = 900, downloadDir }) => {
    if (downloadDir) await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (m, p) => send(m, p, sessionId);
    const problems = [];
    const downloads = [];
    const onEvent = (msg) => {
      if (msg.sessionId !== sessionId && !msg.method.startsWith('Browser.')) return;
      const p = msg.params;
      if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') problems.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (msg.method === 'Log.entryAdded' && p.entry.level === 'error') problems.push(`log.error: ${p.entry.text} ${p.entry.url ?? ''}`);
      if (msg.method === 'Browser.downloadProgress' && p.state === 'completed') downloads.push(p.guid);
    };
    listeners.add(onEvent);
    await Promise.all(['Runtime', 'Log', 'Page'].map((d) => cmd(`${d}.enable`)));
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });

    const evaluate = async (expr) => {
      const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    const until = async (expr, what, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await evaluate(expr)) return;
        await wait(50);
      }
      throw new Error(`timeout waiting for: ${what}`);
    };
    const click = async (sel) => {
      const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const at = () => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }; return new Promise((done) => { let last = at(); let still = 0; let n = 0; const tick = () => { const now = at(); still = now[0] === last[0] && now[1] === last[1] ? still + 1 : 0; last = now; if (still >= 3 || ++n > 120) done(now); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }); })()`);
      if (!box) throw new Error(`missing element: ${sel}`);
      for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 });
    };
    const keys = { Escape: 27, Enter: 13, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
    const press = async (key) => {
      for (const type of ['keyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: keys[key] });
    };
    return {
      problems, downloads, evaluate, until, click, press,
      transparent: () => cmd('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }),
      // Headless Chrome enforces a minimum window size, so clip to the page size asked for.
      screenshot: async () => Buffer.from((await cmd('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } })).data, 'base64'),
      goto: (url) => cmd('Page.navigate', { url }),
      moveMouse: (x, y) => cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
      // Chrome fires offline and online and fails every request while this is on.
      setOffline: async (offline) => {
        await cmd('Network.enable');
        // Emulation does not reach the service worker's own fetches, so they are bypassed while offline.
        await cmd('Network.setBypassServiceWorker', { bypass: offline });
        await cmd('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      },
      // Runs before any page script on every navigation (feature removal, device emulation).
      addInitScript: (source) => cmd('Page.addScriptToEvaluateOnNewDocument', { source }),
      emulateDevice: async ({ userAgent, platform, maxTouchPoints = 0 }) => {
        await cmd('Emulation.setUserAgentOverride', { userAgent, platform });
        if (maxTouchPoints) await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints });
      },
      close: async () => { listeners.delete(onEvent); await send('Target.closeTarget', { targetId }); },
    };
  };

  const close = async () => {
    ws.close();
    proc.kill();
    await new Promise((r) => (proc.exitCode === null ? proc.once('exit', r) : r()));
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  };
  return { newPage, close };
};
