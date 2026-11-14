# Deploy

"Checked" means read on the linked page or observed on 2026-11-14. "Not checked" means no source confirmed it.

## Production

- URL: https://primeradiant.zenus.systems (custom domain set by the team in the Vercel project). Hosting: Vercel Hobby, Git integration.
- Redeploy: push to `main` (the humans push); Vercel builds and promotes. Previews come from other branches. Nothing in this repo deploys by itself.
- Build: `node tools/mock-data.mjs` (no install step, no dependencies). It writes the synthetic `data/` (gitignored) so the deployed site always has tiles.
- What is synthetic: everything under `data/` on production, including the manifest (`dataVersion` starts with `synthetic-`). The app shows a "Synthetic demo data" band and tab title prefix. The science in `core/` is still stubbed, so numbers are placeholders either way. What is real: the app, the headers, the PWA, the optional live proxy code.
- Going real (planned, H5 open): when the pipeline publishes real tiles, either drop the build command and ship the tiles with the site, or point `manifest.base_url` at a bucket (R2) and add its origin to `connect-src`. The synthetic band disappears only when the manifest stops being synthetic.
- Live proxy `/api/live`: deployed with the site. `MAP_KEY` is not set on production, and the web app does not call the proxy yet (the Live tab, behind `?preview=1`, runs on placeholder data): without it the function answers 503 `live proxy is not configured`. To enable: Vercel dashboard, Project, Settings, Environment Variables, add `MAP_KEY` (FIRMS map key) for Production, then redeploy (a variable change does not apply to existing deployments). Never put the key in the repo or in a `NEXT_PUBLIC`-style variable.

### Security pass, 2026-11-14

Scanned (read-only requests against production, headless Chrome, repo grep):
- Headers: on `/web/`, a JS file and `/data/manifest.json` every header in the table below is present exactly as in `vercel.json`. `/api/live` carries its own set (`default-src 'none'`, `no-store`, `Referrer-Policy: no-referrer`) plus HSTS, nosniff, COOP, CORP, X-Frame-Options.
- `/api/live`: no `bbox` gives 400, a valid `bbox` without a key gives 503 `{"error":"live proxy is not configured"}`, HEAD gives 405. No response names an upstream URL or key.
- 404 on `/tools/` (and `serve.mjs`), `/test/`, `/pipeline/`, `/raw/`, `/fixtures/`, `/docs/`, `/package.json`, `*.test.js`, `/.vercelignore`, `/.git/config`, `/.env`, `/README.md`.
- 200, expected and harmless: `/tools/mock-data.mjs` (uploaded on purpose so the build can run; synthetic generator, no secrets), `/vercel.json` (the header config, public anyway), `/api/live.js` (the function source is also served as a static file because `outputDirectory` is `.`; it reads the key only from the environment, no secret in it).
- Headless Chrome at 1440 and 400 px, `/` and `/web/?preview=1#live`, service worker active: 0 CSP violations, 0 console errors, 0 exceptions. Not exercised: the map picker (OSM tiles), because it does not render in that flow.
- Secrets: grep of the repo (`key`, `secret`, `token`, `password`, `MAP_KEY`, 32-hex strings, private-key headers) found only `MAP_KEY` names in docs and tests with a fake test key; none of the fetched JS files match; no `.env*`, `.pem` or `.key` file is tracked.
- `npm audit` does not apply: `package.json` has no dependencies and there is no lockfile, so there is nothing to audit. Fira fonts are vendored files, Leaflet is vendored; their versions are not tracked by an advisory scanner (not checked).
- `access-control-allow-origin: *` appears on static responses (not on `/api/live`). It is not in `vercel.json`, so it comes from the Vercel platform; its default for static files was observed, not read in the docs. It only lets other origins read public files with `fetch`; the files are already public and carry no credentials, so it is left as is. `Cross-Origin-Resource-Policy: same-origin` still stops other sites embedding them as no-cors subresources.

Not checked: Hobby WAF rate limits; whether a real FIRMS key works with the proxy; HSTS preload submission (the header has `preload`, the domain is not submitted).

## Static site and headers (M0-K6)

