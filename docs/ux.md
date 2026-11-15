# UX spec

Status: D0 passed with conditions (M0-G5, see section 10); layout and components follow the humans-approved design 3. Tokens: `web/styles/tokens.css`. Audience: emergency managers who must read an area's fire history in seconds, often on a phone in the field. Contract names (QueryState, VIEWS, CalendarCell, caveat ids) come from `docs/roadmap.md`.

## 1. Flow

1. First screen (no area yet): a hero that asks "When does this place burn?" with two parts beside the copy, the heat map plate and a preview card (desktop from 64rem: copy and plate on the left, the card in a 26rem column on the right; below 64rem one column, card above plate; the plate's side list drops under the map when the plate is under 40rem wide). Lede: "Pick a square on the map or one of the hottest areas to preview its fire record since {first year}. Then open the full calendar." (phone: "Tap a square or a hotspot to preview its fire record since {first year}."). Under the lede, one quiet monospace line of record facts from the manifest, "MODIS from Nov 2000 · VIIRS from Jan 2012 · Latest Dec 2025" (`recordFacts`: coverage starts and `last_month`, missing ones skipped); each fact stays whole, so at 400px it wraps to two lines, still above the card. **Plate** (`hero-place.js`, the same night plate, heat map, zoom, pins and readout as the place picker, from `heat-map.js`): "Where it burned in {year}" and the picker's unit line; the map with its legend; "Hottest in {region}, {year}" (or "Hottest areas, {year}") with "Most fire activity in {year}, one sensor" and the top three hotspots as `aria-pressed` rows on the plate (with countries, see the place picker's country scope); "Or set it yourself" with Draw an area and Enter coordinates; the border note (only with a region). A global overview fits and zooms as in the picker. With no hotspot the list reads "No fire detected in {region} in {year}.". **Preview card**: a tag and a note ("Suggested" dashed, "Hottest 1° area in {region}, {year}"; "Your pick" in accent, "Hotspot #{k} in {region}" or "1° area on the map"; "Current area", the last chosen area back on Home), the heading (a hotspot's state, else its country; a plain square's center "6.5°S 44.5°W"; a custom area's name, else its range), a line under it ("{center} · {country}" for a named hotspot, "{region} · 1° square, about 110 km across" for a square, the range for a named custom area), the overview value "{n} fire-cell-days in {year}" with its swatch and a sensor chip (1° squares only), the Radiant (18rem; 16rem on phone, where the month labels stay at least 0.6875rem), its caption "{first}–{last}. Rings are years, newest outside; slices are months. Pick a month to open it in the calendar." ("No fire detected here in {year}. Earlier years still show in the rings." when the square's value is 0) and "Open the calendar". The Radiant is the calendar's own: the harmonized cells `buildResult` gives the calendar of that area, never raw counts. A pick (map square, Enter on the map, or a row) moves the blue ring, re-renders the card and becomes the last chosen area the tabs open; it is not written to the hash. "Open the calendar" commits it with a new history entry, named by its place ("State, Country") or center. While a pick's record loads for more than 150 ms the previous Radiant dims to 0.35 under a "Loading the record…" pill and the button is disabled; a failed load replaces the Radiant with "Couldn't load this area's record." and Try again. When every month of the area's record is null (no sensor covers it, as for a global hotspot outside the shipped tiles) the Radiant and caption give way to "No record for this area in the data." and the button stays disabled. A polite live line reads "Preview: {heading}, {first}–{last}.". On phone, a pick made while the card is less than half on screen raises a selection bar above the tab bar (`role="status"`: swatch, heading, "{n} in {year} · Radiant updated above", Open); its text scrolls the card back and it hides once the card is half visible. The plate shows nothing for 300 ms while `overview.json` loads, then a skeleton. The Radiant is drawn at once, before any tile arrives: every month of the record (from the manifest) in the neutral `--color-border` placeholder, `aria-busy`, with its caption already set, so nothing moves when the data lands; the same slices then take their data colors, ring by ring (480 ms fill transition, 10 ms stagger per ring; instant under reduced motion), and later picks recolor the same slices in place. Clicking a month slice opens the calendar for that area with the month selected and its panel open; from the keyboard the Radiant is one tab stop, arrows move a focus ring (Left and Right by month, Up and Down by year, Home and End to the ends, gaps skipped), each move is read from a polite live region, every slice carries the calendar cell's accessible name, and Enter or Space opens the month. Without `overview.json` (missing or invalid) the plate gives way to "The hotspot map isn't available right now." / "You can still choose an area yourself." with "Draw an area on the map" (primary) and "Enter coordinates", the original lede returns, the example cards (fixture mode) sit under the hero, and the card shows the whole data region (the domain's extent, else the manifest's tiles) captioned "The whole data region, {first}–{last}. Rings are years, slices are months.", with no tag and no button, named "Whole data region" when a month is opened. With no manifest the brand mark stands in for the Radiant. Export is hidden: there is nothing to export yet.
2. Pick an area from the place picker: the place button in the top bar, or the pencil on the area chip, opens a drawer (a sheet on phone) with the 1° heat map from `overview.json`, the ten ranked hotspots and "Draw or enter coordinates", which hands over to the area and period form (popover on desktop, bottom sheet on phone; the period chip opens it too). The drawer's primary is "Open calendar" on Home and "Use this area" on the other views, where only the area changes.
3. The Calendar view fills. The answer comes first (verdict row): the latest month against its median, the Radiant, and three facts in range. Then the caveat line, then the year x month grid. Caveats are visible the whole time.
4. Click, tap or press Enter on a cell to open the selected-month panel: docked on the right at 64rem and wider, a modal bottom sheet below that. Arrow keys move the selection and the panel follows.
5. Export opens a menu: CSV downloads the aggregates on screen, Image (PNG) the calendar of the area and period; each confirms in a toast.
6. Everything on screen is encoded in the URL hash (`#aoi=bbox:w,s,e,n&name=&from=&to=&view=&layer=`), so a view can be shared by link. `name` is the area's title (trimmed, control characters stripped, at most 60 characters; empty or without an area it is dropped); without one the title is the matching example's label, else "Custom area". "Copy link" in the selected-month panel copies it at every width, and the share button on the area chip opens a menu with "Copy link" and "Copy coordinates" (decimal west, south, east, north). Both report in a toast.

## 2. Information architecture

| Element | Role | Present from |
|---|---|---|
| Synthetic band | Burnt orange band on top while the data is the synthetic demo set (`manifest.synthetic`), with an About button opening a popover (what the data is, why it exists, that it must not be used for decisions, and a link to the Method drawer) and a close button ("Hide the synthetic data notice"). Closing slides the band out (transform and opacity, the content below glides up in a FLIP, so no frame recomputes layout; instant under reduced motion), is remembered in `sessionStorage` (`pr-synth-banner-closed`), so the band returns on the next visit, and leaves a "Synthetic data" tag in the top bar, right before Method ("Synthetic" on phone), that opens the same About popover. The popover closes on Escape, light dismiss or page scroll and returns focus to the button that opened it. The selected-month panel and phone sheet eyebrow reads "Selected month · Synthetic data", because the sheet covers the top bar. The data is never shown without one of these | M1 |
| Top bar | Brand mark (a link home to the first screen), view tabs (Home first, a house icon with no visible text on desktop, named "Home" with a tooltip; then each enabled view, icon plus label; Live carries a `--color-fire` dot 0.5rem before its label while its data is under 48 hours old, pulsing between full and 0.6 opacity unless motion is reduced), the offline chip when offline, the synthetic tag, Method, the place button (pin icon only, 2.75rem, `--color-accent-soft` fill and `--color-accent` icon, named "Choose an area" with a tooltip after 400 ms; a 2px inset accent ring while the picker is open), Export (a menu). No theme control: it lives in the footer and the Method drawer. On phone: brand, Method (info icon), the place button and Export (icon), 2.75rem icon buttons, and the tabs move to a bottom bar where Home, like every item, shows icon and label. Home, the Home tab or the brand, resets everything: the hash becomes a bare `#`, the month panel or sheet, area sheet, place picker, full map, Method drawer and popovers close, and the first screen shows with Home selected. It is its own history entry, so Back returns to the area. A view picked on the first screen opens, with nothing selected, the area a link set or the last area chosen this session, else the suggestion; with none of them it opens the place picker | M1 |
| Views: Calendar \| Sensors \| Anomalies \| Live | One `VIEWS` entry each. Disabled views are not rendered. Every view is on (Sensors plots core's R, K and harmonized series, gate V1; Anomalies shows core's ranks and flags, gate V2; Live compares NOAA-20 x K with the archive band over Brazil, gate V3). On synthetic data Live runs on web-side placeholder numbers (`preview-stubs.js`) and its tab carries a "preview" tag | M1 |
| Context row | Eyebrow per view ("Burning activity calendar", "Sensors · two records, one series", "Anomalies · each month against its own history", "Live · this fire season", plus " · Synthetic data" while synthetic), area title (the area's name), area chip (the name when the area has one, else the coordinates; the accessible name carries both), period chip. Chips wrap on phone, never truncate. Picking an example scrolls to the top and moves focus to the main view | M1 |
| Verdict row | Calendar only: latest-month hero card, Radiant card, facts card (peak month, busiest year, total in range). Sensors, Anomalies and Live replace it with their own answer card | M1 |
| Caveat line | Persistent, not dismissible: "Hotspot counts, not burned area. Values before VIIRS are scaled to VIIRS-equivalent (MODIS × R)." plus "How this is made" opening the Method drawer. Shows "Preliminary" only while core's gate for the method (`not-validated` in `core/caveats.js`) is not passed; V1 passed it | M1 |
| Calendar card | Title, stepped legend bar, layer switch "Counts \| vs median" (core's ranks), Grid \| Table, the grid with a year-total column and a median row | M1 |
| Selected-month panel | Docked region (desktop) or modal sheet (phone) | M1 |
| Method drawer | Floating right drawer (desktop), bottom sheet (phone): satellite timeline, flame key, three method steps, status, data credits, theme control on phone | M1 |
| Footer | Brand, tagline, authors (each a link to their GitHub profile, new tab, `rel="noopener noreferrer"`), data credits, license, data version, Install app (when the browser offers it; on iPhone and iPad the line "Install: tap Share, then Add to Home Screen." instead, always; never when the app runs standalone). The same words appear once as a dismissible card above the bottom tab bar after the first area loads (never on the first screen), recorded in `localStorage` as `pr-ios-hint-closed` when it appears, theme control | M1 |

## 3. Layout

Screenshots of the built app at 1440 and 400 wide, both themes, are the reference; the ASCII below gives the structure only.

### 3.1 Desktop, 1440 wide, Calendar view

```
+------------------------------------------------------------------------------------+
| SYNTHETIC DEMO DATA  Generated by the team ... not real fire detections.  About x |
+------------------------------------------------------------------------------------+
| [mark] PRIME RADIANT  (Calendar)(Sensors)        (sun|moon|system)  Method  [Export]|
+------------------------------------------------------------------------------------+
| BURNING ACTIVITY CALENDAR                                                          |
| Custom area   [19 S-12 S . 59 W-52 W  edit]  [Jan 2001 - Oct 2026 v]               |
| +--------------------+ +--------------------------+ +------------------------+     |
| | OCT 2026 . LATEST  | |  (Radiant)  THE RADIANT  | | Peak month  PREVIEW Sep|     |
| | 3,117 fire-cell-d. | |             rings=years  | | Busiest year      2024 |     |
| | +5% vs Oct median  | |             slices=months| | Total in range 394,078 |     |
| | PREVIEW, rank line | |                          | |                        |     |
| +--------------------+ +--------------------------+ +------------------------+     |
| ! Hotspot counts, not burned area. Values before VIIRS are scaled ...    How this  |
| +--------------------------------------------------------------------------------+ |
| | Fire-cell-days by month          [ramp 0 1 4 16 64 256 1024+]   (Grid|Table)   | |
| |      Jan Feb ... Dec   Year total                                             | |
| | 2026 [45][12] ...      ==== 12,576*                                           | |
| | ...                                                                           | |
| | Median [..] PREVIEW                                                           | |
| +--------------------------------------------------------------------------------+ |
+------------------------------------------------------------------------------------+
```

With a cell selected, the panel docks on the right (`--panel-w`) and the main column narrows. Below a 72rem main column (container query) the Radiant card is dropped and the small Radiant moves into the hero card, so no row is left half empty.

### 3.2 Phone, 400 wide, Calendar view

```
+------------------------------+
| SYNTHETIC DEMO DATA ...About |
| [mark] PRIME RADIANT  (i)(v) |   info opens Method, arrow-down icon exports
+------------------------------+
| BURNING ACTIVITY CALENDAR    |
| Custom area                  |
| [19 S-12 S . 59 W-52 W edit] |   chips stack, full width
| [Jan 2001 - Oct 2026 v]      |
| +--------------------------+ |
| | OCT 2026 . LATEST  (Rad.)| |   hero card with the mini Radiant
| | 3,117   +5% PREVIEW      | |
| +--------------------------+ |
| ! Hotspot counts ... How this|
| +--------------------------+ |
| | ramp, Grid|Table          | |
| | J F M A M J J A S O N D  | |   12 columns fit, numbers abbreviated (3k)
| +--------------------------+ |
| footer                       |
+------------------------------+
| (Calendar)      (Sensors)    |   fixed bottom bar
+------------------------------+
```

A cell tap opens the panel as a bottom sheet (`role="dialog"`, `aria-modal`), the page scrolls so the cell stays visible above the sheet (2.4.11), Back closes it (history entry).

### 3.3 Area and period (popover and sheet) and map

Desktop: a popover under the period chip; opened from "Draw or enter coordinates" in the place picker or from the first screen's two actions, a dialog centered in the viewport over a scrim, Phone: a bottom sheet. In both, the header and the Apply foot stay put and only the fields between them scroll. Name first: a combobox (WAI-ARIA APG, list autocomplete) prefilled each time the form opens with the area's title ("Custom area" for an unnamed one), its text selected on focus so typing replaces it; an untouched Apply keeps the title. On first focus it fetches `places.json` once; typing lists up to 8 places matched case- and accent-insensitively on the name and alternate names (exact, then prefix, then word start; ties region, state, country, then name), each with its kind and country on a second line. Down and Up move (wrapping), Enter picks, Escape closes the list (a second Escape closes the form). A pick fills the name and the coordinates and moves the map. While the user has not typed a name, editing or drawing a different area turns it back into "Custom area". Missing or invalid `places.json`: no suggestions, no message. Apply writes the name to the hash; a hotspot pick names the area after its place ("State, Country"), and any other square picked on the map after its center ("7.5°S 23.5°E"), so a map pick is never "Custom area". Then the coordinates, then the fixture example in fixture mode, the map ("Draw on map": inline on desktop, full screen with Done and Cancel on phone), the period with All, Last 10 years and This year, and Apply. The form is always a complete path; the map is an accelerator. Map base: see section 8.

## 4. Components

| Component | Behavior | Notes |
|---|---|---|
| Tabs | `role="tablist"` with Home as the first tab and the selected one on the first screen (`main` is the `tabpanel`, labeled by the selected tab). Arrow keys, Home and End move and activate a view; landing on the Home tab only focuses it, so the area is not dropped by an arrow, and Enter, Space or a click goes home. Hash updates, Back works | Home icon only on desktop; icon plus label in the phone bottom bar |
| Theme control | `role="radiogroup"` Light, Dark, System; arrows move, choice stored as `pr-theme`; switch animated with a View Transition when supported and motion is allowed | Footer and Method drawer (both widths) |
| Area and period chips | Open the form as a popover (desktop) or sheet (phone) with `aria-modal`, focus trapped, Escape and the close button return focus to the chip | Chips wrap; no ellipsis at 400px |
| Place picker | A modal dialog (focus trapped, labeled by its title), from the right on desktop (36rem, full height), a sheet on phone. Header "Choose an area", "Where did it burn in {year}?" and the unit line "Fire-cell-days of 0.1° cells, summed per 1° square · VIIRS S-NPP {year} · {region}". A night plate (`--plate`, same in both themes) holds the map: one square per 1° cell in the `--hm-0..6` classes 0, 1–49, 50–199, 200–499, 500–999, 1,000–1,999, 2,000+ (fixed edges, legend under the map), rank pins 1 to 10, a readout of the square under the pointer or focus, and, when `overview.region` exists, the note that edge squares count only the part inside it (the global grid has no edge, so no note). The map is one tab stop (`role="application"`): arrows move one square and skip gaps, Shift and an arrow five, Home goes to hotspot 1, Enter or Space picks; a polite live region reads each move (150 ms debounce). Focus is a yellow ring, the pick a blue one. "Hottest in {region}" lists the ten hotspots ("Most fire activity in {year}, one sensor"), two columns on desktop and one on phone, as `aria-pressed` rows of equal height: the state (or the country when there is none) over the country, each on one line and cut with an ellipsis, the value never wrapping; when the heading repeats (three "Mato Grosso") every such row adds the center to its second line ("Brazil · 10.5°S 55.5°W"); the full "State, Country" is the row's tooltip and accessible name ("Hotspot 1, State, Country, 2,500 fire-cell-days in 2025"). The selection footer and the first-run cards show "State, Country" with the center coordinates under it; without `place` the coordinates are the label everywhere. When the data is wider than 40° (the global extent) the map sits in a 2:1 box and zooms in two levels, with no wheel or pinch. The whole map fits the data: the squares' extent padded by two squares and widened to 2:1. The rank pins are hidden there (they would pile up on one continent) and come back zoomed in; the pick and focus rings never draw under 14 px on screen, so a hotspot of a few pixels is still one visible blue ring. A click there shows a window around the click (a click on the ocean centers on the nearest square that burned and focuses it), made of whole squares only (integer edges, 20° × 10° at most, narrower where needed to keep a square at least 24 px); there a click picks. A hotspot row zooms to its square, an arrow key that takes the focus out of the window recenters it, and "Show whole map" (globe button, 2.75rem, at the end of the readout row under the map, only while zoomed) goes back. The change is instant. Rings and pins keep their on-screen size at both levels, and at any zoom a pin whose center falls within 22 px of a higher-ranked numbered pin is drawn as a plain dot. A pick is staged: the sticky footer shows it and enables the primary (disabled with "Pick a square or a hotspot" before); Cancel, Escape, the scrim and the close button discard it and return focus to the opener. Region names come only from `overview.region.name`; without one the copy says "Hottest areas" and drops the suffix. **Country scope** (`hottestList` in `heat-map.js`, shared with the first screen): when `overview.json` carries `countries` with two or more entries, the list title becomes "Hottest in [World ▾], {year}", a native select whose visible label is "Hottest in" (the default option is the region's name when there is one). World lists the countries ranked by total fire-cell-days (same unit as the map, no swatch, second line "Whole country", accessible name "Country {k}, {name}, {n} fire-cell-days in {year}"); a country row or the select scopes to that country and moves focus to the select. A country zooms the map to its box padded by a square and widened to 2:1 (a box wider than 120°, such as Russia or one across the antimeridian, keeps the whole map), lists its top squares (three on the first screen) and moves the pins onto them; those pins stay visible at world level. A click picks in a country window no wider than a click's window, else zooms as on the whole map. The browser's language region (`navigator.language` region subtag, named with `Intl.DisplayNames('en', {type: 'region'})`) leads the select in its own "Your region" group only when a country of `countries` has the same name after folding case, accents and punctuation; Natural Earth names such as "S. Sudan" are never guessed. Without `countries` (or with one, a region build) the list is the hotspot list above. Without `overview.json` the body says "The hotspot map isn't available right now. You can still choose an area yourself." with Draw an area and Enter coordinates. The values carry no Preview tag: the science team checked `overview.json` (docs/data.md, last section) | Drawer in with the Method drawer's motion; sheet on phone; fade only under reduced motion |
| Share menu | A link button attached to the area chip (one pill split in two) opens a `role="menu"` popover: Copy link, Copy coordinates. Focus moves to the first item; arrows, Home and End move; Escape, Tab, scroll and outside click close it and focus returns to the button | Same at every width |
| Offline chip | "Offline · showing saved data" when the browser is offline and something is on screen, "Offline" otherwise, also shown when a data fetch fails on the network. Inside a persistent `role="status"` region in the top bar; driven by the `online` and `offline` events and the data source's errors; reconnecting hides it and retries a failed load. On phone the words after "Offline" are visually hidden but still read, and the word mark gives way | An area that is not cached shows "This area is not saved for offline use." |
| Popovers | About and the share menu use the Popover API; without it `web/src/components/popover.js` toggles `hidden` and adds Escape, outside click and the same focus return | |
| Verdict: hero | Latest month value; delta against the same month's median (core `baseline`), "2.7x" when the ratio is 2 or more or under 0.5, else a signed percent; rank among the same months; the median's years ("median of earlier years, 2002–2024"; the peak month in the facts card reads "median 1,820, all years 2003–2025"). "Not enough history for a median" when there is none. All comparisons carry Preview | Median from core `baseline` (at least 5 earlier years, partial months left out) |
| Verdict: facts | Peak month of the typical year (Preview), busiest year (plain sum, partial year named), total in range | |
| Radiant | Polar calendar: rings are years (oldest inside), slices are months, January at 12 o'clock, clockwise, one 0.01 rad gap per month boundary. The small Radiant (8.5rem, in the hero card) drops the ring hairlines and narrows the gap to 0.004 rad to avoid moiré. The selection is a 3.5-unit `--color-focus` outline over a `--color-surface` halo, so it stays visible on yellow cells. Overview only: no number of its own, not in the tab order; hovering a slice shows a tooltip and highlights the cell, clicking selects it. The grid stays the keyboard path | `role="img"` with a label naming the first and last ring |
| Calendar grid | `role="grid"`, roving tabindex, arrows/Home/End/PageUp/PageDown, Enter opens the panel, arrows move the selection while it is open, Escape closes. A bracket along the year labels covers each run of rows holding an estimated month, with "Estimated (MODIS × R)" written up the gutter at 0.6875rem ("Est." for a run under six rows); the corner notch stays. Terra-only months (core flag `terra-only`, 2000-11 to 2002-06) are flat outlined cells with a "T", labeled "not harmonized: Terra only, before Aqua (Jul 2002)", with their own legend key; a year with them is partial ("2002 from July, Terra only before", total starred), a year of only them reads "Terra only". Cell label: "September 2005, 25 fire-cell-days, density 2.5 per 1,000 cells, estimated, scaled to VIIRS-equivalent (MODIS × R), low confidence"; a S-NPP month reads "observed"; a partial month adds "partial month, sensor outage". Year-total column (busiest year highlighted, partial year starred; hidden below a viewport of 80rem, kept when the panel is open at wider sizes) and a median row tagged Preview | Numbers abbreviated (12k) where the full count does not fit |
| Cell marks | Estimated: triangle in the top-right corner. Partial month: dotted bottom edge. Flag (C): 2px `--color-text` ring with a `--color-bg` line inside it, plus a notch in the top-left corner | Marks never rely on color |
| Legend | Stepped ramp bar with tick values; the bins as a visually hidden list; the density unit sentence under the grid | |
| Table view | Same data as an accessible table, toggled from Grid \| Table; "Show in table" in the panel jumps to the year | Scoped headers |
| Selected-month panel | Eyebrow ("Selected month", plus " · Synthetic data" when the data version starts with "synthetic"), month, value with its swatch, density and provenance chips, comparison with the median named by its years ("vs the median of the 23 earlier Septembers (2001–2023)", Preview), a bar strip of the same month in every year with the dashed "median of earlier years" line (the selected value sits 0.25rem above the higher of its bar and the line, never within 0.375rem of the line; with no room above it goes between the line and the bar, or beside the bar under the line; the line's own label moves to the side away from the selected value), rank sentence (Preview), satellites in orbit that month (from the manifest), estimation note, caveats, Copy link (both widths), Show in table and key hints (desktop) | Desktop: `role="region"`, focus stays in the grid. Phone: modal sheet, focus moves to the title and returns to the cell |
| Caveat line | Non-dismissible | Text from `core/caveats.js` |
| Method drawer | Timeline of the four satellites (redrawn at its rendered width so labels stay 0.75rem and the axis 0.6875rem), flame key, three steps, status line, data section | Focus trap, Escape closes, focus returns to the trigger |
| Export | A button that opens a menu (role menu; arrows, Home and End move, Escape and Tab close and focus returns to the button) with CSV and Image (PNG). Disabled for the same reason in both, outside the domain. CSV downloads `prime-radiant-<first month>-<last month>.csv` (for example `prime-radiant-2001-01-2026-10.csv`) and confirms with "CSV saved: <file>" in a toast. With synthetic data the first line of the file says so. Image (PNG) downloads `prime-radiant-<first>-<last>.png` and confirms with "Image saved: <file>": a standalone 1000 by N composition at 2x (title, period, bbox in the area chip's format, the Radiant, the grid with the app's density classes, hatched no data, Terra-only, estimated and partial marks, legend with the unit, data version, the manifest citation), always on the light palette whatever the app theme; with synthetic data a band at the top says so and the data line names the generator; months outside the period are left blank. Drawn as SVG with DOM APIs and rasterized through an `<img>` (data: URL, already allowed by img-src) and a `<canvas>` | Output equals `core.toCsv` behind the CSV formula guard |
| Toast | One at a time, bottom right (bottom center above the tab bar on phone); a new one replaces the old. Success lasts 5 s in a `role="status"` region, errors 8 s in a `role="alert"` region, both created at startup. Icon, message, Dismiss button, countdown bar; hover or focus pauses the countdown. Reduced motion hides the bar | `web/src/components/toast.js` |
| Scroll lock | `scrollbar-gutter: stable` on the root, so opening a drawer, sheet or modal does not shift the page. Scrolling panels use thin scrollbars (`scrollbar-width`, `scrollbar-color`, with a `::-webkit-scrollbar` fallback) | |
| Sensors view (B) | Answer card: core's R (`harmonize` in `core/harmonize.js`, docs/method.md), eyebrow "R fitted on 2012-02 to 2021-12" (the months inside core's window where MODIS and S-NPP both counted and neither was partial), shown as "1.91×" with "VIIRS ÷ MODIS, all months" when core applies per-month ratios (plain "VIIRS ÷ MODIS" for one yearly R), its 95% interval, the years it was fit on, the example month's own R ("September uses its own R, 1.81 (1.66–2.01)") and its level (the area, or a fallback region), a low-confidence tag when core marks it unusable at the area level, and the line "K = 0.98: S-NPP ÷ NOAA-20, used after S-NPP ends". No Preview tag: R and K were accepted at gate V1. When MODIS saw no fire in the overlap at any level, the card says R cannot be computed. "How a harmonized month is built": three steps, the busiest month scaled from MODIS (its count, "× R for September = 1.81" with per-month ratios or "× R = 1.42" with one yearly R, and the VIIRS-equivalent value the Calendar shows, marked estimated), and NOAA-20 × K after S-NPP ends (or a line saying no month in the range needs it). Chart: By year \| By month (month opens the table on phone), series chips (`aria-pressed`, one stays on), Chart \| Table. MODIS solid, S-NPP dashed, NOAA-20 dotted, harmonized a wide band at 35% (core's series, the same the Calendar shows) with a dotted center line on estimated months; the months used for R shaded and labeled "Months used for R"; by year, a partial year (the range cuts it, or the harmonized sum misses Terra-only months) is a hollow point off the line, labeled with the months it covers ("2002, Jul–Dec"); the two-line caption keys the marks ("Hollow: partial years, off the lines"); direct labels at least 16 px apart, never below the plot, and the last year tick right-aligned so they never meet; satellite timeline under the shared x axis from `manifest.satellites` and coverage; direct labels on desktop. "SYNTHETIC DATA" in the plot on synthetic data. The chart is one tab stop: arrows, Home and End move a guide and a tooltip, read through a polite live region. Table columns: Year, MODIS, S-NPP, NOAA-20, Harmonized, Source. Export CSV on this tab writes `prime-radiant-sensors-<first>-<last>.csv` through core's `toCsv('sensors')`: R and K in the header, then `year,month,sensor,value` rows for modis, viirs, noaa20 and harmonized | One harmonized series across tabs: core's |
| Anomalies view (C) | Answer card: newest ranked month and its percentile, its side of the median (or flagged), how many months are flagged in the range, a Radiant on the diverging ramp with the Calendar Radiant's geometry (desktop only; phone drops it); a Synthetic tag on synthetic data, no Preview tag (gate V2). Under it, side by side on desktop and stacked on phone: "Flagged periods", core's `flaggedPeriods` cut to the range, newest first, one button per run ("Aug–Oct 2019", "3 months · peak 97th percentile · confirmed on MODIS") that opens the run's first month in the panel, then one plain line ("Flagged: a record or near-record for that calendar month, confirmed on MODIS or VIIRS alone.") and core's `flagRuleText` in a closed disclosure "How a month is flagged", with "≤" for "<="; and a "Year rank" card in the facts row pattern: "Rank of 2019", the rank ("5–6" when observed and scaled totals disagree, with core's reason), "of 16 complete years, 2003–2019", the year's total. Grid card: "How unusual was each month", "Number: percentile among the same month in earlier years", the stepped diverging bar ("Less fire", "Median", "More fire"), Grid \| Table, "SYNTHETIC DATA" over the grid. Cells read "96th" (desktop) or "96" (phone, 0.625rem Fira Code); an exact lowest or highest reads "Low" or "High" on desktop, "L" or "H" on phone (never "0" or "100") and "record low" or "record high" in the table. A cell with no rank is an empty box with a 1px dotted `--color-border` edge and no fill, so it never reads as a flag (the 2px solid ring with a corner notch). In light every cell has a 1px `--cell-edge`, so the median class shows on the white card. The foot keeps only the marks key (flagged, no rank, no data). The panel's bar strip takes each year's diverging class. "About these ranks" card last: core's anomaly caveats (and cross-era, unconfirmed, sparse-baseline when present), each a disclosure with the short line visible. Disclosures here are rows between 1px `--color-border` hairlines, 2.75rem tall, with a chevron at the end that turns when open (no default triangle) | Ranks, flags, periods and year rank from `core/anomaly.js` and `core/periods.js` |
| Live view (D) | Answer card: "October 2026 so far: 1,019 fire-cell-days", the signed percent against that month's median (Preview), "Fetched 2 h ago · 14 Nov, 23:39 UTC", Synthetic and a `--color-fire` outlined Provisional tag. Chart card at full width: axis 0.75rem Fira Code, months "Nov", "Jan 2026" (year on January only), labels 0.8125rem 600, median `--color-text-muted` 1.5px dashed, band named inside itself when tall enough, "SYNTHETIC DATA" in the plot, Chart \| Table. Live detections are never added to the harmonized totals | Real data: `web/src/live-data.js` builds the input from `core/live.js` (month to date, daily running total, no Preview tag; Low confidence tag and notes for days not observed or missing; a reason line instead of the chart outside Brazil, without K or with too few days). Synthetic data: placeholder band from `preview-stubs.js` |

### 4.1 Motion

Entrances animate `transform` and `opacity` (the cell ignite adds a brief brightness filter), with `--dur-*` and `--ease-*` tokens: cells ignite in a short stagger on first reveal, the Radiant grows in, the panel slides in from the right, sheets rise from the bottom, the drawer slides in. With `prefers-reduced-motion: reduce` every entrance becomes a short fade or nothing, and no View Transition runs.

Known issue: while a view switch's View Transition runs, Chrome sends every click to `<html>`, so a click in that window is lost (`pointer-events: none` on `::view-transition` does not change this). The whole transition is capped at `--dur-2` (160ms), about 210ms from click to end measured in headless Chrome, down from about 290ms.

## 5. Color

### 5.1 Density: inferno, 7 classes

Unit: fire-cell-days per 1,000 grid cells in the AOI (density). Absolute counts saturate: a large AOI puts every month in the top class (the mockup median of 3,100 already sits in 1024+), and a small AOI never leaves the bottom. Density makes the same classes mean the same thing across AOI sizes, on fixed edges (no per-AOI quantiles, which would hide that one area burns more than another). The raw count stays in the cell label, hover, focus and detail panel, in the table view and in the CSV; the legend names the unit: "Color: fire-cell-days per 1,000 grid cells (density). Number: raw fire-cell-days."

Zero is its own lowest class, labeled "0", only when the raw count is 0, so a quiet area reads as quiet rather than as missing; a positive density below 1 goes to class 1. Positive densities use six log (base 4) classes. Inferno (matplotlib's viridis family) is perceptually ordered with monotone lightness, survives the common color vision deficiencies and reads dark purple to yellow-hot as more fire; it is never mixed with a rainbow.

| Class | Range | Token | Light hex | Dark hex |
|---|---|---|---|---|
| 0 | 0 (raw count 0) | `--bin-0` | #160b39 | #6a176e |
| 1 | 1-3 | `--bin-1` | #4f0d6c | #972766 |
| 2 | 4-15 | `--bin-2` | #85216b | #c33b4f |
| 3 | 16-63 | `--bin-3` | #bc3754 | #e55c30 |
| 4 | 64-255 | `--bin-4` | #e65d2f | #f8890c |
| 5 | 256-1023 | `--bin-5` | #fb9606 | #fbbe23 |
| 6 | 1024+ | `--bin-6` | #f6d746 | #f2f27d |

Dark samples inferno from 0.30 to 0.96 so the lowest class shows on the deep ground (1.68:1 on the panel, above the 1.6:1 floor the tests assert); light samples 0.10 to 0.90 so the top class is not lost on white (palette 4, approved by the humans on 2026-11-14). Lightness stays strictly increasing in both themes (asserted in `tools/contrast.test.js`).

The class edges and the density denominator (grid cells in the AOI, fine or coarse level) are a display proposal from the mathematician's review; the Second Foundation validates the unit and any threshold before they ship (`second-foundation:validate`). The ramp is a presentation choice; the bin edges did not change with it.

### 5.2 No data

Sensor not operating (`null`) is a gray diagonal hatch (`--nodata-hatch`), never a class color and never "0". Its text label is "No data". The hatch is also the only pattern in the grid, so it cannot be confused with the "partial" or "estimated" marks.

### 5.3 Anomaly vs median: PuOr 11 (slot C)

Dark theme: the light-centered PuOr becomes a glare slab on a dark ground, so the dark ramp is lightness-reversed. The median is a dark neutral (`#2b3048`) and cells get lighter as they depart from it: orange above (`#7a3d12 #b35806 #e08214 #fdb863 #fee6a8`, steps 1 to 5), violet below (`#4b3f9e #6e63c0 #9a8fe0 #c4bdf0 #e6e2fa`). The legend says dark gray is the median. The light theme keeps ColorBrewer PuOr 11 untouched, described next.

Diverging, centered on the historical median: the center class (#f7f7f7) means "equal to the median". Orange to brown is above the median (more fire), purple is below. Five steps each side. Legend text: "Center = historical median of the same month in earlier complete years. Darker orange: more than the median. Darker purple: less." Flags are a marker, not a color. Classing (percentile or ratio) is decided by the Second Foundation at gate V2, so the 11 classes are tokens only for now.

### 5.4 Sensor series: inferno stops

One pair everywhere (Sensors chart, chips, Method timeline, mark): MODIS violet (`#a78bfa` dark, `#6d4fc4` light), VIIRS ember (`#ff8a4c` dark, `#c2410c` light), harmonized gold `#fbba1f` in dark and ink `#151622` in light (a dark gold collapsed with VIIRS under protanopia), drawn thicker. `--series-*` carry the same values as `--sensor-*`. VIIRS is also dashed, and every line has a direct label, so color is never the only cue.

### 5.5 Themes

Dark is the base palette (a deep navy ground with a soft glow). The theme control offers Light, Dark and System (the default, stored as `pr-theme`); System follows `prefers-color-scheme`, and `data-theme="light|dark"` on the root overrides it either way. Both palettes are token sets in `web/styles/tokens.css`; components only use tokens. The top bar has its own `--topbar-*` tokens (near-black `#0c0d17` in dark, pale `#eef1f8` in light) and its focus ring is scoped to the bar. Its glass is 72% opaque in dark and 92% in light, where the blurred grid colors otherwise read as haze; on phone (40rem and under) it is fully opaque in both, since the first-screen map and its pins scroll under it. The first-run Radiant's month labels stay at 0.6875rem or more on phone (a container query enlarges them when the Radiant is under 20rem).

Palette 4, two temperatures. Warm is fire and data: every warm color comes from inferno (density ramp, sensors, the mark, `--color-fire` `#ff8a4c` dark and `#a33500` light for the above-median pill and busiest-year bar, `--color-warn` for the caveat line, `--color-highlight` `#fbba1f` dark and `#a33500` light for the hero word "burn?"). Below-median deltas (the verdict pill and the panel ratio) use the purple arm of the diverging ramp, `--color-below` (`#9a8fe0` dark, `#542788` light) on a 14% ground of the same color, so blue stays for action. Cool is action: one blue (`#4da3ff` dark, Space Apps `#0050d8` light) for the primary button, links, focus ring, selected cell, selected bar and current month; the data never uses blue, so a blue ring shows on every cell. Neutral slate for surfaces, text and lines. The synthetic band and tag are burnt orange `#b83a00` with white text (5.76:1) in both themes. The mark keeps its shape: violet `#9b6cf2` left (MODIS), ember `#f68013` right (VIIRS), gold `#fbba1f` core (harmonized). No logo and no "NASA" wordmark are used.

The 1px `--cell-edge` is `rgb(255 255 255 / 0.14)` in dark (1.52:1 against the panel) and `#6b7490` in light (4.64:1). Known partial miss of WCAG 1.4.11 in dark: classes 0 and 1 are 1.68:1 and 2.39:1 against the panel and the edge is faint, so the fill is not a stand-alone carrier; the count printed in every desktop cell, the readout and aria-label, the table and the CSV carry the value.

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

D0 judgment, revised for the dark redesign: acceptable in light (the 1px edge is 4.64:1, so 1.4.11 is met by the edge) and a documented partial miss in dark for classes 0 and 1 (see above). The fill is information carried also by the number (hover, focus, tap, table, CSV). Conditions: the edge is never removed, and the number must be reachable without hover (focus and tap) (phone cells show the number abbreviated, 3k).

## 6. States

| State | Where | What the user sees |
|---|---|---|
| First run (no area) | Main view | Hero with the heat map plate (map, top three hotspots, Draw an area, Enter coordinates) and the preview card of the suggested area; the Home tab is selected. No empty grid, no Export. Without `overview.json`: the manual path in place of the plate, the whole data region in the card, example cards in fixture mode |
| Zero detections | Grid, hero | Class 0 cells; the hero reads "0" and "No hotspots detected; the sensors were operating." Never confused with no data |
| No data | Cells before MODIS (2000-11) or outside coverage | Hatch plus "No data" in label; the hero says "No data", never 0 |
| Loading | Grid and verdict | Skeleton cards and grid with `aria-busy="true"` and a polite status; the chips stay usable |
| Outside the domain | Main view | A state card, "Outside the data domain": the area lies outside Brazil, "no counts, not zeros", a primary "Draw an area in {region}" button ("in the data domain" without a region name from `overview.json`) and up to three example chips (the top hotspots); no grid. Export is `aria-disabled` with the reason as its accessible description. An area partly outside gets an info notice under the title (icon, `--color-surface-2` pill, 0.8125rem, the offline chip's pattern) with the share inside |
| Partial month | Grid, panel | A month core flags partial (a sensor outage in `manifest.partial_months`) is marked on the cell and named in its label and panel ("partial month, sensor outage"); the baseline leaves it out |
| Error | Main view | "Could not load fire data", what to do, "Try again"; the form keeps its values. `role="alert"` once |
| Live unavailable (D) | Live view | "Live data unavailable. Last update <fetched_at>"; the calendar keeps working; no fake zeros |
| Not enough history | Hero, panel | "Not enough history for a median" instead of a number |
| Area too large | Area form | Message with the cap and a suggested size; Apply disabled |
| Preliminary | Caveat line, Method drawer | "Preliminary" badge while a core caveat gate is open; after V1 only near-real-time data (Live) keeps it |
| Preview | Comparisons with the median (delta, rank, median row, peak month, typical year), Live | A dashed "Preview" tag: gate V1 validated the counts, R, K and the median baseline, not these comparisons. The median value itself has no tag |
| Synthetic | Whole app | Closable band, then a top bar tag for the session, "Synthetic" in the title, a line at the top of the CSV |
| Offline | Top bar | Offline chip; cached data stays on screen, an area not cached shows the error state with "This area is not saved for offline use." |

## 7. Accessibility checklist (WCAG 2.2 AA)

- [ ] All controls reachable and operable by keyboard; the map can be skipped (skip link "Skip map"), the form is a complete path (2.1.1, 2.1.2)
- [ ] Focus visible: 2px `--color-focus` outline with a 2px offset and a halo (blue in both themes), on every control and cell; the only exception is headings and panels that receive focus programmatically (`tabindex="-1"` on `h1`, `h2`, `main`, dialogs), which show none (2.4.7, 2.4.11 focus not obscured: sticky header and bottom sheet never cover the focused cell; `scroll-margin` set)
- [ ] Target size at least 24 x 24 CSS px; calendar cells 1.625rem tall and about 1.5rem (24 px) wide at a 400px viewport, narrower below that, other controls `--target-min` 2.75rem (2.5.8)
- [ ] Contrast: text 4.5:1, large text and UI components 3:1 (table in section 9); data fills documented as info with outline and number as the carrier (1.4.3, 1.4.11)
- [ ] Color never the only cue: numbers in labels and hover/focus, dash patterns, corner marks, hatch (1.4.1)
- [ ] Text alternatives: table view of the grid, data table of the sensor chart, CSV export (1.1.1)
- [ ] Grid: `role="grid"`, `aria-label` per cell with month, year, value, status, estimated; roving tabindex (4.1.2)
- [ ] Tabs, drawer and sheets: roles, `aria-selected`, `aria-expanded`, focus trap and restore, Escape closes (4.1.2, 2.1.2)
- [ ] Errors identified in text, tied to fields with `aria-describedby`; status messages in a live region (3.3.1, 4.1.3)
- [ ] No drag-only path: map rectangle has the form alternative (2.5.7)
- [ ] Reflow at 400 px wide and 320 px, no horizontal page scroll (the grid and the data tables scroll inside their own container only if needed; a table caption wraps to the visible width), text resizes to 200% (1.4.4, 1.4.10)
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

Summary: every required pair passes in both themes. Rows marked "information only" are not required by WCAG 2.2 (a data fill next to its own label and outline is not a stand-alone graphical object); they are listed so the weak ones are known. In dark, classes 0 and 1 against the panel (1.68:1 and 2.39:1) and the faint cell edge (1.52:1) are the known partial miss described in 5.5; in light, the yellow end of inferno (1.43:1) and the PuOr center rely on the `#6b7490` edge (4.64:1) and the number. Cell text on each class uses the better of dark and white, chosen per class (`--bin-N-text`, `--div-*-text`). The dark `cell-edge` is composited over the panel color before measuring; `topbar-bg` is transparent in dark and measured over `color-bg`.

| Pair (foreground on background) | Use | Min | Dark | Light |
|---|---|---|---|---|
| `color-text` on `color-bg` | body text on page | 4.5:1 | 17.11 pass | 15.88 pass |
| `color-text` on `color-surface` | text on panels | 4.5:1 | 15.88 pass | 17.95 pass |
| `color-text` on `color-surface-2` | text in inputs | 4.5:1 | 14.16 pass | 16.46 pass |
| `color-text-muted` on `color-surface` | secondary text on panels | 4.5:1 | 8 pass | 8.38 pass |
| `color-text-muted` on `color-bg` | secondary text on page | 4.5:1 | 8.62 pass | 7.41 pass |
| `color-text-muted` on `color-surface-2` | secondary text on inputs | 4.5:1 | 7.13 pass | 7.68 pass |
| `color-accent` on `color-surface` | links on panels | 4.5:1 | 6.84 pass | 6.69 pass |
| `color-accent` on `color-bg` | links on page | 4.5:1 | 7.37 pass | 5.92 pass |
| `color-accent-text` on `color-accent` | selected control text | 4.5:1 | 7.37 pass | 6.69 pass |
| `color-cta-text` on `color-cta` | primary button text | 4.5:1 | 7.37 pass | 6.69 pass |
| `color-focus` on `color-surface` | focus ring on panels | 3:1 | 6.84 pass | 6.69 pass |
| `color-focus` on `color-bg` | focus ring on page | 3:1 | 7.37 pass | 5.92 pass |
| `topbar-focus` on `topbar-bg` | focus ring in the top bar | 3:1 | 7.37 pass | 5.92 pass |
| `topbar-text` on `topbar-bg` | top bar text | 4.5:1 | 17.11 pass | 15.88 pass |
| `topbar-muted` on `topbar-bg` | top bar inactive tabs | 4.5:1 | 8.62 pass | 7.41 pass |
| `topbar-border` on `topbar-bg` | top bar button borders | 3:1 | 3.3 pass | 4.1 pass |
| `color-border-strong` on `color-surface` | control borders on panels | 3:1 | 3.06 pass | 4.64 pass |
| `color-border-strong` on `color-bg` | control borders on page | 3:1 | 3.3 pass | 4.1 pass |
| `color-warn` on `color-surface` | delta and flagged text | 4.5:1 | 7.69 pass | 6.85 pass |
| `color-error` on `color-surface` | error text | 4.5:1 | 6.41 pass | 7.75 pass |
| `color-error` on `color-error-bg` | error text on error box | 4.5:1 | 6.19 pass | 6.79 pass |
| `color-caveat-text` on `color-caveat-bg` | caveat strip text | 4.5:1 | 14.53 pass | 14.21 pass |
| `color-caveat-border` on `color-bg` | caveat strip edge | 3:1 | 8.28 pass | 6.06 pass |
| `color-badge-text` on `color-badge-bg` | preliminary badge | 4.5:1 | 17.11 pass | 17.95 pass |
| `color-fire` on `color-fire-soft` | above-median delta pill | 4.5:1 | 6.76 pass | 5.26 pass |
| `color-below` on `color-below-soft` | below-median delta pill | 4.5:1 | 5.65 pass | 7.22 pass |
| `color-below` on `color-surface` | below-median ratio in the panel | 4.5:1 | 6.31 pass | 10.38 pass |
| `color-synth-text` on `color-synth` | synthetic band text | 4.5:1 | 5.76 pass | 5.76 pass |
| `color-highlight` on `color-bg` | hero accent word (large text) | 3:1 | 11.19 pass | 6.06 pass |
| `color-text` on `color-raised` | selected segment text | 4.5:1 | 13.08 pass | 17.95 pass |
| `current` on `color-surface` | selected month and year labels | 4.5:1 | 6.84 pass | 6.69 pass |
| `bar-sel` on `color-surface` | selected year bar | 3:1 | 6.84 pass | 6.69 pass |
| `sensor-modis` on `color-surface` | MODIS bar and dot | 3:1 | 6.6 pass | 5.89 pass |
| `sensor-viirs` on `color-surface` | VIIRS bar and dot | 3:1 | 7.69 pass | 5.18 pass |
| `sensor-harm` on `color-surface` | harmonized core | 3:1 | 10.38 pass | 17.95 pass |
| `bin-0-text` on `bin-0` | cell text, bin-0 | 4.5:1 | 10.71 pass | 18.4 pass |
| `bin-1-text` on `bin-1` | cell text, bin-1 | 4.5:1 | 7.51 pass | 13.07 pass |
| `bin-2-text` on `bin-2` | cell text, bin-2 | 4.5:1 | 5.17 pass | 8.65 pass |
| `bin-3-text` on `bin-3` | cell text, bin-3 | 4.5:1 | 5.48 pass | 5.51 pass |
| `bin-4-text` on `bin-4` | cell text, bin-4 | 4.5:1 | 7.96 pass | 5.97 pass |
| `bin-5-text` on `bin-5` | cell text, bin-5 | 4.5:1 | 11.6 pass | 9.47 pass |
| `bin-6-text` on `bin-6` | cell text, bin-6 | 4.5:1 | 16.5 pass | 14.73 pass |
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
| `series-modis` on `color-surface` | MODIS line | 3:1 | 6.6 pass | 5.89 pass |
| `series-viirs` on `color-surface` | VIIRS line | 3:1 | 7.69 pass | 5.18 pass |
| `series-harmonized` on `color-surface` | harmonized line | 3:1 | 10.38 pass | 17.95 pass |
| `series-live` on `color-surface` | live line | 3:1 | 7.69 pass | 5.18 pass |
| `series-era-line` on `color-surface` | median line | 3:1 | 8 pass | 8.38 pass |

| Pair (information only) | Use | Dark | Light |
|---|---|---|---|
| `bin-0` on `color-surface` | swatch bin-0 vs panel | 1.68 | 18.4 |
| `bin-1` on `color-surface` | swatch bin-1 vs panel | 2.39 | 13.07 |
| `bin-2` on `color-surface` | swatch bin-2 vs panel | 3.47 | 8.65 |
| `bin-3` on `color-surface` | swatch bin-3 vs panel | 5.05 | 5.51 |
| `bin-4` on `color-surface` | swatch bin-4 vs panel | 7.33 | 3.52 |
| `bin-5` on `color-surface` | swatch bin-5 vs panel | 10.68 | 2.22 |
| `bin-6` on `color-surface` | swatch bin-6 vs panel | 15.19 | 1.43 |
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
| density | dark | 23.65 | 19.04 | 11.65 | 12.18 | 26, 36, 46, 57, 68, 80, 93 |
| anomaly | dark | 14.82 | 14.06 | 14.72 | 12.28 | 91, 79, 63, 47, 33, 20, 33, 48, 63, 80, 92 |
| density | light | 24.09 | 16.85 | 14.44 | 15.48 | 6, 20, 32, 44, 57, 71, 86 |
| anomaly | light | 13.29 | 12.78 | 13.54 | 10.28 | 10, 27, 52, 72, 87, 97, 91, 80, 63, 48, 33 |

## 10. Open items

- D0 review done (see its report). Wireframes are ASCII and untested with users.
- Desktop auto-apply while typing risks 3.2.2 and screen-reader noise: prefer Apply at both widths, or apply on blur and Enter only.
- Density denominator (grid cells in AOI) needs Second Foundation confirmation and a line in the Method drawer.
- Class edges (section 5.1) and the diverging classing (5.3) need science-gate confirmation.
- Map base: section 8.
- Design 3, not built yet (planned): tick ring on the first-run Radiant (no spec for it in design 3).
- The Radiant starts January at 12 o'clock, as in the mockup; the design spec text says "centered". The designer confirms.
