import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineModel } from './offline-chip.js';

test('offline chip: hidden online, says saved data only when something is on screen', () => {
  assert.equal(offlineModel({ online: true, failed: false, hasData: true }), null);
  assert.deepEqual(offlineModel({ online: false, failed: false, hasData: true }), { short: 'Offline', rest: ' · showing saved data' });
  assert.deepEqual(offlineModel({ online: false, failed: false, hasData: false }), { short: 'Offline', rest: '' });
  assert.deepEqual(offlineModel({ online: true, failed: true, hasData: false }), { short: 'Offline', rest: '' }, 'a network failure shows it even when the browser claims to be online');
});
