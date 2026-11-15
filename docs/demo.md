# Demo script (3 minutes)

URL: https://primeradiant.zenus.systems. Production runs on real FIRMS data for Brazil, November 2000 to December 2025 (data version `20261115`, published to R2 on 2026-11-15, `docs/deploy.md`). The numbers below were read from production on 2026-11-15; if the data version changes, read them again before presenting. A global publish is planned: it changes the Pantanal numbers (the parts of the box in Bolivia and Paraguay start counting) and removes the "outside Brazil" pill, so after it this script needs a new pass.

The place picker's map and ranked hotspots need `overview.json` next to the manifest in the published data version; on 2026-11-15 production did not serve it yet (404), so the place picker shows the manual path and the first screen has no example cards. The script below does not depend on it. Once it is published, read the top hotspot from production before mentioning it.

Check before presenting: open the URL once on the venue network and keep the tab loaded (the service worker caches the shell and the tiles already viewed; new areas need the network).

| Time | Do | Say |
|---|---|---|
| 0:00 | Open the URL: the first-run screen. | MODIS has counted fires since 2000, VIIRS since 2012, and they count differently: VIIRS pixels are smaller, so it sees more. Put side by side, the record jumps in 2012 for reasons that have nothing to do with fire. Prime Radiant puts both on one calendar. |
| 0:30 | Click the place button (pin icon), then Draw or enter coordinates, and type the Pantanal box: South -20.1, West -58.2, North -15.3, East -55; Apply. Point at the pill "Part of this area lies outside Brazil". | An area can be picked from the hotspot map, typed or drawn. The data covers Brazil, and the app says when part of an area falls outside it instead of counting zeros there. |
| 0:50 | Point at the Radiant, then at the calendar grid and the year totals. | Each ring is a year, each slice a month: the bright arc is the fire season, August to October. In the grid, 2020 stands out at 17,396 fire-cell-days, the year the Pantanal burned. |
| 1:20 | Click September 2020 in the grid. | 4,659 fire-cell-days, observed by VIIRS S-NPP. The panel compares it with the median of the 17 earlier Septembers, 1,884: about 2.5 times. That comparison is marked Preview: the science gate has not covered it yet. |
| 1:50 | In the panel, read "Busiest: 2007 with 4,730". Click September 2007: the panel says estimated, MODIS × R. | This is the point of harmonization: 2007 had only MODIS, and the app scales it to VIIRS-equivalent, so September 2007 and September 2020 are on the same scale. |
| 2:10 | Open the Sensors tab. | For this area VIIRS counts 1.91 fire-cell-days for every one MODIS counts, R fitted on 2012 to 2021 with a 95% interval of 1.80 to 2.05; September uses its own R, 1.81. September 2007: MODIS 2,615 × R for September gives the 4,730 the calendar shows (the screen rounds R to 1.81). After S-NPP ends, NOAA-20 continues it with K = 0.99. The science team accepted this method at gate V1. |
| 2:40 | Back to Calendar, Export > CSV (or Image (PNG) for the calendar as a picture); the link button on the area chip copies the link. | The CSV carries the numbers on screen with the method, R and K, the data version and the FIRMS citation. Every view is a shareable link. |
| 2:55 | Spoken close. | Anomaly flags and the live season come next; they are not claimed today. |

Fallbacks: if the venue network is down, use `npm run mock && npm run serve` locally and say first, out loud, that the data is synthetic (the band at the top says so, and the CSV carries the same warning). Anomalies and Live run on placeholder numbers: they are hidden on real data, appear only with `?preview=1` or on synthetic data, and are not to be demoed as working (production has no `MAP_KEY`, and the app does not call the live proxy yet).
