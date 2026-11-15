import { parseTileId } from '../../core/grid.js';
import { fold, matchKind } from './place-search.js';

// Pure model of the place picker: the overview heat map, the hotspot list, the drawer copy and which
// area a tab opens. overview.json is described in docs/data.md ("Overview for the place picker").

// Display classes for a raw yearly count per 1 deg square (designer spec, place flow section 3):
// 0 | 1-49 | 50-199 | 200-499 | 500-999 | 1,000-1,999 | 2,000+. Fixed edges, not quantiles.
export const HEAT_EDGES = [1, 50, 200, 500, 1000, 2000];
export const HEAT_LABELS = ['0', '1–49', '50–199', '200–499', '500–999', '1,000–1,999', '2,000+'];
export const heatBin = (value) => HEAT_EDGES.filter((e) => value >= e).length;

export const SENSOR_NAME = { viirs: 'VIIRS S-NPP', noaa20: 'VIIRS NOAA-20' };

const num = new Intl.NumberFormat('en-US');
export const formatCount = (n) => num.format(n);

const hemi = (v, pos, neg) => `${Math.abs(v).toFixed(1)}°${v < 0 ? neg : pos}`;
/** "6.5°S 44.5°W": the center of a [west, south, east, north] box. */
export const centerLabel = ([w, s, e, n]) => `${hemi((s + n) / 2, 'N', 'S')} ${hemi((w + e) / 2, 'E', 'W')}`;

const cellBbox = (w, s) => [w, s, w + 1, s + 1];
export const sameBbox = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/** "Maranhão, Brazil" from a hotspot's optional `place: {country, state}`, or null without one. */
export const placeLabel = (hs) => {
  const p = hs?.place;
  if (!p?.country) return null;
  return p.state ? `${p.state}, ${p.country}` : p.country;
};

/** A hotspot's heading and its secondary line: the place with the coordinates under it, else the coordinates alone. */
export const hotspotLabels = (hs) => {
  const place = placeLabel(hs);
  return place ? { label: place, coords: centerLabel(hs.bbox) } : { label: centerLabel(hs.bbox), coords: null };
};

/**
 * A hotspot row's two lines: the state (else the country) over the country, so long names stay on
 * one line each; `full` is the whole place for the tooltip and the accessible name. Without a place
 * the center is the heading and `sub` is null.
 */
export const hotspotRowLabels = (hs) => {
  const p = hs?.place;
  const full = placeLabel(hs);
  if (!full) return { title: centerLabel(hs.bbox), sub: null, full: centerLabel(hs.bbox) };
  return { title: p.state ?? p.country, sub: p.country, full };
};

/**
 * Row labels for the whole hotspot list: a heading that repeats (three "Mato Grosso") gets the
 * square's center on its second line, "Brazil · 10.5°S 55.5°W", so every row reads differently.
 */
export const hotspotRowsLabels = (hotspots = []) => {
  const rows = hotspots.map(hotspotRowLabels);
  const seen = new Map();
  for (const r of rows) seen.set(r.title, (seen.get(r.title) ?? 0) + 1);
  return rows.map((r, i) => (r.sub && seen.get(r.title) > 1 ? { ...r, sub: `${r.sub} · ${centerLabel(hotspots[i].bbox)}` } : r));
};

/** The hotspot whose square is `bbox`, or null. */
export const hotspotAt = (overview, bbox) => (overview?.hotspots ?? []).find((hs) => sameBbox(hs.bbox, bbox)) ?? null;

/** The named square at `bbox`: a hotspot, else one of a country's top squares (they carry places too), or null. */
export const placeAt = (overview, bbox) => hotspotAt(overview, bbox)
  ?? (overview?.countries ?? []).flatMap((c) => c.top ?? []).find((t) => sameBbox(t.bbox, bbox)) ?? null;

