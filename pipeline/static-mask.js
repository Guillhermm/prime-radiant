/**
 * Static-source mask (gate G2, docs/gates/G2.md). FIRMS types static land sources only where its
 * own persistence analysis caught them, and its VIIRS v1/v2 files often leave them as type 0
 * (VIIRS 375 m user guide 1.2, section 6.1), so flares still show up as type 0 next to their typed
 * detections. The mask is a set of 0.01 degree cells, built from the VIIRS archive (S-NPP, NOAA-20)
 * before binning and applied to every sensor and year. MODIS does not seed it: its 1 km pixels
 * (up to about 2 x 4.8 km off nadir) spread one source over many 0.01 degree cells, and its v03
 * type 2 covers about 81,000 such cells in Brazil, seasonal like the fires themselves:
 *   - every cell holding an archive detection of type 1 (volcano) or 2 (static land source), and
 *     its 8 neighbors. Type 3 is left out: VIIRS also gives it to fires over inland water and
 *     wetlands (the Pantanal in 2024);
 *   - every cell with type-0 detections on at least `minDays` distinct UTC days of one year in one
 *     file, in at least `minYears` distinct years.
 * Vegetation fires move: a savanna or deforestation cell rarely burns on 10 days of a year, and
 * almost never in two years, while a flare does every year.
 */
const RES = 0.01;
const COLS = 36000;
const ROWS = 18000;

export const STATIC_MASK = { res: RES, minDays: 10, minYears: 2, neighbors: 1, types: [1, 2], sensors: ['viirs'] };

const col = (lon) => ((Math.floor((lon + 180) / RES) % COLS) + COLS) % COLS;
const row = (lat) => Math.min(ROWS - 1, Math.floor((lat + 90) / RES));

/** Cell key; longitude 180 is the same column as -180. */
export const maskKey = (lat, lon) => row(lat) * COLS + col(lon);

const dayNum = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;

export const createMaskBuilder = ({ minDays = STATIC_MASK.minDays, minYears = STATIC_MASK.minYears } = {}) => {
  const typed = new Set();
  const years = new Map();
  // One Map per degree of latitude keeps each under the engine's Map size limit on global files.
  let days = null;
  return {
    startFile() {
      days = Array.from({ length: 181 }, () => new Map());
    },
    /** A record read with stats.allTypes. Records without a type (NRT) say nothing about sources. */
    add(rec) {
      if (rec.type === undefined || rec.type === 3 || rec.sensor !== 'viirs') return;
      if (rec.type !== 0) {
        const r = row(rec.lat);
        const c = col(rec.lon);
        for (let i = Math.max(0, r - 1); i <= Math.min(ROWS - 1, r + 1); i++) {
          for (let j = -1; j <= 1; j++) typed.add(i * COLS + (c + j + COLS) % COLS);
        }
        return;
      }
      const year = +rec.utcDay.slice(0, 4);
      const k = maskKey(rec.lat, rec.lon) * 1e4 + year;
      const band = days[Math.floor(rec.lat + 90)];
      const d = dayNum(rec.utcDay);
      // Value: last day * 1000 + distinct days. A day counts only after the last one seen, so a
      // file that is not date-sorted (or one cell split across CSV entries) undercounts, never over.
      const v = band.get(k);
      if (v === undefined) band.set(k, d * 1000 + 1);
      else if (d > Math.floor(v / 1000)) band.set(k, d * 1000 + (v % 1000) + 1);
    },
    endFile() {
      for (const band of days) {
        for (const [k, v] of band) {
          if (v % 1000 < minDays) continue;
          const cell = Math.floor(k / 1e4);
          (years.get(cell) ?? years.set(cell, new Set()).get(cell)).add(k % 1e4);
        }
      }
      days = null;
    },
    finish() {
      const mask = new Set(typed);
      let persistent = 0;
      for (const [k, ys] of years) if (ys.size >= minYears) { mask.add(k); persistent++; }
      return { mask, stats: { typed_cells: typed.size, persistent_cells: persistent, cells: mask.size } };
    },
  };
};
