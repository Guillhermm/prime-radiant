# Deploy

Status: research notes for M0-G3. Decision H5 (where tiles live) is open until the M0-K4 size spike reports.
"Checked" means read on the linked page on 2026-11-14. "Not checked" means no source confirmed it.

## Static site and headers (M0-K6)

`vercel.json` serves `web/` with no build step and sets the headers on every path. `test/integration/headers.test.js` asserts them.

| Header | Value | Note |
|---|---|---|
| Content-Security-Policy | `default-src 'self'` plus `img-src` tiles, `connect-src 'self'`, `frame-ancestors 'none'` | See placeholders below |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | Drop `preload` if the domain is not meant for the preload list |
| X-Content-Type-Options | `nosniff` | |
| Referrer-Policy | `strict-origin-when-cross-origin` | Must not be stricter: OSM requires the Referer |
| Permissions-Policy | camera, microphone, geolocation, payment, usb disabled | |

CSP placeholders to change when decided:
- `img-src`: `https://*.tile.openstreetmap.org` stands in for the basemap tile host (M0-G4). Replace it if the basemap changes.
- `connect-src`: `'self'` only. If H5 picks R2, add the bucket origin (its `r2.dev` or custom domain host). Tiles are fetched with `fetch`, so `connect-src` is the directive, not `img-src`.
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
