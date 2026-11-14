import { h } from './h.js';
import { icon } from './icons.js';

export const TOAST = { success: 5000, error: 8000 };

/**
 * A countdown that can pause: `pause()` keeps the time left, `resume()` restarts it. `clock` is
 * injectable for tests ({setTimeout, clearTimeout, now}). Returns {pause, resume, cancel, left}.
 */
export const pausableTimer = (ms, onDone, clock = globalThis) => {
  const now = () => (clock.now ? clock.now() : Date.now());
  let left = ms;
  let started = now();
  let id = clock.setTimeout(onDone, left);
  let cancelled = false;
  return {
    pause: () => {
      if (id === null) return;
      clock.clearTimeout(id);
      id = null;
      left = Math.max(0, left - (now() - started));
    },
    resume: () => {
      if (id !== null || cancelled) return;
      started = now();
      id = clock.setTimeout(onDone, left);
    },
    cancel: () => { if (id !== null) clock.clearTimeout(id); id = null; left = 0; cancelled = true; },
    left: () => (id === null ? left : Math.max(0, left - (now() - started))),
  };
};

// Two live regions, created at startup (prepare) before any message, so screen readers announce
// what lands in them.
let host = null;
const regions = () => {
  if (host?.el.isConnected) return host;
  const status = h('div', { class: 'toast-region', role: 'status' });
  const alert = h('div', { class: 'toast-region', role: 'alert' });
  host = { el: h('div', { class: 'toast-host' }, status, alert), status, alert };
  document.body.append(host.el);
  return host;
};

/** Creates the live regions; call once at startup. */
export const prepare = () => { regions(); };

let current = null;

/**
 * Shows one toast at the bottom right (bottom center on phone), replacing any toast on screen.
 * kind 'error' goes to the alert region and stays longer. Hover or focus pauses the countdown and
 * its progress bar; the close button dismisses it. Returns {dismiss()}.
 */
export const show = (message, { kind = 'success', ms = TOAST[kind] ?? TOAST.success } = {}) => {
  const r = regions();
  current?.dismiss();
  const bar = h('span', { class: 'toast-bar', 'aria-hidden': 'true' });
  bar.style.setProperty('--toast-ms', `${ms}ms`);
  const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss' }, icon('close'));
  const el = h('div', { class: `toast toast-${kind}` },
    icon(kind === 'error' ? 'warning' : 'check', 'toast-icon'), h('span', { class: 'toast-msg', text: message }), close, bar);
  // Closing removes the focused button, so focus goes back where it came from instead of to <body>.
  let returnTo = null;
  const dismiss = () => {
    timer.cancel();
    const hadFocus = el.contains(document.activeElement);
    el.remove();
    if (hadFocus && returnTo?.isConnected) returnTo.focus();
    if (current?.el === el) current = null;
  };
  const timer = pausableTimer(ms, dismiss);
  const hold = () => { timer.pause(); el.classList.add('is-paused'); };
  const release = () => {
    if (el.matches(':hover') || el.contains(document.activeElement)) return;
    timer.resume();
    el.classList.remove('is-paused');
  };
  el.addEventListener('pointerenter', hold);
  el.addEventListener('pointerleave', release);
  el.addEventListener('focusin', (ev) => {
    if (!el.contains(ev.relatedTarget)) returnTo = ev.relatedTarget;
    hold();
  });
  el.addEventListener('focusout', () => setTimeout(release));
  close.addEventListener('click', dismiss);
  (kind === 'error' ? r.alert : r.status).replaceChildren(el);
  current = { el, dismiss };
  return { dismiss };
};
