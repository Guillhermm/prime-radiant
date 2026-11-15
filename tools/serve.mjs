import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};

// Mirrors what Vercel serves as static files: the top-level entries .vercelignore re-includes with "!/name",
// the headers rule, the redirects and the internal rewrites from vercel.json (redirects first, then files,
// then rewrites, as on Vercel). `extra` adds dev-only folders (fixtures).
// A folder vercel.json rewrites to an external origin (/data/ to the R2 bucket) is served from the
// local folder of that name instead, so local runs use the local data/.
// The subset of Vercel's path syntax vercel.json uses: literals, :name, :name* and :name(regex).
const compileRoute = (source) => {
  const names = [];
  let re = '';
  for (const [, name, mod, literal] of source.matchAll(/:(\w+)(\([^)]*\)|\*)?|([^:]+)/g)) {
    if (literal) { re += literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    names.push(name);
    re += mod === '*' ? '(.*)' : mod ?? '([^/]+)';
  }
  return { re: new RegExp(`^${re}$`), names };
};

const route = (rules, path) => {
  for (const rule of rules) {
    const m = rule.compiled.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(rule.compiled.names.map((n, i) => [n, m[i + 1]]));
    return { rule, destination: rule.destination.replace(/:(\w+)\*?/g, (_, n) => params[n] ?? '') };
  }
  return null;
};

export const loadSite = async (root, { extra = [] } = {}) => {
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  const ignore = await readFile(join(root, '.vercelignore'), 'utf8');
  // api/ deploys as functions, not files: serving its source here would differ from Vercel.
  const rewritten = (config.rewrites ?? []).filter((r) => /^https:\/\//.test(r.destination)).map((r) => /^\/([^/]+)\/:path\*$/.exec(r.source)?.[1]).filter(Boolean);
  const allowed = [...ignore.matchAll(/^!\/([^/\s]+)\s*$/gm)].map((m) => m[1]).filter((d) => d !== 'api').concat(rewritten, extra);
  const headers = Object.fromEntries(config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  const compile = (r) => ({ ...r, compiled: compileRoute(r.source) });
  const rewrites = (config.rewrites ?? []).filter((r) => r.destination.startsWith('/')).map(compile);
  return { root: resolve(root), allowed, headers, redirects: (config.redirects ?? []).map(compile), rewrites };
};

export const createStaticServer = (site) => createServer(async (req, res) => {
  const send = (status, extraHeaders = {}, body) => { res.writeHead(status, { ...site.headers, ...extraHeaders }); res.end(body); };
  const url = new URL(req.url, 'http://x');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return send(400);
  }
  const redirect = route(site.redirects, path);
  if (redirect) return send(redirect.rule.permanent ? 308 : 307, { location: redirect.destination + url.search });
  const read = async (p) => {
    const file = resolve(join(site.root, p.endsWith('/') ? `${p}index.html` : p));
    const top = file.slice(site.root.length + 1).split(sep)[0];
    if (!file.startsWith(site.root + sep) || !site.allowed.includes(top) || file.endsWith('.test.js')) return null;
    try {
      return { type: TYPES[extname(file)] ?? 'application/octet-stream', body: await readFile(file) };
    } catch {
      return null;
    }
  };
  const hit = (await read(path)) ?? (await (async () => { const rw = route(site.rewrites, path); return rw && read(rw.destination); })());
  if (!hit) return send(404);
  return send(200, { 'content-type': hit.type }, hit.body);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = createStaticServer(await loadSite(root, { extra: ['fixtures'] }));
  server.listen(8433, '127.0.0.1', () => console.log('http://127.0.0.1:8433/'));
}
