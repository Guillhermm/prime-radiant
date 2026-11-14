import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_IDS, tabsModel, nextTabIndex, viewTitle } from './app-shell.js';
import { VIEWS } from '../views.js';

test('disabled views are absent from the tabs', () => {
  assert.deepEqual(tabsModel(VIEWS, 'sensors').map((t) => [t.id, t.selected]), [['calendar', false], ['sensors', true]]);
});

test('tab keys wrap and ignore others', () => {
  assert.equal(nextTabIndex('ArrowRight', 1, 2), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 2), 1);
  assert.equal(nextTabIndex('Home', 1, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('a', 0, 2), null);
  assert.equal(nextTabIndex('Home', 0, 0), null);
});

test('title names the view', () => {
  assert.equal(viewTitle(VIEWS, 'calendar'), 'Calendar - Prime Radiant');
  assert.equal(viewTitle(VIEWS, 'live'), 'Prime Radiant');
});

test('the shell has a result group for every view', () => {
  assert.deepEqual(GROUP_IDS, VIEWS.map((v) => v.id));
});
