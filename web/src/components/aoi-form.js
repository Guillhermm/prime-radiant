import { validateBbox } from '../state.js';
import { PRESETS } from '../presets.js';
import { h } from './h.js';

export const FIELDS = [
  { key: 'south', label: 'South', hint: 'latitude' },
  { key: 'west', label: 'West', hint: 'longitude' },
  { key: 'north', label: 'North', hint: 'latitude' },
  { key: 'east', label: 'East', hint: 'longitude' },
];
const NUM_RE = /^-?\d+([.,]\d+)?$/;
const LIMITS = { south: 90, north: 90, west: 180, east: 180 };

export const bboxToInputs = (bbox) => (bbox
  ? { west: String(bbox[0]), south: String(bbox[1]), east: String(bbox[2]), north: String(bbox[3]) }
  : { west: '', south: '', east: '', north: '' });

// inputs: strings by key. Returns { bbox, errors } where errors maps a field key (or 'bbox' for
// the combined rule) to a message; bbox is null unless everything is valid. A decimal comma is
// accepted. Per-field problems win over the combined message from state.validateBbox.
export const parseBboxInputs = (inputs, { maxAreaDeg2 = Infinity } = {}) => {
  const errors = {};
  const nums = {};
  for (const { key } of FIELDS) {
    const raw = String(inputs[key] ?? '').trim();
    if (!raw) errors[key] = 'Required';
    else if (!NUM_RE.test(raw)) errors[key] = 'Enter a number, for example -15.3';
    else {
      nums[key] = Number(raw.replace(',', '.'));
      if (Math.abs(nums[key]) > LIMITS[key]) errors[key] = `Must be between -${LIMITS[key]} and ${LIMITS[key]}`;
    }
  }
  if (Object.keys(errors).length) return { bbox: null, errors };
  const bbox = [nums.west, nums.south, nums.east, nums.north];
  const reason = validateBbox(bbox, { maxAreaDeg2 });
  if (reason) return { bbox: null, errors: { bbox: reason } };
  return { bbox, errors };
};

export const mountPresets = (container, { presets = PRESETS, onPick }) => {
  const group = h('div', { class: 'chips', role: 'group', 'aria-label': 'Example areas' },
    presets.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => onPick(p) }, p.label)));
  container.append(group);
  return group;
};

export const mount = (container, { bbox = null, maxAreaDeg2 = Infinity, presets = PRESETS, onChange = () => {}, onPreset = () => {} } = {}) => {
  const initial = bboxToInputs(bbox);
  const inputs = {};
  const msgs = {};
  const row = h('div', { class: 'aoi-fields' });
  for (const { key, label, hint } of FIELDS) {
    inputs[key] = h('input', { id: `aoi-${key}`, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: initial[key], 'aria-describedby': `aoi-${key}-msg aoi-bbox-msg` });
    msgs[key] = h('p', { class: 'field-msg', id: `aoi-${key}-msg` });
    row.append(h('div', { class: 'field' }, h('label', { for: `aoi-${key}` }, label, h('span', { class: 'hint' }, ` (${hint})`)), inputs[key], msgs[key]));
  }
  const bboxMsg = h('p', { class: 'field-msg', id: 'aoi-bbox-msg' });

  const refresh = () => {
    const values = Object.fromEntries(FIELDS.map(({ key }) => [key, inputs[key].value]));
    const touched = FIELDS.some(({ key }) => values[key].trim());
    const { bbox: parsed, errors } = parseBboxInputs(values, { maxAreaDeg2 });
    // An untouched form is "incomplete", not "wrong": no messages until the user types.
    for (const { key } of FIELDS) {
      msgs[key].textContent = touched ? errors[key] ?? '' : '';
      if (touched && errors[key]) inputs[key].setAttribute('aria-invalid', 'true');
      else inputs[key].removeAttribute('aria-invalid');
    }
    bboxMsg.textContent = touched ? errors.bbox ?? '' : '';
    onChange({ bbox: parsed, errors, valid: parsed !== null });
  };
  for (const { key } of FIELDS) inputs[key].addEventListener('input', refresh);

  const presetBox = h('div', { class: 'presets' }, h('span', { class: 'label' }, 'Example areas'));
  mountPresets(presetBox, {
    presets,
    onPick: (p) => {
      const v = bboxToInputs(p.bbox);
      for (const { key } of FIELDS) inputs[key].value = v[key];
      refresh();
      onPreset(p);
    },
  });

  container.append(h('fieldset', { class: 'aoi' }, h('legend', {}, 'Area'), row, bboxMsg, presetBox));
  refresh();
  return {
    set(b) {
      const v = bboxToInputs(b);
      for (const { key } of FIELDS) inputs[key].value = v[key];
      refresh();
    },
    focus: () => inputs.south.focus(),
  };
};
