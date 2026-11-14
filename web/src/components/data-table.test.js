import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableModel } from './data-table.js';

test('keeps the spec and defaults', () => {
  const m = tableModel({ caption: 'c', columns: ['a', 'b'], rows: [{ header: 'r', cells: ['1', '2'] }] });
  assert.equal(m.corner, '');
  assert.deepEqual(m.notes, []);
  assert.equal(m.rows[0].header, 'r');
});

test('rejects a row with the wrong cell count', () => {
  assert.throws(() => tableModel({ caption: 'c', columns: ['a'], rows: [{ header: 'r', cells: ['1', '2'] }] }), RangeError);
});
