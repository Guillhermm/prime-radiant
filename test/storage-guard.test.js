import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Reading window.localStorage or sessionStorage throws when site data is blocked. As a default
// parameter the read happens before any try, so it must only ever be looked up inside one.
test('no default parameter reads localStorage or sessionStorage', async () => {
  const root = new URL('../web/src/', import.meta.url).pathname;
  const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const hits = [];
  for (const f of files) {
    const src = await readFile(join(root, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/=\s*(globalThis\.|window\.)?(localStorage|sessionStorage)\b(?!\s*\?\?)/.test(line) && /[(,{]\s*\w+\s*=\s*(globalThis\.|window\.)?(local|session)Storage/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
