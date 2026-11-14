import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};

// Mirrors what Vercel serves as static files: the top-level entries .vercelignore re-includes with "!/name",
// the headers rule and the redirects from vercel.json. `extra` adds dev-only folders (fixtures).
export const loadSite = async (root, { extra = [] } = {}) => {
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  const ignore = await readFile(join(root, '.vercelignore'), 'utf8');
  // api/ deploys as functions, not files: serving its source here would differ from Vercel.
  const allowed = [...ignore.matchAll(/^!\/([^/\s]+)\s*$/gm)].map((m) => m[1]).filter((d) => d !== 'api').concat(extra);
  const headers = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  return { root: resolve(root), allowed, headers, redirects: config.redirects ?? [] };
};

export const createStaticServer = (site) => createServer(async (req, res) => {
  const send = (status, extraHeaders = {}, body) => { res.writeHead(status, { ...site.headers, ...extraHeaders }); res.end(body); };
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(400);
  }
  const redirect = site.redirects.find((r) => r.source === path);
  if (redirect) return send(redirect.permanent ? 308 : 307, { location: redirect.destination });
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(site.root, path));
  const top = file.slice(site.root.length + 1).split(sep)[0];
  if (!file.startsWith(site.root + sep) || !site.allowed.includes(top) || file.endsWith('.test.js')) return send(404);
  try {
    return send(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }, await readFile(file));
  } catch {
    return send(404);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = createStaticServer(await loadSite(root, { extra: ['fixtures'] }));
  server.listen(8433, '127.0.0.1', () => console.log('http://127.0.0.1:8433/'));
}
