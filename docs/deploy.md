# Deploy

"Checked" means read on the linked page or observed on 2026-11-14. "Not checked" means no source confirmed it.

## Production

- URL: https://primeradiant.zenus.systems (custom domain set by the team in the Vercel project). Hosting: Vercel Hobby, Git integration.
- Redeploy: push to `main` (the humans push); Vercel builds and promotes. Previews come from other branches. Nothing in this repo deploys by itself.
- Build: none (`buildCommand: null`, no install step, no dependencies). The deploy uploads `web/`, `core/` and `api/`.
- Data: `/data/*` is rewritten to the R2 bucket (see "Data hosting (H5)"), so production shows real FIRMS data once the first publish has run. Until then `/data/manifest.json` has nothing behind it and the app shows its load error. The synthetic generator (`npm run mock`) is for local use only; a synthetic manifest still turns on the "Synthetic demo data" band.
- To check in the Vercel dashboard once (not checked): Project, Settings, Build and Deployment, Build Command is not set to `node tools/mock-data.mjs` by hand. `vercel.json` overrides it, but what `null` does there is not documented.
- Live proxy `/api/live`: deployed with the site. `MAP_KEY` is not set on production, and the web app does not call the proxy yet (the Live tab runs on placeholder data): without it the function answers 503 `live proxy is not configured`. To enable: Vercel dashboard, Project, Settings, Environment Variables, add `MAP_KEY` (FIRMS map key) for Production, then redeploy (a variable change does not apply to existing deployments). Never put the key in the repo or in a `NEXT_PUBLIC`-style variable.

### Security pass, 2026-11-14

Made when production still built synthetic data with the site; the data rows below describe that setup.

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

