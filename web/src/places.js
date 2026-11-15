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

/** The hotspot whose square is `bbox`, or null. */
export const hotspotAt = (overview, bbox) => (overview?.hotspots ?? []).find((hs) => sameBbox(hs.bbox, bbox)) ?? null;

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
    border: `Squares on the edge of ${region ?? 'the data domain'} count only the part inside it.`,
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

/** Screen reader line for a square: "6.5°S 44.5°W, 3,391 fire-cell-days in 2025, hotspot 1." */
export const squareText = (model, square, overview) => {
  const rank = model.ranks.get(square.key);
  return `${centerLabel(square.bbox)}, ${valueLine(square.value, overview)}${rank ? `, hotspot ${rank}` : ''}.`;
};
