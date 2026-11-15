# Demo video (30 seconds)

URL: https://primeradiant.zenus.systems (real NASA FIRMS data, worldwide, November 2000 to December 2025, data version `202611152226`; Live from the daily near-real-time job). Structure follows the Space Apps guidance: team, challenge, name and tagline, solution, future.

Before recording: open the URL once and let it load; press Reload if the app offers an update. The home suggests the hottest 1° area of the newest full year (Kasaï-Oriental, Democratic Republic of the Congo, on `202611152226`). Read any number you say from the screen on the day, never from this file.

| Time | Screen | Say (about 75 words, about 2.5 a second) |
|---|---|---|
| 0:00 | Logo and home, still. | We are Prime Radiant. |
| 0:02 | Home: the world heat map. | The MODIS sensor has counted fires since 2000. Its successor, VIIRS, sees more of them, so their records don't line up. |
| 0:05 | Hover the hottest list, then the Radiant on the right. | Prime Radiant: twenty-five years of fire on one calendar, for any place on Earth. |
| 0:10 | Click a hotspot, "Open the calendar", then a bright month; Export menu open. | Pick an area. We put NASA FIRMS hotspots from MODIS and VIIRS on one scale, so 2005 compares with 2025. See each month against its usual level, and export. |
| 0:20 | Live tab on a Brazilian area with a full chart, then Anomalies. | Next: this season against past years as it happens, so responders spot an unusual month while it unfolds. |
| 0:28 | Logo with the URL. | primeradiant.zenus.systems |

Notes:

- Data credit to show or say: NASA FIRMS (LANCE / ESDIS), MODIS Collection 6.1 and VIIRS 375 m; map tiles © OpenStreetMap contributors.
- "Sees more of them": VIIRS pixels are 375 m against about 1 km for MODIS; over Brazil VIIRS counts about 2.5 times what MODIS counts for the same area and month (`docs/data.md`, R 2.51 on the masked Brazil build). Joined without harmonization, the record would jump in 2012, when VIIRS data starts, without more fire.
- "Twenty-five years": MODIS from November 2000 to the latest archive month, December 2025.
- "Against past years": the Live band uses the VIIRS-era years, 2012 on.
- Live outside Brazil shows a running total without past-year comparison until a whole month of live data is in; record Live on one of the Brazilian example links the Live view offers.
- The fire outlook is not in the app; do not mention it as a feature.
- Fallback without network: `npm run mock && npm run serve`, and say the data is synthetic; better to re-record later than to show synthetic numbers as real.
