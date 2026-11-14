# UX spec

Status: D0 passed with conditions (M0-G5, see section 10). Tokens: `web/styles/tokens.css`. Audience: emergency managers who must read an area's fire history in seconds, often on a phone in the field. Contract names (QueryState, VIEWS, CalendarCell, caveat ids) come from `docs/roadmap.md`.

## 1. Flow

1. First screen: the Query bar (area, dates, layer) over an empty state with example-area chips. Nothing else competes.
2. Pick an area (form first, map optional) and press Apply (both widths; see open items on auto-apply).
3. The Calendar tab fills: KPI strip (current month vs median), then the year x month grid. Caveats are visible the whole time.
4. Tap or focus a cell to see its value, source and caveats. Export gives the CSV of what is on screen.
5. Everything on screen is encoded in the URL hash (`#aoi=bbox:w,s,e,n&from=&to=&view=&layer=`), so a view can be shared by link.

## 2. Information architecture

| Element | Role | Present from |
|---|---|---|
| Top bar | Product name, tabs, Method button, Export menu | M1 |
| Tabs: Calendar \| Sensors \| Anomalies \| Live | One `VIEWS` entry each. Disabled views are not rendered (no greyed tab). Calendar and Sensors ship in M1 (slots A and B); Anomalies is slot C (M2); Live is slot D (M3). The Anomalies tab holds the vs-median grid and the flagged-periods list; the Calendar's Layer switch shows the same grid in place (one `layer` state, one component) | M1 |
| Query bar | Area (lat/lon fields, presets, map), date range, layer (Counts \| vs median once C exists) | M1 |
| Caveat strip | Persistent, not dismissible, one line plus "Read more" opening the Method drawer. Shows "Preliminary" while the science gate flag is set | M1 |
| Main view | Output of the active tab | M1 |
| Cell detail | Desktop: side panel. Phone: bottom sheet | M1 |
| Method drawer | Right drawer (desktop), full-height sheet (phone). Focus trapped, Escape closes, focus returns to the trigger | M1 |
| Export menu | CSV of aggregates (H12), dated filename, plus "Copy link" | M1 |

Slots C and D are drawn in every wireframe below as dashed boxes so the layout does not move when they ship.

## 3. Wireframes

### 3.1 Desktop, 1440 wide, Calendar tab

```
+----------------------------------------------------------------------------------+
| Prime Radiant   [Calendar] [Sensors] [Anomalies*] [Live*]      [Method] [Export v]|
+----------------------------------------------------------------------------------+
| Area  S [-20.1] W [-58.2] N [-15.3] E [-55.0]  [Presets v] [Map v]               |
| From [2000-11] To [2026-10]  [All][10 y][This year]     Layer (o)Counts ( )*vs med|
+----------------------------------------------------------------------------------+
| ! Hotspot counts, not burned area. MODIS to VIIRS values are estimated.  Read more|
|   Preliminary                                                                    |
+----------------------------------------------------------------------------------+
| [ Oct 2026 vs median ] [ Total in range ] [ Sensor era ]   [ Table view ]        |
|   1,204  (+38%)           58,210            MODIS+VIIRS                          |
|   median of 22 yrs                                                               |
+---------------------------------------------------------------+------------------+
|      Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec          | Cell detail      |
| 2026 [] [] [] [] [] [] [] [] [] [] .. ..                      | Sep 2020         |
| 2025 [] [] [] [] [] [] [] [] [] [] [] []                      | 12,450 fire-     |
| 2024 ...                                                      | cell-days        |
| ...                                                           | Observed, MODIS  |
| 2000 ... (hatched until MODIS starts 2000-11)                 | Median 3,100 (n=|
|                                                               | 22 yrs)          |
| Legend: [0][1-3][4-15][16-63][64-255][256-1023][1024+]  ///no data  Color = density |
+---------------------------------------------------------------+------------------+
* Anomalies (slot C, M2) and Live (slot D, M3) appear only when enabled in VIEWS. Until core delivers them, `?preview=1` enables both with placeholder numbers from `web/src/preview-stubs.js`, labeled on screen as not validated; the flagged-periods list is planned, not built.
  C adds the "vs median" layer, a flag marker on cells and a flagged-periods list under the grid.
  D adds a live season line over a historical band, and a provisional overlay on the current month.
```

### 3.2 Phone, 400 wide, Calendar tab

