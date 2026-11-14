import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxDecimal, nextItem, shareItems } from './share-menu.js';

test('share items: link and decimal coordinates for an area, nothing without one', () => {
  assert.deepEqual(shareItems(null, 'https://x/#'), []);
  const items = shareItems([-58.2, -20.1, -55, -15.3], 'https://x/#aoi=bbox:-58.2,-20.1,-55,-15.3');
  assert.deepEqual(items.map((i) => i.id), ['link', 'coords']);
  assert.equal(items[0].text, 'https://x/#aoi=bbox:-58.2,-20.1,-55,-15.3');
  assert.equal(items[1].text, '-58.2,-20.1,-55,-15.3');
  assert.match(items[1].done, /west, south, east, north/);
  assert.equal(bboxDecimal([1, 2, 3, 4]), '1,2,3,4');
});

test('menu keys wrap with the arrows, jump with Home and End, ignore the rest', () => {
  assert.equal(nextItem('ArrowDown', 1, 2), 0);
  assert.equal(nextItem('ArrowUp', 0, 2), 1);
  assert.equal(nextItem('Home', 1, 2), 0);
  assert.equal(nextItem('End', 0, 2), 1);
  assert.equal(nextItem('ArrowDown', -1, 2), 0, 'from outside the menu, down goes to the first item');
  assert.equal(nextItem('a', 0, 2), null);
});
