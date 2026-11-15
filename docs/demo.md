# Demo video (30 seconds)

URL: https://primeradiant.zenus.systems (real NASA FIRMS data, worldwide, November 2000 to December 2025, data version `202611152226`; Live from the daily near-real-time job). Structure follows the Space Apps guidance: team, challenge, name and tagline, solution, future.

Before recording: open the URL once and let it load; press Reload if the app offers an update. The home suggests the hottest 1° area of the newest full year (Kasaï-Oriental, Democratic Republic of the Congo, on `202611152226`). Read any number you say from the screen on the day, never from this file.

| Time | Screen | Say (about 75 words, about 2.5 a second) |
|---|---|---|
| 0:00 | Logo and home, still. | We are Prime Radiant. |
| 0:02 | Home: the world heat map. | Since 2000, satellites count fires, but MODIS and VIIRS count differently, so the record breaks in 2012. |
| 0:05 | Hover the hottest list, then the Radiant on the right. | Prime Radiant: one fire calendar for any place on Earth, from 2000 to today. |
| 0:10 | Click a hotspot, "Open the calendar", then a bright month; switch to Sensors for one second; Export menu open. | Pick any area. We harmonize NASA FIRMS hotspots from MODIS, Suomi NPP and NOAA-20 onto one scale; Sensors shows how. Compare each month with its median, and export. |
| 0:20 | Live tab on a Brazilian area with a full chart, then Anomalies. | Next: this season against two decades as it happens, so responders spot an unusual month while it unfolds, anywhere. |
| 0:28 | Logo with the URL. | primeradiant.zenus.systems |

Notes:

- Data credit to show or say: NASA FIRMS (LANCE / ESDIS), MODIS Collection 6.1 and VIIRS 375 m; map tiles © OpenStreetMap contributors.
- "So the record breaks in 2012": over Brazil VIIRS counts about 2.5 times what MODIS counts (`docs/data.md`, R 2.51 on the masked Brazil build). Say "about two and a half times" only if there is time.
- Live outside Brazil shows a running total without past-year comparison until a whole month of live data is in; record Live on one of the Brazilian example links the Live view offers.
- The fire outlook is not in the app; do not mention it as a feature.
- Fallback without network: `npm run mock && npm run serve`, and say the data is synthetic; better to re-record later than to show synthetic numbers as real.