```
+------------------------------+
| Prime Radiant     [Method][Ex]|
| View [ Calendar          v ]  |   native select (tabs would overflow once C and D exist)
+------------------------------+
| Area: -20.1,-58.2 to -15.3,   |
| -55.0 (2.3 deg2)   [Change]   |   Change opens the Area sheet (fields, presets, map full screen)
| 2000-11 to 2026-10 [Change]   |
+------------------------------+
| ! Counts, not area. Estimated |
|   values marked. Preliminary  |
|   Read more                   |
+------------------------------+
| < Oct 2026 vs median       > |   KPI cards, swipe or arrows
|   1,204   +38%   n=22 yrs     |
+------------------------------+
|     J F M A M J J A S O N D   |   1.6rem cells, year column sticky
| 26  . . . . . . . . . . - -   |
| 25  . . . . . . . . . . . .   |
| ... grid scrolls vertically   |
+------------------------------+
| Legend [0][1-3][4-15][16-63]  |   wraps in two rows
| [64-255][256-1023][1024+] //  |
| [Table view]                  |
+------------------------------+
| (cell tap -> bottom sheet)    |
+------------------------------+
Slots C and D: Anomalies and Live are further options in the View select, plus a Layer switch
under the KPI cards when C is enabled.
```

### 3.3 Area sheet (phone) and map

Fields first (lat/lon, presets), the map in a "Draw on map" section that opens full screen with Done and Cancel. The form is always a complete path; the map is an accelerator. Map base: see section 8.

## 4. Components

