import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED, RAMPS, SEPARATION_FLOOR, colorOf, contrast, deltaE, evaluate, lightness, loadThemes, simulate } from './contrast.mjs';

const themes = loadThemes();

test('contrast matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
});

test('colorOf composites alpha over the given ground and rejects unknown tokens', () => {
  assert.equal(colorOf({ x: 'rgb(255 255 255 / 0.5)' }, 'x', '#000000'), '#808080');
  assert.equal(colorOf({ x: 'transparent' }, 'x', '#123456'), '#123456');
  assert.throws(() => colorOf({}, 'nope', '#000000'), /unknown token/);
});

for (const name of ['dark', 'light']) {
  test(`every required pair passes in the ${name} theme`, () => {
    const result = evaluate(themes[name]);
    assert.equal(result.required.length, REQUIRED.length);
    const failing = result.required.filter((r) => !r.pass).map((r) => `${r.fg} on ${r.back}: ${r.ratio.toFixed(2)} < ${r.min}`);
    assert.deepEqual(failing, []);
  });
}

test('the dark density ramp keeps lightness strictly increasing and neighbors separable under color vision deficiency', () => {
  const { lightness: l, separation } = evaluate(themes.dark).ramps.density;
  l.slice(1).forEach((v, i) => assert.ok(v > l[i], `bin ${i + 1} is lighter than bin ${i}`));
  for (const [kind, min] of Object.entries(separation)) assert.ok(min >= SEPARATION_FLOOR, `${kind}: ${min.toFixed(1)}`);
});

test('both diverging ramps stay separable for every deficiency', () => {
  for (const name of ['dark', 'light']) {
    for (const [kind, min] of Object.entries(evaluate(themes[name]).ramps.anomaly.separation)) assert.ok(min >= SEPARATION_FLOOR, `${name} ${kind}: ${min.toFixed(1)}`);
  }
});

test('the dark diverging ramp is symmetric around a dark median', () => {
  const { lightness: l } = evaluate(themes.dark).ramps.anomaly;
  assert.equal(l.length, RAMPS.anomaly.length);
  const center = l[5];
  assert.ok(l.every((v, i) => i === 5 || v > center));
  for (let k = 1; k <= 5; k++) assert.ok(Math.abs(l[5 - k] - l[5 + k]) < 2, `step ${k}`);
});

test('the lowest dark density class is visible against the panel', () => {
  assert.ok(contrast(colorOf(themes.dark, 'bin-0', '#000000'), colorOf(themes.dark, 'color-surface', '#000000')) >= 1.6);
});

test('color vision simulation leaves neutrals alone and distance is symmetric', () => {
  assert.ok(deltaE('#808080', simulate('#808080', 'protanopia')) < 2);
  assert.equal(deltaE('#336699', '#99cc33'), deltaE('#99cc33', '#336699'));
  assert.ok(lightness('#ffffff') > 99 && lightness('#000000') < 1);
});
