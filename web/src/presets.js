// Demo areas. PLACEHOLDER values: the real demo AOIs are fixed at decision H3, when the
// archive spike shows where the data is rich. bbox is [west, south, east, north].
export const PRESETS = [
  { id: 'pantanal', label: 'Pantanal', bbox: [-58.2, -20.1, -55.0, -15.3], placeholder: true },
  { id: 'amazon-arc', label: 'Amazon arc of deforestation', bbox: [-62.0, -12.0, -50.0, -5.0], placeholder: true },
];

export const findPreset = (id, presets = PRESETS) => presets.find((p) => p.id === id) ?? null;