| Component | Behavior | Notes |
|---|---|---|
| Tabs | `role="tablist"`, arrow keys move, Enter/Space activate, hash updates, Back works | Desktop only; select on phone |
| Query bar | Plain form; inline validation message per field via `aria-describedby`; Apply disabled while invalid (phone shows an explicit Apply) | Area cap message states the limit and the nearest valid size |
| KPI strip | Current month vs median with n years; "not enough history" instead of 0 when null | Swipe cards on phone, with prev/next buttons |
| Calendar grid | `role="grid"`, roving tabindex, arrows/Home/End/PageUp/PageDown, Enter opens detail, Escape closes. Cell label: "September 2020, 12,450 fire-cell-days, density 38 per 1,000 cells, observed, MODIS" | Sticky year column on desktop. Number inside the cell only if it fits (it will not at 1.6rem on phone, and rarely at 2rem; abbreviate as 12k or enlarge the desktop cell, see open items). Color is always paired with the number on hover, focus and tap |
| Cell marks | Estimated: triangle in the top-right corner. Partial month: dotted bottom edge. Flag (C): filled dot top-left plus a heavy inset frame. All use the cell's own text token, so contrast equals the text pair | Marks never rely on color |
| Legend | Seven classes plus no-data hatch plus the density unit sentence (5.1); for C, the diverging ramp with the center labeled "median" | Always visible next to the grid |
| Table view | Same data as an accessible table, toggled from the grid; this is the text alternative of the chart | Years as rows, months as columns, scoped headers |
| Sensor chart (B) | Three lines: MODIS, VIIRS, harmonized, with different dash patterns and direct labels, era lines at 2012-01-20 and 2026-11-02, per-series toggles, data table alternative | Series tokens `--series-*` |
| Caveat strip | Non-dismissible | Text from `core/caveats.js` |
| Method drawer | Method text, citation, version, R and level | Focus trap |
| Cell detail | Value, status, source sensor, R if estimated, median and years used, relevant caveats; opened from the anomaly layer, also percentile rank and flag | Focus returns to the cell on close |
| Export menu | "CSV (aggregates)", "Copy link" | Output equals `core.toCsv` |
| Live (D) | "Provisional" badge, `fetched_at`, never added to harmonized totals; Table view toggle as the text alternative (one row per period, live value next to median and quartiles) | Badge tokens; live line `--series-live` (Okabe-Ito vermillion #D55E00, both themes), band and median `--series-era-line` |

## 5. Color

### 5.1 Density: viridis, 7 classes

Unit: fire-cell-days per 1,000 grid cells in the AOI (density). Absolute counts saturate: a large AOI puts every month in the top class (the mockup median of 3,100 already sits in 1024+), and a small AOI never leaves the bottom. Density makes the same classes mean the same thing across AOI sizes, on fixed edges (no per-AOI quantiles, which would hide that one area burns more than another). The raw count stays in the cell label, hover, focus and detail panel, in the table view and in the CSV; the legend names the unit: "Color: fire-cell-days per 1,000 grid cells (density). Number: raw fire-cell-days."

Zero is its own lowest class, labeled "0", only when the raw count is 0, so a quiet area reads as quiet rather than as missing; a positive density below 1 goes to class 1. Positive densities use six log (base 4) classes. Viridis is perceptually ordered and survives the common color vision deficiencies; it is never mixed with a rainbow.

| Class | Range | Token | Light hex | Dark hex |
|---|---|---|---|---|
| 0 | 0 (raw count 0) | `--bin-0` | #440154 | #46307e |
| 1 | 1-3 | `--bin-1` | #443983 | #375b8d |
| 2 | 4-15 | `--bin-2` | #31688e | #277f8e |
| 3 | 16-63 | `--bin-3` | #21918c | #1fa188 |
| 4 | 64-255 | `--bin-4` | #35b779 | #4ac16d |
| 5 | 256-1023 | `--bin-5` | #90d743 | #a0da39 |
| 6 | 1024+ | `--bin-6` | #fde725 | #fde725 |

The dark column is viridis resampled from 0.14 to 1.0: the original class 0 (#440154) is 1.18:1 against the dark panel and disappears. Lightness stays strictly increasing in both themes (asserted in `tools/contrast.test.js`).

The class edges and the density denominator (grid cells in the AOI, fine or coarse level) are a display proposal from the mathematician's review; the Second Foundation validates the unit and any threshold before they ship (`second-foundation:validate`). Viridis hex values are the standard 7-step samples; the stops are not hand-tuned.

### 5.2 No data

Sensor not operating (`null`) is a gray diagonal hatch (`--nodata-hatch`), never a class color and never "0". Its text label is "No data". The hatch is also the only pattern in the grid, so it cannot be confused with the "partial" or "estimated" marks.

### 5.3 Anomaly vs median: PuOr 11 (slot C)

Dark theme: the light-centered PuOr becomes a glare slab on a dark ground, so the dark ramp is lightness-reversed. The median is a dark neutral (`#2b3048`) and cells get lighter as they depart from it: orange above (`#7a3d12 #b35806 #e08214 #fdb863 #fee6a8`, steps 1 to 5), violet below (`#4b3f9e #6e63c0 #9a8fe0 #c4bdf0 #e6e2fa`). The legend says dark gray is the median. The light theme keeps ColorBrewer PuOr 11 untouched, described next.

Diverging, centered on the historical median: the center class (#f7f7f7) means "equal to the median". Orange to brown is above the median (more fire), purple is below. Five steps each side. Legend text: "Center = historical median of the same month in earlier complete years. Darker orange: more than the median. Darker purple: less." Flags are a marker, not a color. Classing (percentile or ratio) is decided by the Second Foundation at gate V2, so the 11 classes are tokens only for now.

### 5.4 Sensor series: Okabe-Ito

MODIS `#0072B2` (light) or `#56B4E9` (dark), VIIRS `#B36B00` (light, darkened from Okabe-Ito orange #E69F00 which gives 2.2:1 on white) or `#E69F00` (dark), harmonized black or white and thicker. VIIRS is also dashed, and every line has a direct label, so color is never the only cue.

### 5.5 Themes

Dark is the default (a deep navy ground with a soft blue glow and a faint CSS star field). Light follows `prefers-color-scheme: light`, and `data-theme="light|dark"` on the root overrides the system either way. Both palettes are token sets in `web/styles/tokens.css`; components only use tokens. The top bar has its own `--topbar-*` tokens (transparent in dark, solid navy in light) and its buttons and focus ring are scoped to the bar, so light-theme white text never reaches the detail panel or other buttons.

Palette direction (checked on spaceappschallenge.org on 2026-11-14): deep navy `#151622`, electric blue `#2491ff` for selection and links, one yellow `#e7f434` primary button in dark (blue `#0050d8` in light), orange `#ff7a33` or `#b83c00` for warn. No logo and no "NASA" wordmark are used.

Viridis keeps its hue order in both themes (dark values in 5.1). The 1px `--cell-edge` is `rgb(255 255 255 / 0.14)` in dark (1.52:1 against the panel) and `#6b7490` in light (4.64:1). Known partial miss of WCAG 1.4.11 in dark: classes 0 and 1 are 1.7:1 and 2.6:1 against the panel and the edge is faint, so the fill is not a stand-alone carrier; the count printed in every desktop cell, the readout and aria-label, the table and the CSV carry the value.

The estimated-value corner mark is 0.375rem at 55% opacity (0.25rem on phone). When 60% or more of the cells with data are estimated (`mostlyEstimated` in `calendar-grid.js`) the per-cell marks are hidden and the legend says "All values in this range are estimated." instead; marks return when estimated cells are the minority. On phone the calendar fits the card without scrolling (12 columns about 1.5rem wide at a 400px viewport, full year labels at 0.625rem).

### 5.6 Type

Fira Sans (text) and Fira Code (numbers in inputs, stat values, year labels), the faces the Space Apps site uses, self-hosted from `web/fonts/` (SIL Open Font License, texts in `web/fonts/OFL-*.txt`). Weights used: Fira Sans 400, 500, 600, 700 and Fira Code 400, 500, Latin subset, `font-display: swap`, with the system stack as fallback (`--font-sans`, `--font-mono`). No request leaves the origin, so `font-src 'self'` in `vercel.json` is unchanged.

Source: `@fontsource/fira-sans@5.3.0` and `@fontsource/fira-code@5.3.0` from the npm registry (https://registry.npmjs.org/@fontsource/fira-sans/-/fira-sans-5.3.0.tgz, https://registry.npmjs.org/@fontsource/fira-code/-/fira-code-5.3.0.tgz), fetched 2026-11-14. Tarball sha256: fira-sans `2231966721c4c3f70194c336dd11428e15139bd902cac415528715028c9cd5a9`, fira-code `06b1a0a074e0115e36abc6f25c9698a62ea0b061598049d26896e754d3ca2ec6`. Each also matches the registry's `dist.integrity` (sha512) and `dist.shasum` (sha1), checked.

| File | sha256 |
|---|---|
| `fira-sans-latin-400-normal.woff2` | `3e38d8c01fe97529fbf0a086bf958d724b723ca7fc8be77b4ba5745f6259b6ca` |
| `fira-sans-latin-500-normal.woff2` | `88d3e420adee3fa99ae50c15b123e3c9a07ce0ec0c03a01bd6bdd5232822da28` |
| `fira-sans-latin-600-normal.woff2` | `55e09735e30d8492afac5d59ac433c6b367bb7dd00c46e157cfe95c9fb29e833` |
| `fira-sans-latin-700-normal.woff2` | `c753d7153cac2cfeb877264d18f11197ca672d3e04ba1472154a54777a4e354d` |
| `fira-code-latin-400-normal.woff2` | `6dc9da171ccea71d525379ee1cbf51d143e31acac330a251bb71b3d6060e687c` |
| `fira-code-latin-500-normal.woff2` | `9e4da5ad2c147be02544df5a732d22830a82b1e9800dc06267ba656f5c40f7e9` |
| `OFL-fira-sans.txt` | `18aabf190848725e2576eefb5c29ba06aac1029d02132252a7f312eac2e50cf3` |
| `OFL-fira-code.txt` | `126cd7bf732b86f42885f1fbf682e6aeea456672c7fdb99f2d557ec44e468a28` |

D0 judgment, revised for the dark redesign: acceptable in light (the 1px edge is 4.64:1, so 1.4.11 is met by the edge) and a documented partial miss in dark for classes 0 and 1 (see above). The fill is information carried also by the number (hover, focus, tap, table, CSV). Conditions: the edge is never removed, and the number must be reachable without hover (focus and tap), which the phone cells (no inline number) depend on.

## 6. States

| State | Where | What the user sees |
|---|---|---|
| Empty (no area) | Main view | One sentence "Choose an area to see its fire history", example-area chips (demo presets), "Enter coordinates" focus link. No empty grid |
| Zero detections | Grid, KPI, chart | Grid shows class 0 cells; KPI reads "0 fire-cell-days in range", and a line says "No hotspots detected, sensors were operating". Never confused with no data |
| No data | Cells before MODIS (2000-11) or outside coverage | Hatch plus "No data" in label |
| Loading | Grid and KPI | Skeleton with `aria-busy="true"` and a polite status "Loading tiles"; Query bar stays usable; no spinner-only state |
| Error | Main view | Inline message: what failed, what to do, Retry button; the Query bar keeps its values. `role="alert"` once |
| Live unavailable (D) | Live tab and overlay | "Live data unavailable. Last update <fetched_at>" (older than 48 h counts as unavailable); the calendar keeps working; no fake zeros |
| Not enough history | KPI | "Not enough history for a median" instead of a number |
| Area too large | Query bar | Message with the cap and a suggested size; Apply disabled |
| Preliminary | Caveat strip | "Preliminary" label until the science gate passes |

## 7. Accessibility checklist (WCAG 2.2 AA)

- [ ] All controls reachable and operable by keyboard; the map can be skipped (skip link "Skip map"), the form is a complete path (2.1.1, 2.1.2)
- [ ] Focus visible: 2px `--color-focus` outline with a 2px offset and a halo (yellow in dark, blue in light, yellow in the light top bar), on every control and cell; the only exception is headings and panels that receive focus programmatically (`tabindex="-1"` on `h1`, `h2`, `main`, dialogs), which show none (2.4.7, 2.4.11 focus not obscured: sticky header and bottom sheet never cover the focused cell; `scroll-margin` set)
- [ ] Target size at least 24 x 24 CSS px; calendar cells 1.625rem tall and about 1.5rem (24 px) wide at a 400px viewport, narrower below that, other controls `--target-min` 2.75rem (2.5.8)
- [ ] Contrast: text 4.5:1, large text and UI components 3:1 (table in section 9); data fills documented as info with outline and number as the carrier (1.4.3, 1.4.11)
- [ ] Color never the only cue: numbers in labels and hover/focus, dash patterns, corner marks, hatch (1.4.1)
- [ ] Text alternatives: table view of the grid, data table of the sensor chart, CSV export (1.1.1)
- [ ] Grid: `role="grid"`, `aria-label` per cell with month, year, value, status, estimated; roving tabindex (4.1.2)
- [ ] Tabs, drawer and sheets: roles, `aria-selected`, `aria-expanded`, focus trap and restore, Escape closes (4.1.2, 2.1.2)
- [ ] Errors identified in text, tied to fields with `aria-describedby`; status messages in a live region (3.3.1, 4.1.3)
- [ ] No drag-only path: map rectangle has the form alternative (2.5.7)
- [ ] Reflow at 400 px wide and 320 px, no horizontal page scroll (the grid scrolls inside its own container only if needed), text resizes to 200% (1.4.4, 1.4.10)
- [ ] `prefers-reduced-motion` and `prefers-color-scheme` honored; no auto-moving content (2.3.3 spirit, 2.2.2)
- [ ] Language set on `<html>`; page title changes per view; one `h1` (3.1.1, 2.4.2)
- [ ] Consistent placement of Method and Export across views (3.2.6 consistent help)
- [ ] Hover or focus content (cell tooltip) is dismissible with Escape, hoverable and persistent; tap and focus open the same detail (1.4.13)
- [ ] Text spacing overrides and 200% zoom lose no content in cell detail, drawer or Query bar (1.4.12)
- [ ] Orientation not locked; visible control labels match their accessible names (1.3.4, 2.5.3)
- [ ] Changing a field never moves focus or reloads the view without Apply (3.2.2); a skip link to the main view precedes the Query bar (2.4.1)
- [ ] Entered area and dates are kept across view changes and in the URL (3.3.7). No login, so 3.3.8 does not apply
- [ ] DOM built with `textContent`; no `innerHTML`
- [ ] Verified in the running app at 1440 and 400 wide at gates D1 to D3, with a screen reader pass on the grid and the drawer

## 8. Map base

Decision H8 (M0-G4, checked 2026-11-14): vendored Leaflet 1.9.4, the current stable release (2.0.0 is still a beta, so it is not used). GitHub lists no published security advisories for it; `npm audit` was not run because it is vendored, not installed. Basemap: OpenStreetMap standard tiles. Their usage policy requires visible attribution and forbids a restrictive Referrer-Policy (the site sends `strict-origin-when-cross-origin`), bulk or pre-seeded downloads and offline use. Service is best effort with no SLA (service-level agreement), so the zero-dependency SVG Natural Earth outline stays as the fallback basemap. The spec does not depend on it: the map is optional, collapsible on desktop, full screen from the Area sheet on phone, with the attribution shown and a form that covers every function.

Vendored copy (M1-G3): `web/vendor/leaflet/` holds `leaflet.js`, `leaflet.css`, `LICENSE` and `images/layers*.png` from the official npm tarball.

- Source: https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz
- Tarball sha256: `84c65a256e50657896f54c33bd857b6849ebe94c817803be818bf32a3dde0b77`. It also matches the registry's `dist.shasum` (sha1 `23fae724e282fa25745aff82ca4d394748db7d8d`) and `dist.integrity` (sha512 `nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==`), both checked on 2026-11-14.
- Vendored files, sha256: `leaflet.js` `db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a`, `leaflet.css` `a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6`, `LICENSE` `53e8dc25862014e4324741ca18fbe3611e11d42ef69f59f86ea8c5389647d4cb`, `images/layers.png` `1dbbe9d028e292f36fcba8f8b3a28d5e8932754fc2215b9ac69e4cdecf5107c6`, `images/layers-2x.png` `066daca850d8ffbef007af00b06eac0015728dee279c51f3cb6c716df7c42edf`.
- Tiles come from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with the attribution control on. The CSP `img-src` therefore lists the bare host (a `*.tile` wildcard does not match it). Leaflet needs no CSP change for scripts or styles: it is served from `'self'` and sets styles through the DOM, not inline attributes in markup. Checked in headless Chrome with the `vercel.json` CSP: no violations.
- The picker draws with two clicks on opposite corners (no Leaflet.draw). A skip link and the collapse button let keyboard users bypass it.

## 9. Contrast results

Computed by `tools/contrast.mjs`, which parses `web/styles/tokens.css` (dark is the bare `:root` block, light is `:root[data-theme="light"]`), applies the WCAG 2.x relative luminance formula (sRGB, 0.2126 / 0.7152 / 0.0722) and the ratio (L1 + 0.05) / (L2 + 0.05) to every required pair in both themes, and prints the tables below (`node tools/contrast.mjs`). `tools/contrast.test.js` asserts every required pair, so a token change that breaks one fails `node --test`. Ramp separation uses CIELAB DeltaE 1976 on Machado 2009 simulations (severity 1.0) of protanopia, deuteranopia and tritanopia; the floor asserted is 10 between neighbors. Table generated on 2026-11-14.

Summary: every required pair passes in both themes. Rows marked "information only" are not required by WCAG 2.2 (a data fill next to its own label and outline is not a stand-alone graphical object); they are listed so the weak ones are known. In dark, classes 0 and 1 against the panel (1.7:1 and 2.6:1) and the faint cell edge (1.52:1) are the known partial miss described in 5.5; in light, the yellow end of viridis (1.26:1) and the PuOr center rely on the `#6b7490` edge (4.64:1) and the number. Cell text on each class uses the better of dark and white, chosen per class (`--bin-N-text`, `--div-*-text`). The dark `cell-edge` is composited over the panel color before measuring; `topbar-bg` is transparent in dark and measured over `color-bg`.

| Pair (foreground on background) | Use | Min | Dark | Light |
|---|---|---|---|---|
| `color-text` on `color-bg` | body text on page | 4.5:1 | 16.35 pass | 16.6 pass |
| `color-text` on `color-surface` | text on panels | 4.5:1 | 15.17 pass | 17.95 pass |
| `color-text` on `color-surface-2` | text in inputs | 4.5:1 | 13.53 pass | 15.88 pass |
| `color-text-muted` on `color-surface` | secondary text on panels | 4.5:1 | 8 pass | 8.38 pass |
| `color-text-muted` on `color-bg` | secondary text on page | 4.5:1 | 8.62 pass | 7.75 pass |
| `color-text-muted` on `color-surface-2` | secondary text on inputs | 4.5:1 | 7.13 pass | 7.41 pass |
| `color-accent` on `color-surface` | links on panels | 4.5:1 | 5.62 pass | 6.69 pass |
| `color-accent` on `color-bg` | links on page | 4.5:1 | 6.05 pass | 6.19 pass |
| `color-accent-text` on `color-accent` | selected control text | 4.5:1 | 6.05 pass | 6.69 pass |
| `color-cta-text` on `color-cta` | primary button text | 4.5:1 | 16.02 pass | 6.69 pass |
| `color-focus` on `color-surface` | focus ring on panels | 3:1 | 14.86 pass | 6.69 pass |
| `color-focus` on `color-bg` | focus ring on page | 3:1 | 16.02 pass | 6.19 pass |
| `topbar-focus` on `topbar-bg` | focus ring in the top bar | 3:1 | 16.02 pass | 14.86 pass |
| `topbar-text` on `topbar-bg` | top bar text | 4.5:1 | 16.35 pass | 17.95 pass |
| `topbar-muted` on `topbar-bg` | top bar inactive tabs | 4.5:1 | 8.62 pass | 10.21 pass |
| `topbar-border` on `topbar-bg` | top bar button borders | 3:1 | 3.3 pass | 3.87 pass |
| `color-border-strong` on `color-surface` | control borders on panels | 3:1 | 3.06 pass | 4.64 pass |
| `color-border-strong` on `color-bg` | control borders on page | 3:1 | 3.3 pass | 4.29 pass |
| `color-warn` on `color-surface` | delta and flagged text | 4.5:1 | 6.91 pass | 5.7 pass |
| `color-error` on `color-surface` | error text | 4.5:1 | 6.41 pass | 7.75 pass |
| `color-error` on `color-error-bg` | error text on error box | 4.5:1 | 6.19 pass | 6.79 pass |
| `color-caveat-text` on `color-caveat-bg` | caveat strip text | 4.5:1 | 13.09 pass | 11.69 pass |
| `color-caveat-border` on `color-bg` | caveat strip edge | 3:1 | 7.45 pass | 5.27 pass |
| `color-badge-text` on `color-badge-bg` | preliminary badge | 4.5:1 | 16.35 pass | 17.95 pass |
| `bin-0-text` on `bin-0` | cell text, bin-0 | 4.5:1 | 10.58 pass | 15.24 pass |
| `bin-1-text` on `bin-1` | cell text, bin-1 | 4.5:1 | 6.9 pass | 9.73 pass |
| `bin-2-text` on `bin-2` | cell text, bin-2 | 4.5:1 | 4.65 pass | 6 pass |
| `bin-3-text` on `bin-3` | cell text, bin-3 | 4.5:1 | 6.05 pass | 5.49 pass |
| `bin-4-text` on `bin-4` | cell text, bin-4 | 4.5:1 | 8.49 pass | 8.2 pass |
| `bin-5-text` on `bin-5` | cell text, bin-5 | 4.5:1 | 11.68 pass | 11.99 pass |
| `bin-6-text` on `bin-6` | cell text, bin-6 | 4.5:1 | 15.45 pass | 16.63 pass |
| `div-below-5-text` on `div-below-5` | cell text, div-below-5 | 4.5:1 | 15.44 pass | 17.31 pass |
| `div-below-4-text` on `div-below-4` | cell text, div-below-4 | 4.5:1 | 11.04 pass | 10.38 pass |
| `div-below-3-text` on `div-below-3` | cell text, div-below-3 | 4.5:1 | 6.85 pass | 4.97 pass |
| `div-below-2-text` on `div-below-2` | cell text, div-below-2 | 4.5:1 | 4.99 pass | 9.65 pass |
| `div-below-1-text` on `div-below-1` | cell text, div-below-1 | 4.5:1 | 8.39 pass | 15.15 pass |
| `div-center-text` on `div-center` | cell text, div-center | 4.5:1 | 12.97 pass | 19.6 pass |
| `div-above-1-text` on `div-above-1` | cell text, div-above-1 | 4.5:1 | 8.39 pass | 16.55 pass |
| `div-above-2-text` on `div-above-2` | cell text, div-above-2 | 4.5:1 | 4.87 pass | 12.21 pass |
| `div-above-3-text` on `div-above-3` | cell text, div-above-3 | 4.5:1 | 6.85 pass | 7.37 pass |
| `div-above-4-text` on `div-above-4` | cell text, div-above-4 | 4.5:1 | 11.34 pass | 4.87 pass |
| `div-above-5-text` on `div-above-5` | cell text, div-above-5 | 4.5:1 | 15.88 pass | 8.3 pass |
| `nodata-text` on `nodata-bg` | no-data cell text | 4.5:1 | 7.13 pass | 14.64 pass |
| `nodata-stripe` on `nodata-bg` | hatch stripe vs hatch ground | 3:1 | 3.45 pass | 3.78 pass |
| `series-modis` on `color-surface` | MODIS line | 3:1 | 7.78 pass | 5.19 pass |
| `series-viirs` on `color-surface` | VIIRS line | 3:1 | 7.97 pass | 4.18 pass |
| `series-harmonized` on `color-surface` | harmonized line | 3:1 | 17.95 pass | 17.95 pass |
| `series-live` on `color-surface` | live line | 3:1 | 6.91 pass | 3.87 pass |
| `series-era-line` on `color-surface` | median line | 3:1 | 8 pass | 8.38 pass |

| Pair (information only) | Use | Dark | Light |
|---|---|---|---|
| `bin-0` on `color-surface` | swatch bin-0 vs panel | 1.7 | 15.24 |
| `bin-1` on `color-surface` | swatch bin-1 vs panel | 2.6 | 9.73 |
| `bin-2` on `color-surface` | swatch bin-2 vs panel | 3.86 | 6 |
| `bin-3` on `color-surface` | swatch bin-3 vs panel | 5.57 | 3.82 |
| `bin-4` on `color-surface` | swatch bin-4 vs panel | 7.81 | 2.56 |
| `bin-5` on `color-surface` | swatch bin-5 vs panel | 10.76 | 1.75 |
| `bin-6` on `color-surface` | swatch bin-6 vs panel | 14.22 | 1.26 |
| `div-below-5` on `color-surface` | swatch div-below-5 vs panel | 14.21 | 17.31 |
| `div-below-4` on `color-surface` | swatch div-below-4 vs panel | 10.16 | 10.38 |
| `div-below-3` on `color-surface` | swatch div-below-3 vs panel | 6.31 | 4.23 |
| `div-below-2` on `color-surface` | swatch div-below-2 vs panel | 3.6 | 2.18 |
| `div-below-1` on `color-surface` | swatch div-below-1 vs panel | 2.14 | 1.39 |
| `div-center` on `color-surface` | swatch div-center vs panel | 1.38 | 1.07 |
| `div-above-1` on `color-surface` | swatch div-above-1 vs panel | 2.14 | 1.27 |
| `div-above-2` on `color-surface` | swatch div-above-2 vs panel | 3.69 | 1.72 |
| `div-above-3` on `color-surface` | swatch div-above-3 vs panel | 6.3 | 2.85 |
| `div-above-4` on `color-surface` | swatch div-above-4 vs panel | 10.44 | 4.87 |
| `div-above-5` on `color-surface` | swatch div-above-5 vs panel | 14.62 | 8.3 |
| `cell-edge` on `color-surface` | cell outline on panel | 1.52 | 4.64 |
| `nodata-bg` on `color-surface` | no-data ground vs panel | 1.12 | 1.23 |

| Ramp | Theme | Min adjacent DeltaE: normal | protanopia | deuteranopia | tritanopia | CIELAB L* |
|---|---|---|---|---|---|---|
| density | dark | 29.03 | 11.66 | 13.28 | 10.77 | 27, 38, 49, 59, 70, 81, 91 |
| anomaly | dark | 14.82 | 14.06 | 14.72 | 12.28 | 91, 79, 63, 47, 33, 20, 33, 48, 63, 80, 92 |
| density | light | 22.34 | 16.93 | 16.37 | 13.87 | 15, 29, 42, 55, 67, 79, 91 |
| anomaly | light | 13.29 | 12.78 | 13.54 | 10.28 | 10, 27, 52, 72, 87, 97, 91, 80, 63, 48, 33 |

## 10. Open items

- D0 review done (see its report). Wireframes are ASCII and untested with users.
- Cell number fit: 2rem desktop and 1.6rem phone cells cannot show 4 to 5 digit counts. Decide at D1: abbreviate (12k), enlarge desktop cells to about 3rem x 2rem, or show no inline number and rely on focus and tap.
- Desktop auto-apply while typing risks 3.2.2 and screen-reader noise: prefer Apply at both widths, or apply on blur and Enter only.
- 27 year rows at 2rem is about 54rem tall: the KPI strip plus grid exceed one laptop screen. Consider newest years first with a sticky month header (already newest first) and a compact row height.
- Density denominator (grid cells in AOI) needs Second Foundation confirmation and a line in the Method drawer.
- Class edges (section 5.1) and the diverging classing (5.3) need science-gate confirmation.
- Map base: section 8.