`vercel.json` serves the repo root (`outputDirectory: "."`), because the app imports `../../core/`. Its build step is `node tools/mock-data.mjs`: until the real pipeline publishes tiles, every deploy generates the synthetic `data/` (gitignored, so a Git deploy has none otherwise) and the app shows the synthetic banner. `.vercelignore` is an allowlist (`/*`, then `!/web`, `!/core`, `!/data`, `!/api`, `!/vercel.json`, `tools/mock-data.mjs` only, then `*.test.js`), so `raw/`, `pipeline/`, `fixtures/`, `test/`, `docs/` and the test files are not uploaded. `api/` is re-included so its functions deploy; `tools/serve.mjs` does not serve it (no local function runtime). A redirect sends `/` to `/web/` (a rewrite would keep the URL at `/` and break the page's relative `src/` and `styles/` links). The headers apply to every path. `test/integration/headers.test.js` asserts the config; `tools/serve.mjs` mirrors it (allowlist, redirect, headers) for `npm run serve` (127.0.0.1:8433) and the end-to-end tests. Consequence: `?fixtures=1` works locally only, not on the deployed site.

Checked on production: `.vercelignore` re-inclusion works (`/web`, `/core`, `/api`, `/data`, `tools/mock-data.mjs` are served; the 404 list is in the Security pass).

| Header | Value | Note |
|---|---|---|
| Content-Security-Policy | `default-src 'self'` plus `img-src` tiles, `connect-src 'self'`, `frame-ancestors 'none'` | See placeholders below |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | Drop `preload` if the domain is not meant for the preload list |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | Must not be stricter: OSM requires the Referer |
| Permissions-Policy | camera, microphone, geolocation, payment, usb disabled | |

CSP placeholders to change when decided:
- `img-src`: `https://tile.openstreetmap.org` is the OpenStreetMap tile host (M0-G4, used by the map picker). The bare host is needed because tiles are requested without a subdomain; replace it if the basemap changes.
- `connect-src`: `'self'` only. If H5 picks R2, add the bucket origin (its `r2.dev` or custom domain host). Tiles are fetched with `fetch`, so `connect-src` is the directive, not `img-src`.
- `font-src 'self'`: Fira Sans and Fira Code are self-hosted in `web/fonts/` (source and checksums in `docs/ux.md` 5.6); no font CDN is contacted.
- `style-src 'self'`: Leaflet sets styles through `element.style`, which CSP allows; if the app injects `<style>` or `style=""` attributes, this must be revisited.

Checked: vercel.json shape (`$schema`, `headers[].source`, `headers[].headers[]` key/value, `outputDirectory` string or null, `framework: null` for "Other") against https://vercel.com/docs/project-configuration/vercel-json (page last updated per docs index 2026-08-25 on https://vercel.com/docs/project-configuration).
Production now runs `node tools/mock-data.mjs` as the build command and `installCommand: null`, and deploys. Headers were observed with `curl -I` on production on 2026-11-14 (see Security pass).

## H5 research

Vercel Hobby limits ([limits](https://vercel.com/docs/limits), last updated 2026-09-16):
- Checked: CLI static file uploads, max source size 100 MB on Hobby (1 GB Pro). Over the limit the deployment fails.
- Checked: max 15,000 source files per CLI deployment; more requires `vercel deploy --archive=tgz`.
- Checked: no upper limit on build output files, but 100,000+ slow builds (45 minute build cap).
- Conflict, not resolved: the changelog "[CLI deployment limits removed](https://vercel.com/changelog/cli-deployment-limits-removed)" says CLI-specific limits were removed without listing which, while the limits page still shows 100 MB. Treat 100 MB as binding until a test deploy proves otherwise.
- Not checked: Hobby bandwidth and per-file size caps for static output.

Ignore handling for `vercel deploy`:
- Checked: `.vercelignore` is honored ([doc](https://vercel.com/docs/deployments/vercel-ignore)); `/*` plus `!` entries gives an allowlist.
- Checked: [build-features](https://vercel.com/docs/builds/build-features) lists `.gitignore` itself among files never uploaded. That is the file being skipped, not proof its patterns are applied.
- Not checked: whether the CLI applies `.gitignore` patterns. No doc says so. Safe path: create `.vercelignore` explicitly, and note `data/` (gitignored tiles) must be uploaded, so an ignore file that excludes it would break option (a). Do not rely on `.gitignore` either way; verify with `vercel deploy` on a preview and the file list in the deployment's `/_src`.

Cloudflare R2 ([pricing](https://developers.cloudflare.com/r2/pricing/)):
- Checked: free per month: 10 GB-month Standard storage, 1 million Class A ops, 10 million Class B ops (reads such as GetObject), egress free. Infrequent Access storage is not free.
- Checked: CORS via dashboard bucket Settings or `npx wrangler r2 bucket cors set <bucket> --file cors.json` ([doc](https://developers.cloudflare.com/r2/buckets/cors/)). Wrangler format: `{"rules":[{"allowed":{"origins":["https://app.example"],"methods":["GET"]}}]}`. Custom domains return CORS headers automatically once a policy exists; browsers must send an `Origin` header.
- Not checked: CORS on the public `r2.dev` URL (the page does not mention it; whether `r2.dev` is rate limited was also not read).

Decision H5: open. Compare M0-K4 total brotli size and file count against 100 MB / 15,000 files; over either, R2 (10 GB free) is the path.

## Live proxy

`api/live.js` is a Vercel Node function (`GET /api/live?bbox=w,s,e,n&days=1|2`) that queries the FIRMS area API for the live view. It is optional: the daily Action path needs no key. Status: built, unit tested with a stubbed `fetch`, deployed without `MAP_KEY` (answers 503).

- Env var: `MAP_KEY` (the FIRMS map key). It is read only from the function environment and never reaches the repository, the client, logs or responses.
- Set it later: Vercel dashboard, Project, Settings, Environment Variables, add `MAP_KEY` for Production (and Preview if wanted), then redeploy. Without it the function answers 503. The web app does not call the proxy yet (planned), so nothing on screen depends on it.
- The bbox is snapped outward to 0.5 degrees and capped at 2,500 square degrees (operational cap, adjust in `MAX_AREA_DEG2`). Responses carry `Cache-Control: s-maxage=900, stale-while-revalidate=3600`.
- Not verified: a WAF rate-limit rule on Hobby; the FIRMS CSV column names `latitude`, `longitude`, `acq_date` (the area page does not list them; check against a real response with a key).

## PWA, service worker and extra headers (round 2)

Status: built, tested locally and observed on production (service worker active, no console errors). Production origin is `https://primeradiant.zenus.systems`; all paths are relative, so localhost works unchanged.

- Manifest `web/manifest.webmanifest`: `id` `/prime-radiant` (resolved against the origin, stable and unique to this app), `start_url` and `scope` `./` (the `/web/` folder), standalone, colors from `tokens.css`. Icons: `icons/mark.svg` (the flame on transparency, also the favicon) plus PNGs 192, 512, 512 maskable and `apple-touch-icon.png` in `web/icons/`, generated by `node tools/icons.mjs` (headless Chrome).
- Service worker `web/sw.js` (module worker, scope `/web/`, so no `Service-Worker-Allowed` header). Pure logic in `web/src/sw-lib.js`: the shell is precached (`SHELL_FILES`, including `core/`, fonts and Leaflet) and served from cache while refreshed in the background; `data/` and `fixtures/` are network-first with a cache fallback; `api/` is network-only and never stored; other origins (OSM tiles) are left to the browser. Old `pr-*` caches are deleted on activate. A new worker waits; the page shows "A new version is ready" and reloads after the user accepts. Bump `CACHE_VERSION` whenever a shell file changes; a unit test fails if a runtime file is missing from `SHELL_FILES`.
- Headers added: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY` (legacy of `frame-ancestors 'none'`), `manifest-src 'self'`, `worker-src 'self'`, more `Permissions-Policy` features. `api/live.js` sets its own security headers on every response because it is not verified that the `vercel.json` rule reaches functions.
- CSV formula injection: `guardCsv` in `web/src/components/export-menu.js` prefixes every field (and header value) starting with `= + - @` (tab, CR) with an apostrophe before download, bare numbers excepted. Temporary: remove it once `core/csv.js` guards its own output (core is not edited from the web track).
- Not checked: COOP/CORP effects on the OSM tile images (CORP governs responses we serve, not tiles we load; checked only that the local suite stays green).
