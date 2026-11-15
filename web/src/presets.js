// Example areas. The real ones come from overview.json (places.js hotspotPresets); the fixture
// detections sit in tile x17y13 (lon -10..0, lat 40..50), which is also the fixture domain
// (fixtures/README.md), so the fixture demo needs its own area that covers them.
// bbox is [west, south, east, north].
export const FIXTURE_PRESET = { id: 'fixture-box', label: 'Fixture area (tile x17y13)', bbox: [-10, 40, 0, 50], placeholder: true };

/** Built-in example areas: only the fixture area, in fixture mode. */
export const presetsFor = ({ fixtures = false } = {}) => (fixtures ? [FIXTURE_PRESET] : []);

export const findPreset = (id, presets) => presets.find((p) => p.id === id) ?? null;
