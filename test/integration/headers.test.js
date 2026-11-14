import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const rule = config.headers.find((h) => h.source === '/(.*)');
const header = (name) => rule?.headers.find((h) => h.key === name)?.value;
const csp = () => Object.fromEntries(
  header('Content-Security-Policy').split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]),
);

test('serves web/ as static output with no build', () => {
  assert.equal(config.outputDirectory, 'web');
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
