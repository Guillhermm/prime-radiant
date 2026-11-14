# Deploy

Status: research notes for M0-G3. Decision H5 (where tiles live) is open until the M0-K4 size spike reports.
"Checked" means read on the linked page on 2026-11-14. "Not checked" means no source confirmed it.

## Static site and headers (M0-K6)

`vercel.json` serves the repo root (`outputDirectory: "."`, no build step), because the app imports `../../core/`. `.vercelignore` is an allowlist (`/*`, then `!/web`, `!/core`, `!/data`, `!/api`, `!/vercel.json`, then `*.test.js`), so `raw/`, `pipeline/`, `fixtures/`, `test/`, `docs/` and the test files are not uploaded. `api/` is re-included so its functions deploy; `tools/serve.mjs` does not serve it (no local function runtime). A redirect sends `/` to `/web/` (a rewrite would keep the URL at `/` and break the page's relative `src/` and `styles/` links). The headers apply to every path. `test/integration/headers.test.js` asserts the config; `tools/serve.mjs` mirrors it (allowlist, redirect, headers) for `npm run serve` (127.0.0.1:8433) and the end-to-end tests. Consequence: `?fixtures=1` works locally only, not on the deployed site.

Not checked: that `.vercelignore` re-inclusion of directories behaves as the gitignore syntax implies on a real `vercel deploy`; confirm on the first preview via the deployment's file list.

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
Not checked: that `buildCommand: null` and `installCommand: null` skip the build on a real deploy (the docs give no static example; confirm on the first preview deploy). Headers were not yet observed with `curl -I` (no deployment exists).

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

`api/live.js` is a Vercel Node function (`GET /api/live?bbox=w,s,e,n&days=1|2`) that queries the FIRMS area API for the live view. It is optional: the daily Action path needs no key. Status: built and unit tested with a stubbed `fetch`; not deployed yet.

- Env var: `MAP_KEY` (the FIRMS map key). It is read only from the function environment and never reaches the repository, the client, logs or responses.
- Set it later: Vercel dashboard, Project, Settings, Environment Variables, add `MAP_KEY` for Production (and Preview if wanted), then redeploy. Without it the function answers 503 and the app shows "Live unavailable".
- The bbox is snapped outward to 0.5 degrees and capped at 2,500 square degrees (operational cap, adjust in `MAX_AREA_DEG2`). Responses carry `Cache-Control: s-maxage=900, stale-while-revalidate=3600`.
- Not verified: a WAF rate-limit rule on Hobby; the FIRMS CSV column names `latitude`, `longitude`, `acq_date` (the area page does not list them; check against a real response with a key).

## PWA, service worker and extra headers (round 2)

Status: built, tested locally with headless Chrome; not deployed. Production origin will be `https://primeradiant.zenus.systems`; all paths are relative, so localhost works unchanged.

- Manifest `web/manifest.webmanifest`: `id` `/prime-radiant` (resolved against the origin, stable and unique to this app), `start_url` and `scope` `./` (the `/web/` folder), standalone, colors from `tokens.css`. Icons reuse `favicon.svg` (`sizes: any`) as a placeholder; installability in some browsers needs 192 and 512 px PNGs, not yet produced (planned, with the designer's icon).
- Service worker `web/sw.js` (module worker, scope `/web/`, so no `Service-Worker-Allowed` header). Pure logic in `web/src/sw-lib.js`: the shell is precached (`SHELL_FILES`, including `core/`, fonts and Leaflet) and served from cache while refreshed in the background; `data/` and `fixtures/` are network-first with a cache fallback; `api/` is network-only and never stored; other origins (OSM tiles) are left to the browser. Old `pr-*` caches are deleted on activate. A new worker waits; the page shows "A new version is ready" and reloads after the user accepts. Bump `CACHE_VERSION` whenever a shell file changes; a unit test fails if a runtime file is missing from `SHELL_FILES`.
- Headers added: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY` (legacy of `frame-ancestors 'none'`), `manifest-src 'self'`, `worker-src 'self'`, more `Permissions-Policy` features. `api/live.js` sets its own security headers on every response because it is not verified that the `vercel.json` rule reaches functions.
- CSV formula injection: `guardCsv` in `web/src/components/export-menu.js` prefixes every field (and header value) starting with `= + - @` (tab, CR) with an apostrophe before download, bare numbers excepted. Temporary: remove it once `core/csv.js` guards its own output (core is not edited from the web track).
- Not checked: headers on a real deployment (`curl -I`), COOP/CORP effects on the OSM tile images (CORP governs responses we serve, not tiles we load; checked only that the local suite stays green).