/**
 * What the hottest list shows for a scope: '' is the world. Without `countries` in overview.json (or
 * with one only, a region build) it is today's hotspot list and no scope applies; with them the world lists countries by total and a
 * country lists its top squares. An unknown country falls back to the world.
 */
export const scopeList = (overview, scope = '') => {
  const countries = overview?.countries;
  if (!Array.isArray(countries) || countries.length < 2) return { kind: 'hotspots', scope: '', items: overview?.hotspots ?? [] };
  const c = scope ? countries.find((x) => x.country === scope) : null;
  return c ? { kind: 'squares', scope: c.country, country: c, items: c.top ?? [] } : { kind: 'countries', scope: '', items: countries };
};

const ORDINAL = new Intl.PluralRules('en', { type: 'ordinal' });
const ORDINAL_SUFFIX = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
/** "1st", "2nd", "3rd", "11th", "22nd". */
export const ordinal = (n) => `${n}${ORDINAL_SUFFIX[ORDINAL.select(n)]}`;

/**
 * The country scope's suggestions: the whole map first ("World", value ""), then the browser's
 * region when the data names it (never preselected), then every country by fire-cell-days, each
 * labeled with its rank, "Brazil (3rd)".
 */
export const scopeOptions = (overview, mine = null) => {
  const countries = overview?.countries ?? [];
  const opts = countries.map((c, i) => ({ value: c.country, name: c.country, label: `${c.country} (${ordinal(i + 1)})`, region: c.country === mine }));
  const own = opts.find((o) => o.region);
  return [{ value: '', name: overview?.region?.name ?? 'World', label: overview?.region?.name ?? 'World', region: false },
    ...(own ? [own] : []), ...opts.filter((o) => !o.region)];
};

/**
 * Suggestions for what was typed, in their own order: all of them for an empty query, else those
 * whose name matches at its start or at a word start, folding case and accents ("congo", "cote").
 */
export const matchScope = (options, query) => {
  const q = fold(query).trim();
  return q ? options.filter((o) => matchKind(fold(o.name), q)) : options;
};

/** The option a typed text names exactly (folded), or null: free text is never committed. */
export const exactScope = (options, query) => {
  const q = fold(query).trim();
  return options.find((o) => fold(o.name) === q || fold(o.label) === q) ?? null;
};

/** Pin ranks for the squares a list shows, keyed "west,south"; null for a list of countries. */
export const listRanks = (list) => (list.kind === 'countries' ? null : new Map(list.items.map((x, i) => [`${x.bbox[0]},${x.bbox[1]}`, i + 1])));

// A country wider than this many degrees (Russia, or one across the antimeridian) stays on the world view.
const COUNTRY_MAX_WIDTH = 120;
const COUNTRY_PAD = 1;

/**
 * The map window for a country, {west, north, width, height} in degrees: its box padded by a square
 * and widened to the 2:1 map box, centered on it; null when the country is too wide to help.
 */
export const countryWindow = ([w, s, e, n]) => {
  if (e - w > COUNTRY_MAX_WIDTH) return null;
  let width = e - w + 2 * COUNTRY_PAD;
  let height = n - s + 2 * COUNTRY_PAD;
  if (width / height < ZOOM_ASPECT) width = height * ZOOM_ASPECT;
  else height = width / ZOOM_ASPECT;
  return { west: (w + e) / 2 - width / 2, north: (s + n) / 2 + height / 2, width, height };
};

