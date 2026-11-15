# Space Apps submission draft

Draft answers for the NASA Space Apps Challenge 2026 project form. Facts are taken from
the repository (`docs/method.md`, `docs/data.md`, `docs/gates/`). See "Open items" before
submitting.

## Project Name

Prime Radiant: a harmonized MODIS–VIIRS burning activity calendar

## Summary

Prime Radiant is a web app that turns two decades of NASA FIRMS active-fire hotspots into
one consistent burning activity calendar. MODIS has observed fires since 2000 but is near
the end of its life. VIIRS sees smaller fires at finer resolution, so it reports about 2.5
times more activity over Brazil, and the two records cannot be compared directly. We count
both sensors in a common unit (fire-cell-days on a 0.1° grid) and fit a correction factor
R for each area from the years both sensors overlap. With it we build one series from
2000 to today in which the sensor of origin no longer matters. Users draw or type an area
of interest and get:

- a month-by-year calendar with an accessible color ramp;
- the current month against its historical median;
- flagged anomalies;
- a near-real-time view of this season;
- an experimental next-month outlook;
- CSV and image exports.

Every number on screen passed an independent scientific validation gate before shipping.
Fire managers, responders and scientists get a single, honest picture of when and where
burning happens.

## Project Details

### What it does

- **Area and dates:** pick an area on a map or by coordinates, choose a date range, or
  start from presets and named places.
- **Calendar:** each cell shows a month's fire-cell-days, distinguishing "none detected"
  (0) from "no data" (sensor not operating). Estimated, partial and low-confidence months
  are marked.
- **Sensors view:** MODIS, VIIRS and the harmonized line side by side, with the R factor,
  its confidence interval and a plain-language method note.
- **Anomalies:** each month is ranked against the same month in earlier years. A month is
  flagged only when it is extreme on the harmonized record and also on a single sensor
  alone, so differences between sensors cannot create false alarms. A "record since 2012"
  label shows records within the VIIRS era.
- **Live:** the current month to date, from FIRMS near-real-time data, against the
  historical band. It is labeled approximate and provisional.
- **Fire outlook (experimental):** the chance that next month lands above the area's usual
  level, from a simple logistic regression. Its measured skill is shown openly: small but
  real gain over persistence, no gain in low-fire cells, and no weather input.
- **Exports:** CSV with full method metadata and a formula-injection guard, plus a PNG of
  the calendar.

### How it works

- **Pipeline:** streams the FIRMS archive (yearly country CSVs and Shapefile attribute
  tables), keeps vegetation fires only (type 0), and counts one fire-cell-day per sensor,
  0.1° cell and UTC day. Terra and Aqua are merged into one MODIS record. Satellite outage
  days are detected so they never read as "no fire".
- **Harmonization:** VIIRS where it operates. Before VIIRS, MODIS × R, with
  R = ΣVIIRS/ΣMODIS over full overlap months (2012–2021, before MODIS orbit drift). Areas
  with few fires fall back to a regional factor. After S-NPP stopped (2 November 2026),
  NOAA-20 × K continues the VIIRS record.
- **Science in the browser:** all calculations run client-side from small static tiles,
  so the app needs no server.
- **Science gates:** four validation gates, run by independent reviewers covering the
  literature, an independent recomputation and physical plausibility. They covered
  harmonization, anomalies, live data and the outlook. Several rejected the first
  version, and the fixes are recorded in the repository (`docs/gates/`).

**Validated result (Brazil):** R = 2.52 (95% CI 2.46–2.58) and K = 0.984. The flagged
months match known events, such as the 2020 Pantanal fires and the record first half of
2024. The app also confirms that August 2025 and 2026 were historic lows, as INPE
reported.

### Tools and technologies

- **Code:** JavaScript ES modules on Node.js, standard library only, zero runtime
  dependencies, no bundler. Tests with `node --test` (more than 700) following a test
  pyramid, plus Chrome end-to-end tests.
- **Data:** NASA FIRMS (MODIS C6.1, VIIRS S-NPP and NOAA-20 C2, archive and near-real-time)
  and Natural Earth boundaries.
- **Hosting and map:** static hosting on Vercel, tiles on Cloudflare R2, GitHub Actions for
  the daily live update, Leaflet with OpenStreetMap. Installable as a PWA and works
  offline.

### What makes it creative

- **Transparency first:** the app always separates "zero" from "no data" and labels
  estimated values as "scaled to VIIRS-equivalent". It shows which sensor confirmed each
  anomaly and publishes its own uncertainty, including the outlook's limits.
- **Low cost:** free tiers, static files, and no keys or servers in the user's path.

### Factors we considered

- Accessibility: WCAG 2.2 AA color ramps and full keyboard use.
- Phone-width layouts.
- Security headers.
- No API keys in the browser.
- Data-use and citation requirements of FIRMS.
- Honest wording, so we never call the outlook "fire risk".

## Open items before submitting

1. **Extent:** the validated history covers Brazil. The global extent passed gate G1 with
   caveats; keep "Brazil" in the text if the deployed site is not yet global.
2. **AI disclosure:** Space Apps asks teams to disclose generative AI use. Suggested
   sentence: "Development was assisted by AI coding agents (Claude Code); all scientific
   claims were independently validated and reviewed by the team."
3. **Links:** add the live demo URL and the repository link
   (`github.com/Guillhermm/prime-radiant`) if the form has fields for them.
