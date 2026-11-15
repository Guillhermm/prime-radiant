// Pure parts of the service worker: what to precache, what to name the caches, how to route a request.
// Paths are relative to the worker's scope (/web/), so the same list works on localhost and in production.
// Bump CACHE_VERSION whenever a precached file changes so installed apps refetch the shell atomically.
export const CACHE_VERSION = 'v24';
export const SHELL_CACHE = `pr-shell-${CACHE_VERSION}`;
export const DATA_CACHE = `pr-data-${CACHE_VERSION}`;

export const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'icons/mark.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'theme-init.js',
  'styles/tokens.css', 'styles/app.css', 'styles/components.css',
  'fonts/fira-code-latin-400-normal.woff2', 'fonts/fira-code-latin-500-normal.woff2',
  'fonts/fira-sans-latin-400-normal.woff2', 'fonts/fira-sans-latin-500-normal.woff2',
  'fonts/fira-sans-latin-600-normal.woff2', 'fonts/fira-sans-latin-700-normal.woff2',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'src/bins.js', 'src/data-source.js', 'src/format.js', 'src/live-data.js', 'src/main.js', 'src/places.js', 'src/place-search.js', 'src/presets.js',
  'src/preview-stubs.js', 'src/pwa.js', 'src/satellites.js', 'src/state.js', 'src/stats.js', 'src/theme.js', 'src/view-data.js', 'src/sensors-model.js', 'src/views.js',
  'src/components/anomaly-layer.js', 'src/components/anomaly-summary.js', 'src/components/aoi-form.js', 'src/components/area-drawer.js', 'src/components/app-shell.js',
  'src/components/calendar-grid.js', 'src/components/caveat-strip.js', 'src/components/cell-detail.js',
  'src/components/data-table.js', 'src/components/date-range.js', 'src/components/export-image.js', 'src/components/export-menu.js',
  'src/components/focus-trap.js', 'src/components/h.js', 'src/components/heat-map.js', 'src/components/hero-place.js', 'src/components/icons.js',
  'src/components/legend.js', 'src/components/live-view.js', 'src/components/map-picker.js', 'src/components/sensors-view.js', 'src/components/segmented.js',
  'src/components/method-drawer.js', 'src/components/name-field.js', 'src/components/query-bar.js', 'src/components/radiant.js', 'src/components/states.js',
  'src/components/synthetic-band.js', 'src/components/theme-control.js', 'src/components/toast.js', 'src/components/popover.js', 'src/components/share-menu.js', 'src/components/offline-chip.js', 'src/components/verdict-row.js',
  '../core/aggregate.js', '../core/anomaly.js', '../core/baseline.js', '../core/calendar.js', '../core/caveats.js', '../core/csv.js', '../core/data/daily-share.json', '../core/data/outlook-model.json', '../core/data/type0-share.json', '../core/domain.js',
  '../core/grid.js', '../core/harmonize.js', '../core/index.js', '../core/live.js', '../core/months.js', '../core/outlook.js', '../core/partial.js', '../core/periods.js', '../core/schema.js', '../core/series.js', '../core/tiles.js',
];

export const shellUrls = (scope) => SHELL_FILES.map((p) => new URL(p, scope).href);

/**
 * 'bypass': leave it to the browser (non-GET, other origins such as OSM tiles, unknown paths).
 * 'network-only': api/ is never stored. 'network-first': data/ and fixtures/, cache as offline fallback.
 * 'shell': precached app shell, answered from cache and refreshed in the background.
 */
export const routeFor = ({ url, method }, scope) => {
  if (method !== 'GET') return 'bypass';
  const u = new URL(url);
  if (u.origin !== new URL(scope).origin) return 'bypass';
  if (u.pathname.startsWith('/api/')) return 'network-only';
  if (u.pathname.startsWith('/data/') || u.pathname.startsWith('/fixtures/')) return 'network-first';
  const bare = new URL(u.pathname, u.origin).href;
  return shellUrls(scope).includes(bare) ? 'shell' : 'bypass';
};

export const staleCaches = (names) => names.filter((n) => n.startsWith('pr-') && n !== SHELL_CACHE && n !== DATA_CACHE);