const normName = (x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The country of the browser language's region subtag ("pt-BR" is Brazil), when overview.json has
 * fire data for it under the same English name; null otherwise. The match is exact after folding
 * case, accents and punctuation: Natural Earth names such as "S. Sudan" are skipped, never guessed.
 */
export const regionCountry = (lang, countries, regionName = (r) => new Intl.DisplayNames(['en'], { type: 'region' }).of(r)) => {
  if (!lang || !Array.isArray(countries)) return null;
  let region;
  try { region = new Intl.Locale(lang).region; } catch { return null; }
  if (!region) return null;
  let name;
  try { name = regionName(region); } catch { return null; }
  if (!name || name === region) return null;
  const want = normName(name);
  return countries.find((c) => normName(c.country) === want)?.country ?? null;
};

/** The ranked hotspots as example areas, labeled by place when the file names one, else by the center. */
export const hotspotPresets = (overview) => (overview?.hotspots ?? []).map((hs, i) => ({
  id: `hotspot-${i + 1}`,
  rank: i + 1,
  ...hotspotLabels(hs),
  name: placeLabel(hs),
  bbox: hs.bbox,
  value: hs.value,
}));

/** "3,391 fire-cell-days in 2025". */
export const valueLine = (value, overview) => `${formatCount(value)} fire-cell-days in ${overview.year}`;

/** "1,201 VIIRS fire-cell-days in 2025": the value with the sensor named, for the example cards. */
export const sensorValueLine = (value, overview) => `${formatCount(value)} VIIRS fire-cell-days in ${overview.year}`;

/**
 * The area a tab opens from Home: the link's area wins, then the last area chosen this session,
 * then the suggestion. Null when there is none of them.
 */
export const defaultArea = ({ bbox = null, last = null, suggestion = null } = {}) => {
  if (bbox) return { bbox, kind: 'hash' };
  if (last) return { bbox: last, kind: 'last' };
  if (suggestion) return { bbox: suggestion, kind: 'suggested' };
  return null;
};

/** Caption under the first-run Radiant when it shows the suggestion. */
export const suggestionCaption = (overview) => `Suggested: the 1° area with most VIIRS fire-cell-days ${overview.region ? `in ${overview.region.name}` : 'in the data'}, ${overview.year}. Rings are years, slices are months.`;

export const UNAVAILABLE = "The hotspot map isn't available right now. You can still choose an area yourself.";
export const PICK_HINT = 'Pick a square or a hotspot';

/**
 * Drawer copy. The value is a sum of 0.1 deg fire-cell-days over the 1 deg square, from one sensor
 * in one year, and border squares hold only the part inside the domain: the science check of
 * overview.json (docs/data.md) asks for all three to be said.
 */
export const drawerModel = (overview, { home = false } = {}) => {
  const primary = home ? 'Open calendar' : 'Use this area';
  if (!overview) return { title: 'Choose an area', unit: null, primary };
  const region = overview.region?.name ?? null;
  const source = `${SENSOR_NAME[overview.sensor] ?? overview.sensor} ${overview.year}`;
  return {
    title: `Where did it burn in ${overview.year}?`,
    unit: `Fire-cell-days of 0.1° cells, summed per 1° square · ${source}${region ? ` · ${region}` : ''}`,
    listTitle: region ? `Hottest in ${region}` : 'Hottest areas',
    listSub: `Most fire activity in ${overview.year}, one sensor`,
    // Only a region has an edge that cuts squares; the global grid has none.
    border: region ? `Squares on the edge of ${region} count only the part inside it.` : null,
    rowSub: region,
    primary,
  };
};

/**
 * Heat map geometry in degrees: the extent of the cells, one square per cell (west, south, value,
 * heat bin) and the hotspot ranks keyed by "west,south".
 */
export const mapModel = (overview) => {
  const cells = overview?.cells ?? [];
  if (!cells.length) return null;
  const west = Math.min(...cells.map((c) => c[0]));
  const east = Math.max(...cells.map((c) => c[0])) + 1;
  const south = Math.min(...cells.map((c) => c[1]));
  const north = Math.max(...cells.map((c) => c[1])) + 1;
  const squares = cells.map(([w, s, value]) => ({ key: `${w},${s}`, w, s, value, bin: heatBin(value), bbox: cellBbox(w, s) }));
  const ranks = new Map((overview.hotspots ?? []).map((hs, i) => [`${hs.bbox[0]},${hs.bbox[1]}`, i + 1]));
  return { west, east, south, north, squares, ranks, byKey: new Map(squares.map((q) => [q.key, q])) };
};

/** The map square whose 1 deg box is `bbox`, or null. */
export const squareFor = (model, bbox) => (model && bbox && bbox[2] - bbox[0] === 1 && bbox[3] - bbox[1] === 1
  ? model.byKey.get(`${bbox[0]},${bbox[1]}`) ?? null
  : null);

const STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * Key navigation on the map: an arrow moves `by` degrees (1, or 5 with Shift) and on to the next
 * square in that direction when the target has no square; at the edge it stays. Home jumps to
 * hotspot 1. Returns the next square, or null when the key is not a map key.
 */
export const stepSquare = (model, current, key, { by = 1 } = {}) => {
  if (!model) return null;
  if (key === 'Home') {
    const first = [...model.ranks].find(([, r]) => r === 1);
    return first ? model.byKey.get(first[0]) ?? current : current;
  }
  const d = STEPS[key];
  if (!d) return null;
  if (!current) return model.squares[0];
  const span = Math.max(model.east - model.west, model.north - model.south);
  for (let k = by; k <= span; k++) {
    const next = model.byKey.get(`${current.w + d[0] * k},${current.s + d[1] * k}`);
    if (next) return next;
  }
  return current;
};

// The map zooms only when the data is wider than this many degrees (the global extent); the zoomed
// window is at most 20 x 10 deg, narrower when needed to keep a 0.9 deg square at least 24 CSS px.
export const ZOOM_MIN_EXTENT = 40;
const ZOOM_MAX_WIDTH = 20;
const MIN_SQUARE_PX = 24;
const SQUARE_DEG = 0.9;

export const isZoomable = (model) => Boolean(model) && model.east - model.west > ZOOM_MIN_EXTENT;

// A zoomable map is drawn in a 2:1 box: the shape of the largest zoom window.
export const ZOOM_ASPECT = 2;
const WORLD_PAD = 2;

/**
 * The whole-map view of a zoomable map, {west, north, width, height} in degrees: the squares'
 * extent (pins sit on squares) padded by two squares, widened to the 2:1 box.
 */
export const worldWindow = (model) => {
  let width = model.east - model.west + 2 * WORLD_PAD;
  let height = model.north - model.south + 2 * WORLD_PAD;
  const cx = (model.west + model.east) / 2;
  const cy = (model.south + model.north) / 2;
  if (width / height < ZOOM_ASPECT) width = height * ZOOM_ASPECT;
  else height = width / ZOOM_ASPECT;
  return { west: cx - width / 2, north: cy + height / 2, width, height };
};

/**
 * The zoomed window in degrees, {west, north, width, height}, for a 2:1 map box boxW CSS px wide:
 * whole squares only (integer edges, an even width and half of it as height), at most 20 x 10 and
 * narrower when a 0.9 deg square would fall under 24 px, centered on [lon, lat] and kept inside the extent.
 */
export const zoomWindow = (model, [lon, lat], boxW) => {
  const fit = Math.min(ZOOM_MAX_WIDTH, (boxW * SQUARE_DEG) / MIN_SQUARE_PX);
  const width = Math.max(2, 2 * Math.floor(fit / 2));
  const height = Math.min(width / ZOOM_ASPECT, model.north - model.south);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return {
    west: clamp(Math.round(lon - width / 2), model.west, model.east - width),
    north: clamp(Math.round(lat + height / 2), model.south + height, model.north),
    width,
    height,
  };
};

// The middle zoom level: a window this many degrees wide (half as tall) around a click.
export const REGIONAL_WIDTH = 36;

/**
 * The regional window, {west, north, width, height} in degrees: 36 x 18 of whole squares centered on
 * [lon, lat] and kept inside the data extent (narrower only when the extent is).
 */
export const regionalWindow = (model, [lon, lat]) => {
  const width = Math.min(REGIONAL_WIDTH, model.east - model.west);
  const height = Math.min(width / ZOOM_ASPECT, model.north - model.south);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  return {
    west: clamp(Math.round(lon - width / 2), model.west, model.east - width),
    north: clamp(Math.round(lat + height / 2), model.south + height, model.north),
    width,
    height,
  };
};

// The smallest square a click may pick, in CSS px: 24 for touch (WCAG 2.2, 2.5.8 Target Size), 10 for a mouse.
const PICK_PX = { fine: 10, coarse: 24 };

/** Whether a 1 deg square drawn `pxPerDeg` CSS px wide is big enough to pick with this pointer ('fine' or 'coarse'). */
export const squareFits = (pxPerDeg, pointer) => pxPerDeg * SQUARE_DEG >= PICK_PX[pointer === 'fine' ? 'fine' : 'coarse'];

/** The square with fire nearest to [lon, lat] by its center, for a click that lands on the ocean; null when none burned. */
export const nearestSquare = (model, [lon, lat]) => {
  let best = null;
  let bestD = Infinity;
  for (const q of model.squares) {
    if (!(q.value > 0)) continue;
    const d = Math.hypot(q.w + 0.5 - lon, q.s + 0.5 - lat);
    if (d < bestD) { best = q; bestD = d; }
  }
  return best;
};

/**
 * Pins drawn as plain dots: going down the ranks, a pin whose center is under `minPx` from a
 * numbered pin of a higher rank loses its number. `pins` are {rank, x, y} in CSS px.
 */
export const dotPins = (pins, minPx = 22) => {
  const numbered = [];
  const dots = new Set();
  for (const p of [...pins].sort((a, b) => a.rank - b.rank)) {
    if (numbered.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < minPx)) dots.add(p.rank);
    else numbered.push(p);
  }
  return dots;
};

