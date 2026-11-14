import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST, pausableTimer } from './toast.js';

const fakeClock = () => {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, at: t + ms }); return seq; },
    clearTimeout: (id) => timers.delete(id),
    advance: (ms) => {
      t += ms;
      for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); }
    },
  };
};

test('timer fires after its duration', () => {
  const c = fakeClock();
  let done = 0;
  pausableTimer(1000, () => { done += 1; }, c);
  c.advance(999);
  assert.equal(done, 0);
  c.advance(1);
  assert.equal(done, 1);
});

test('pause keeps the time left; resume runs only the rest', () => {
  const c = fakeClock();
  let done = 0;
  const t = pausableTimer(1000, () => { done += 1; }, c);
  c.advance(400);
  t.pause();
  assert.equal(t.left(), 600);
  c.advance(5000);
  assert.equal(done, 0, 'nothing fires while paused (hover or focus)');
  t.resume();
  c.advance(599);
  assert.equal(done, 0);
  c.advance(1);
  assert.equal(done, 1);
});

test('pause and resume are idempotent, cancel stops it for good', () => {
  const c = fakeClock();
  let done = 0;
  const t = pausableTimer(1000, () => { done += 1; }, c);
  t.pause(); t.pause();
  t.resume(); t.resume();
  c.advance(1000);
  assert.equal(done, 1);
  const u = pausableTimer(1000, () => { done += 1; }, c);
  u.cancel();
  u.resume();
  c.advance(2000);
  assert.equal(done, 1);
  assert.equal(u.left(), 0);
});

test('errors stay longer than confirmations', () => {
  assert.ok(TOAST.error > TOAST.success);
});