`vercel.json` serves the repo root (`outputDirectory: "."`), because the app imports `../../core/`. There is no build step. `.vercelignore` is an allowlist (`/*`, then `!/web`, `!/core`, `!/api`, `!/vercel.json`, then `*.test.js`), so `raw/`, `data/`, `pipeline/`, `tools/`, `fixtures/`, `test/`, `docs/` and the test files are not uploaded. `data/` must stay out: Vercel gives the filesystem precedence over rewrites, so a deployed `data/` would shadow the R2 rewrite. `api/` is re-included so its functions deploy; `tools/serve.mjs` does not serve it (no local function runtime). `tools/serve.mjs` serves the local `data/` where `vercel.json` rewrites `/data/` to R2, so local runs and the end-to-end tests keep using local files. A redirect sends `/` to `/web/` (a rewrite would keep the URL at `/` and break the page's relative `src/` and `styles/` links). The headers apply to every path. `test/integration/headers.test.js` asserts the config; `tools/serve.mjs` mirrors it (allowlist, redirect, headers) for `npm run serve` (127.0.0.1:8433) and the end-to-end tests. Consequence: `?fixtures=1` works locally only, not on the deployed site.

Checked on production before the R2 switch: `.vercelignore` re-inclusion works (the 404 list is in the Security pass).

| Header | Value | Note |
|---|---|---|
| Content-Security-Policy | `default-src 'self'` plus `img-src` tiles, `connect-src 'self'`, `frame-ancestors 'none'` | See placeholders below |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | Drop `preload` if the domain is not meant for the preload list |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | Must not be stricter: OSM requires the Referer |
| Permissions-Policy | camera, microphone, geolocation, payment, usb disabled | |

CSP placeholders to change when decided:
- `img-src`: `https://tile.openstreetmap.org` is the OpenStreetMap tile host (M0-G4, used by the map picker). The bare host is needed because tiles are requested without a subdomain; replace it if the basemap changes.
- `connect-src`: `'self'` only. Tiles come from R2 through the same-origin `/data/` rewrite, so the bucket host is not listed.
- `font-src 'self'`: Fira Sans and Fira Code are self-hosted in `web/fonts/` (source and checksums in `docs/ux.md` 5.6); no font CDN is contacted.
- `style-src 'self'`: Leaflet sets styles through `element.style`, which CSP allows; if the app injects `<style>` or `style=""` attributes, this must be revisited.

Checked: vercel.json shape (`$schema`, `headers[].source`, `headers[].headers[]` key/value, `outputDirectory` string or null, `framework: null` for "Other") against https://vercel.com/docs/project-configuration/vercel-json (page last updated per docs index 2026-08-25 on https://vercel.com/docs/project-configuration).
Headers were observed with `curl -I` on production on 2026-11-14 (see Security pass), before the R2 switch.

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

Decision H5: Cloudflare R2, decided by the humans on 2026-11-15. See "Data hosting (H5)".

## Data hosting (H5)

Status: live. `pipeline/publish.js` and the publish workflow are unit tested with a stubbed `fetch`. The first publish ran by hand on 2026-11-15 (`20261115`, 36 files verified); the workflow has not run yet, it is manual and the data has not changed since.

- Bucket `prime-radiant-data`, Standard storage, location ENAM. CORS allows GET and HEAD from `https://primeradiant.zenus.systems` and `http://127.0.0.1:8433` (not needed by the rewrite, kept for direct use). A lifecycle rule aborts incomplete multipart uploads after 1 day.
- Custom domain `https://data.primeradiantdata.com` on its own Cloudflare zone. Certificate active since 2026-11-15.
- Layout: `v/{dataVersion}/manifest.json`, `v/{dataVersion}/domain.json`, `v/{dataVersion}/tiles/0.1/*.json`, `v/{dataVersion}/tiles/1/*.json`, `v/{dataVersion}/overview.json` (from the first publish that includes it), all `Cache-Control: public, max-age=31536000, immutable`; the root `manifest.json` (`public, max-age=300`) is a copy of the live version's manifest. Its `base_url` is `data/v/{dataVersion}/`, resolved by `web/src/data-source.js` against the site root, so it stays relative.
- Serving: `vercel.json` rewrites `/data/:path*` to `https://data.primeradiantdata.com/:path*`. The app keeps fetching same-origin `/data/`, so CSP, CORS and the service worker (which caches only same-origin `data/`) are unchanged. Chosen over a direct fetch with `connect-src https://data.primeradiantdata.com` for that reason: a direct fetch would also lose offline tiles. Its cost: tile bytes count against Vercel's Fast Data Transfer (100 GB a month on Hobby, [limits](https://vercel.com/docs/limits)) instead of R2's free egress, and a proxied request times out after 30 s. If traffic ever nears the cap, switch to the direct fetch.
- Checked on [Rewrites](https://vercel.com/docs/routing/rewrites): external rewrites forward to an outside origin, and Vercel honors upstream `cache-control` on them by default for projects created on or after 2026-04-06 (older projects need `x-vercel-enable-rewrite-caching`; this project's creation date is not checked). The page names no plan restriction. Checked on [vercel.json](https://vercel.com/docs/project-configuration/vercel-json): "precedence is given to the filesystem prior to rewrites being applied". Not checked: a Hobby-specific statement on external rewrites (none found either way).
- Publish: `node pipeline/publish.js --in <build dir>` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in the environment. It validates every file with `core/schema.js` (any error aborts before the first request), uploads to `v/{dataVersion}/`, lists the prefix back and aborts if a key is missing, then writes the root manifest, then deletes every `v/*` version except the new one and the previous live one. Re-publishing a version overwrites the same keys; give changed data a new `dataVersion`, because the old files are cached as immutable. `--dry-run` validates and lists the keys without credentials or requests. Logs carry keys and counts only.
- Workflow `.github/workflows/publish-data.yml` (manual, `workflow_dispatch`): downloads the 48 FIRMS country files with `tools/fetch-country.mjs` (about 3 GB), builds with `pipeline/build.js --domain pipeline/domain/brazil.geojson --admin1 pipeline/domain/brazil-admin1.geojson`, runs `node --test`, publishes. Actions are pinned to commit SHAs; one run at a time, never cancelled midway.
- Secrets: the four `R2_*` values live only in GitHub Actions repository secrets and in a local, gitignored `.env` for a manual publish (`.env.example` lists the names; run `node --env-file=.env pipeline/publish.js --in <build dir>`). The S3 keys are an R2 API token with Object Read and Write on this bucket only. `.env` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for bucket administration; neither is used by the publish.
- Compression (found 2026-11-15): Cloudflare compresses the bucket's JSON with zstd for clients that accept it, and the Vercel cache for the `/data/` rewrite does not vary on `Accept-Encoding`. Once a zstd copy is cached, every client gets it, including the ones that cannot decode it (Safari through 18.7 on iOS, per [caniuse](https://caniuse.com/zstd)). Seen on the root `manifest.json`: `content-encoding: zstd` returned to a request that accepted only gzip. Fixed the same day: a Cloudflare compression rule (zone phase `http_response_compression`) on `data.primeradiantdata.com` allows gzip only, so every copy Vercel caches is one all browsers decode. Checked after the change: the root manifest, `domain.json` and all 34 tiles answer gzip through `/data/` from the São Paulo edge; other Vercel regions not checked, a redeploy drops any zstd copy left there. The admin token needs Zone, Response Compression, Edit for this rule.
- Roll back: `node pipeline/publish.js --rollback <dataVersion>` copies `v/{dataVersion}/manifest.json` to the root. Only the previous version is kept, so that is the one to roll back to. Browsers and Vercel see the change within the root manifest's 5 minutes.

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
- CSV formula injection: `core/csv.js` prefixes every text field starting with `= + - @` (tab, CR) with an apostrophe; numbers stay numeric. The web export calls core's `toCsv` and adds nothing but the synthetic first line.
- Not checked: COOP/CORP effects on the OSM tile images (CORP governs responses we serve, not tiles we load; checked only that the local suite stays green).