/** Whether the whole 1 deg square lies inside a zoom window. */
export const inWindow = (win, q) => q.w >= win.west && q.w + 1 <= win.west + win.width && q.s >= win.north - win.height && q.s + 1 <= win.north;

/** Screen reader line for a square: "6.5°S 44.5°W, 3,391 fire-cell-days in 2025, hotspot 1." */
export const squareText = (model, square, overview) => {
  const rank = model.ranks.get(square.key);
  return `${centerLabel(square.bbox)}, ${valueLine(square.value, overview)}${rank ? `, hotspot ${rank}` : ''}.`;
};

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * [west, south, east, north] of the data region: the domain's 0.1 deg cells when there is a domain
 * (rows keyed by latitude index from -90, runs of longitude indexes from -180, both inclusive), else
 * the manifest's 10 deg tiles. Null when neither says anything.
 */
export const dataRegionBbox = (manifest, domain = null) => {
  const rows = Object.entries(domain?.rows ?? {}).filter(([, runs]) => runs.length);
  if (rows.length) {
    const lats = rows.map(([k]) => Number(k));
    const cols = rows.flatMap(([, runs]) => runs.flat());
    return [r1(Math.min(...cols) / 10 - 180), r1(Math.min(...lats) / 10 - 90), r1((Math.max(...cols) + 1) / 10 - 180), r1((Math.max(...lats) + 1) / 10 - 90)];
  }
  const tiles = (manifest?.tiles ?? []).map(parseTileId);
  if (!tiles.length) return null;
  return [Math.min(...tiles.map((t) => t.tx)) * 10 - 180, Math.min(...tiles.map((t) => t.ty)) * 10 - 90,
    (Math.max(...tiles.map((t) => t.tx)) + 1) * 10 - 180, (Math.max(...tiles.map((t) => t.ty)) + 1) * 10 - 90];
};

export const DATA_REGION_NAME = 'Whole data region';

/** Caption under the first-run Radiant when it shows the whole data region (no overview.json). */
export const regionCaption = (first, last) => `The whole data region, ${first}–${last}. Rings are years, slices are months.`;
