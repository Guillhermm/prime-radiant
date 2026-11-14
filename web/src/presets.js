// Demo areas. PLACEHOLDER values: the real demo AOIs are fixed at decision H3, when the
// archive spike shows where the data is rich. bbox is [west, south, east, north].
export const PRESETS = [
  { id: 'pantanal', label: 'Pantanal', bbox: [-58.2, -20.1, -55.0, -15.3], placeholder: true },
  { id: 'amazon-arc', label: 'Amazon arc of deforestation', bbox: [-62.0, -12.0, -50.0, -5.0], placeholder: true },
];

// The fixture detections sit in the Mato Grosso tile (cells A, B, C, D in fixtures/README.md),
// outside the Pantanal box, so the fixture demo needs its own area that covers them.
export const FIXTURE_PRESET = { id: 'fixture-mato-grosso', label: 'Fixture area (Mato Grosso)', bbox: [-59, -19, -52, -12], placeholder: true };

/** Presets to offer: in fixture mode the fixture area comes first, the real presets stay as they are. */
export const presetsFor = ({ fixtures = false } = {}) => (fixtures ? [FIXTURE_PRESET, ...PRESETS] : PRESETS);

export const findPreset = (id, presets = PRESETS) => presets.find((p) => p.id === id) ?? null;
