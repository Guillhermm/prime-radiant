import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h } from './h.js';

// Just enough of a DOM element to observe what h does with each attribute.
const fakeDocument = () => ({
  createElement: (tag) => ({
    tag, attrs: {}, listeners: {}, children: [], className: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    append(c) { this.children.push(c); },
  }),
});

test('h binds on* functions as listeners, not attributes', () => {
  globalThis.document = fakeDocument();
  const fn = () => {};
  const node = h('button', { onclick: fn, type: 'button' }, 'Go');
  assert.equal(node.listeners.click, fn);
  assert.equal('onclick' in node.attrs, false);
  assert.equal(node.attrs.type, 'button');
  assert.deepEqual(node.children, ['Go']);
});

test('h skips null, undefined and false, and maps true to an empty attribute', () => {
  globalThis.document = fakeDocument();
  const node = h('input', { a: null, b: undefined, c: false, disabled: true, class: 'x', text: 't' });
  assert.deepEqual(node.attrs, { disabled: '' });
  assert.equal(node.className, 'x');
  assert.equal(node.textContent, 't');
});

test('h rejects a function under a non-event key', () => {
  globalThis.document = fakeDocument();
  assert.throws(() => h('div', { title: () => {} }), TypeError);
});
