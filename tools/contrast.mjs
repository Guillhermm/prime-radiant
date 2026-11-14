import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// WCAG 2.x contrast and a colorblind-separation check over web/styles/tokens.css.
// Run `node tools/contrast.mjs` to print the Markdown tables used in docs/ux.md.

const TOKENS = fileURLToPath(new URL('../web/styles/tokens.css', import.meta.url));

const block = (css, header) => {
  const start = css.indexOf(header);
  if (start < 0) throw new Error(`tokens.css has no block ${header}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
};

const declarations = (body) => Object.fromEntries(
  [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

/** Dark is the bare :root block, light is :root[data-theme="light"]; light inherits nothing it does not redefine. */
export const loadThemes = (css = readFileSync(TOKENS, 'utf8')) => {
  const dark = declarations(block(css, ':root {'));
  const light = { ...dark, ...declarations(block(css, ':root[data-theme="light"]')) };
  return { dark, light };
};

const HEX = /^#([0-9a-f]{6})$/i;
const RGBA = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/;

const toRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Resolves a token to a hex color; rgb() with alpha is composited over `under`, transparent resolves to `under`. */
export const colorOf = (theme, name, under) => {
  const v = theme[name];
  if (v === undefined) throw new Error(`unknown token --${name}`);
  if (v === 'transparent') return under;
  if (HEX.test(v)) return v.toLowerCase();
  const m = RGBA.exec(v);
  if (m) {
    const base = toRgb(under);
    const a = Number(m[4]);
    return toHex([1, 2, 3].map((i, k) => Number(m[i]) * a + base[k] * (1 - a)));
  }
  throw new Error(`--${name}: cannot read "${v}"`);
};

const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => { const [r, g, b] = toRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const lab = (hex) => {
  const [r, g, b] = toRgb(hex).map(lin);
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
};
export const lightness = (hex) => lab(hex)[0];
/** CIELAB distance (DeltaE 1976). */
export const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// Machado, Oliveira and Fernandes 2009, severity 1.0, on linear RGB.
const CVD = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export const simulate = (hex, kind) => {
  const c = toRgb(hex).map(lin);
  return toHex(CVD[kind].map((row) => {
    const v = Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  }));
};

/** Smallest DeltaE between neighbors of a ramp, for normal vision and each simulated deficiency. */
export const separation = (ramp) => {
  const min = (list) => Math.min(...list.slice(1).map((c, i) => deltaE(list[i], c)));
  return {
    normal: min(ramp),
    ...Object.fromEntries(Object.keys(CVD).map((k) => [k, min(ramp.map((c) => simulate(c, k)))])),
  };
};

/** Minimum adjacent DeltaE below which two ramp neighbors are treated as inseparable. */
export const SEPARATION_FLOOR = 10;

const BINS = [0, 1, 2, 3, 4, 5, 6].map((n) => `bin-${n}`);
const DIV = ['below-5', 'below-4', 'below-3', 'below-2', 'below-1', 'center', 'above-1', 'above-2', 'above-3', 'above-4', 'above-5'].map((n) => `div-${n}`);
export const RAMPS = { density: BINS, anomaly: DIV };

/** Required pairs: [foreground token, background token, minimum ratio, use]. */
export const REQUIRED = [
  ['color-text', 'color-bg', 4.5, 'body text on page'],
  ['color-text', 'color-surface', 4.5, 'text on panels'],
  ['color-text', 'color-surface-2', 4.5, 'text in inputs'],
  ['color-text-muted', 'color-surface', 4.5, 'secondary text on panels'],
  ['color-text-muted', 'color-bg', 4.5, 'secondary text on page'],
  ['color-text-muted', 'color-surface-2', 4.5, 'secondary text on inputs'],
  ['color-accent', 'color-surface', 4.5, 'links on panels'],
  ['color-accent', 'color-bg', 4.5, 'links on page'],
  ['color-accent-text', 'color-accent', 4.5, 'selected control text'],
  ['color-cta-text', 'color-cta', 4.5, 'primary button text'],
  ['color-focus', 'color-surface', 3, 'focus ring on panels'],
  ['color-focus', 'color-bg', 3, 'focus ring on page'],
  ['topbar-focus', 'topbar-bg', 3, 'focus ring in the top bar'],
  ['topbar-text', 'topbar-bg', 4.5, 'top bar text'],
  ['topbar-muted', 'topbar-bg', 4.5, 'top bar inactive tabs'],
  ['topbar-border', 'topbar-bg', 3, 'top bar button borders'],
  ['color-border-strong', 'color-surface', 3, 'control borders on panels'],
  ['color-border-strong', 'color-bg', 3, 'control borders on page'],
  ['color-warn', 'color-surface', 4.5, 'delta and flagged text'],
  ['color-error', 'color-surface', 4.5, 'error text'],
  ['color-error', 'color-error-bg', 4.5, 'error text on error box'],
  ['color-caveat-text', 'color-caveat-bg', 4.5, 'caveat strip text'],
  ['color-caveat-border', 'color-bg', 3, 'caveat strip edge'],
  ['color-badge-text', 'color-badge-bg', 4.5, 'preliminary badge'],
  ['color-fire', 'color-fire-soft', 4.5, 'above-median delta pill'],
  ['color-below', 'color-below-soft', 4.5, 'below-median delta pill'],
  ['color-below', 'color-surface', 4.5, 'below-median ratio in the panel'],
  ['color-synth-text', 'color-synth', 4.5, 'synthetic band text'],
  ['color-highlight', 'color-bg', 3, 'hero accent word (large text)'],
  ['color-text', 'color-raised', 4.5, 'selected segment text'],
  ['current', 'color-surface', 4.5, 'selected month and year labels'],
  ['bar-sel', 'color-surface', 3, 'selected year bar'],
  ['sensor-modis', 'color-surface', 3, 'MODIS bar and dot'],
  ['sensor-viirs', 'color-surface', 3, 'VIIRS bar and dot'],
  ['sensor-harm', 'color-surface', 3, 'harmonized core'],
  ...BINS.map((b) => [`${b}-text`, b, 4.5, `cell text, ${b}`]),
  ...DIV.map((d) => [`${d}-text`, d, 4.5, `cell text, ${d}`]),
  ['nodata-text', 'nodata-bg', 4.5, 'no-data cell text'],
  ['nodata-stripe', 'nodata-bg', 3, 'hatch stripe vs hatch ground'],
  ['series-modis', 'color-surface', 3, 'MODIS line'],
  ['series-viirs', 'color-surface', 3, 'VIIRS line'],
  ['series-harmonized', 'color-surface', 3, 'harmonized line'],
  ['series-live', 'color-surface', 3, 'live line'],
  ['series-era-line', 'color-surface', 3, 'median line'],
];

/** Pairs listed for information: data fills carry their meaning in the printed number as well. */
export const INFO = [
  ...BINS.map((b) => [b, 'color-surface', `swatch ${b} vs panel`]),
  ...DIV.map((d) => [d, 'color-surface', `swatch ${d} vs panel`]),
  ['cell-edge', 'color-surface', 'cell outline on panel'],
  ['nodata-bg', 'color-surface', 'no-data ground vs panel'],
];

export const evaluate = (theme) => {
  const bg = colorOf(theme, 'color-bg', '#000000');
  const ratio = (fg, back) => {
    const b = colorOf(theme, back, bg);
    return contrast(colorOf(theme, fg, b), b);
  };
  return {
    required: REQUIRED.map(([fg, back, min, use]) => ({ fg, back, min, use, ratio: ratio(fg, back), pass: ratio(fg, back) >= min })),
    info: INFO.map(([fg, back, use]) => ({ fg, back, use, ratio: ratio(fg, back) })),
    ramps: Object.fromEntries(Object.entries(RAMPS).map(([k, names]) => {
      const colors = names.map((n) => colorOf(theme, n, bg));
      return [k, { colors, lightness: colors.map(lightness), separation: separation(colors) }];
    })),
  };
};

const r2 = (n) => Math.round(n * 100) / 100;

export const report = () => {
  const { dark, light } = loadThemes();
  const d = evaluate(dark);
  const l = evaluate(light);
  const lines = ['| Pair (foreground on background) | Use | Min | Dark | Light |', '|---|---|---|---|---|'];
  d.required.forEach((row, i) => {
    const o = l.required[i];
    lines.push(`| \`${row.fg}\` on \`${row.back}\` | ${row.use} | ${row.min}:1 | ${r2(row.ratio)} ${row.pass ? 'pass' : 'FAIL'} | ${r2(o.ratio)} ${o.pass ? 'pass' : 'FAIL'} |`);
  });
  lines.push('', '| Pair (information only) | Use | Dark | Light |', '|---|---|---|---|');
  d.info.forEach((row, i) => lines.push(`| \`${row.fg}\` on \`${row.back}\` | ${row.use} | ${r2(row.ratio)} | ${r2(l.info[i].ratio)} |`));
  lines.push('', '| Ramp | Theme | Min adjacent DeltaE: normal | protanopia | deuteranopia | tritanopia | CIELAB L* |', '|---|---|---|---|---|---|---|');
  for (const [theme, e] of [['dark', d], ['light', l]]) {
    for (const [name, ramp] of Object.entries(e.ramps)) {
      const s = ramp.separation;
      lines.push(`| ${name} | ${theme} | ${r2(s.normal)} | ${r2(s.protanopia)} | ${r2(s.deuteranopia)} | ${r2(s.tritanopia)} | ${ramp.lightness.map((v) => Math.round(v)).join(', ')} |`);
    }
  }
  return lines.join('\n');
};

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(report());
