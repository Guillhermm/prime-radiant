import { h } from './h.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const PRESET_IDS = [
  { id: 'all', label: 'All' },
  { id: '10y', label: 'Last 10 years' },
  { id: 'year', label: 'This year' },
];

const toIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const fromIndex = (i) => `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
const clamp = (m, span) => (span ? (m < span.from ? span.from : m > span.to ? span.to : m) : m);

// Span {from, to} from a manifest: earliest sensor coverage start to the last month with data.
export const spanFromManifest = (m) => {
  const starts = Object.values(m?.coverage ?? {}).map((c) => c?.[0]).filter(Boolean).sort();
  return starts.length && m.last_month ? { from: starts[0], to: m.last_month } : null;
};

export const currentMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

// Returns { from, to } or null when the preset is unavailable (All without a span).
// All = the whole span. 10 y = the 120 months ending at the last available month.
// This year = the calendar year of min(now, span.to), clamped to the span.
export const presetRange = (id, span, now = new Date()) => {
  if (id === 'all') return span ? { from: span.from, to: span.to } : null;
  const end = span ? clamp(currentMonth(now), span) : currentMonth(now);
  if (id === '10y') return { from: clamp(fromIndex(toIndex(end) - 119), span), to: end };
  if (id === 'year') {
    const y = end.slice(0, 4);
    return { from: clamp(`${y}-01`, span), to: clamp(`${y}-12`, span) };
  }
  return null;
};

// Returns { from, to } with a message or null per field.
export const validateRange = (from, to, span = null) => {
  const out = { from: null, to: null };
  const check = (v, key) => {
    if (!v) out[key] = 'Required, use YYYY-MM';
    else if (!MONTH_RE.test(v)) out[key] = 'Use YYYY-MM';
    else if (span && (v < span.from || v > span.to)) out[key] = `Available span is ${span.from} to ${span.to}`;
  };
  check(from, 'from');
  check(to, 'to');
  if (!out.from && !out.to && from > to) {
    out.from = 'From must not be after To';
    out.to = 'To must not be before From';
  }
  return out;
};

export const mount = (container, { span = null, from = '', to = '', onChange = () => {}, now = () => new Date() } = {}) => {
  const msg = {
    from: h('p', { class: 'field-msg', id: 'date-from-msg' }),
    to: h('p', { class: 'field-msg', id: 'date-to-msg' }),
  };
  const input = (id, label, value) => h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, type: 'month', value, min: span?.from, max: span?.to, placeholder: 'YYYY-MM', 'aria-describedby': `${id}-msg` }));
  const fromWrap = input('date-from', 'From', from);
  const toWrap = input('date-to', 'To', to);
  const fromIn = fromWrap.querySelector('input');
  const toIn = toWrap.querySelector('input');
  fromWrap.append(msg.from);
  toWrap.append(msg.to);

  const refresh = () => {
    const errors = validateRange(fromIn.value, toIn.value, span);
    for (const k of ['from', 'to']) {
      const el = k === 'from' ? fromIn : toIn;
      msg[k].textContent = errors[k] ?? '';
      if (errors[k]) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
    onChange({ from: fromIn.value, to: toIn.value, errors, valid: !errors.from && !errors.to });
  };
  fromIn.addEventListener('input', refresh);
  toIn.addEventListener('input', refresh);

  const presets = h('div', { class: 'chips range-presets', role: 'group', 'aria-label': 'Date presets' },
    PRESET_IDS.map(({ id, label }) => {
      const r = presetRange(id, span, now());
      return h('button', {
        type: 'button', class: 'chip', disabled: !r,
        onclick: () => { fromIn.value = r.from; toIn.value = r.to; refresh(); },
      }, label);
    }));

  container.append(h('fieldset', { class: 'period' }, h('legend', {}, 'Period'), h('div', { class: 'date-range' }, fromWrap, toWrap), presets));
  refresh();
  return {
    set: (f, t) => { fromIn.value = f ?? ''; toIn.value = t ?? ''; refresh(); },
    get: () => ({ from: fromIn.value, to: toIn.value }),
  };
};
