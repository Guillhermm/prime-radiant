import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const rule = config.headers.find((h) => h.source === '/(.*)');
const header = (name) => rule?.headers.find((h) => h.key === name)?.value;
const csp = () => Object.fromEntries(
  header('Content-Security-Policy').split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]),
);

test('serves the repo root as static output with no build, / redirects to /web/', () => {
  assert.equal(config.outputDirectory, '.');
  assert.deepEqual(config.redirects, [{ source: '/', destination: '/web/', permanent: false }]);
  assert.equal(config.buildCommand, null);
  assert.equal(config.framework, null);
});

test('a catch-all rule applies the security headers', () => {
  assert.ok(rule, 'rule for /(.*) exists');
  for (const h of rule.headers) assert.ok(h.key && h.value, `non-empty header ${h.key}`);
});

test('CSP defaults to self, forbids framing and plugins', () => {
  const d = csp();
  assert.deepEqual(d['default-src'], ["'self'"]);
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'self'"]);
});

test('CSP allows no inline or eval script and no wildcard source', () => {
  const d = csp();
  assert.deepEqual(d['script-src'], ["'self'"]);
  for (const sources of Object.values(d)) {
    assert.ok(!sources.includes("'unsafe-inline'") && !sources.includes("'unsafe-eval'") && !sources.includes('*'));
  }
});

test('CSP img-src and connect-src hold only the documented hosts', () => {
  const d = csp();
  assert.deepEqual(d['img-src'], ["'self'", 'data:', 'https://tile.openstreetmap.org']);
  assert.deepEqual(d['connect-src'], ["'self'"]);
});

test('HSTS lasts at least one year', () => {
  const age = Number(/max-age=(\d+)/.exec(header('Strict-Transport-Security'))?.[1]);
  assert.ok(age >= 31536000);
});

test('X-Content-Type-Options is nosniff', () => {
  assert.equal(header('X-Content-Type-Options'), 'nosniff');
});

test('Referrer-Policy still sends the origin cross-site (OSM tile policy needs a Referer)', () => {
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('Permissions-Policy disables camera, microphone and geolocation', () => {
  const v = header('Permissions-Policy');
  for (const f of ['camera', 'microphone', 'geolocation']) assert.match(v, new RegExp(`${f}=\\(\\)`));
});

test('CSP allows the manifest and the service worker from self only', () => {
  const d = csp();
  assert.deepEqual(d['manifest-src'], ["'self'"]);
  assert.deepEqual(d['worker-src'], ["'self'"]);
});

test('cross-origin isolation and legacy framing headers are set', () => {
  assert.equal(header('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(header('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(header('X-Frame-Options'), 'DENY');
});

test('Permissions-Policy also disables motion sensors and FLoC', () => {
  for (const f of ['payment', 'usb', 'accelerometer', 'gyroscope', 'magnetometer', 'interest-cohort']) assert.match(header('Permissions-Policy'), new RegExp(`${f}=\\(\\)`));
});

test('the service worker needs no Service-Worker-Allowed: it lives at /web/sw.js, the scope it controls', () => {
  assert.equal(header('Service-Worker-Allowed'), undefined);
  assert.ok(readFileSync(new URL('../../web/sw.js', import.meta.url), 'utf8').length > 0);
});

test('.vercelignore deploys only web/, core/, api/ and data/', () => {
  const lines = readFileSync(new URL('../../.vercelignore', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.equal(lines[0], '/*', 'ignore everything first');
  assert.deepEqual(lines.filter((l) => l.startsWith('!')).sort(), ['!/api', '!/core', '!/data', '!/vercel.json', '!/web']);
  assert.ok(lines.includes('*.test.js'), 'test files are not deployed');
});
