import { h } from './h.js';
import { icon } from './icons.js';

/**
 * Chip state: hidden while online and the last data fetch did not fail on the network; "Offline ·
 * showing saved data" when something is on screen (served from the cache), "Offline" otherwise.
 */
export const offlineModel = ({ online, failed, hasData }) => {
  if (online && !failed) return null;
  return hasData ? { short: 'Offline', rest: ' · showing saved data' } : { short: 'Offline', rest: '' };
};

/**
 * mount(slot, {online}) renders a persistent role=status region in the top bar with the chip
 * inside, and follows the online and offline events. set({failed, hasData}) feeds it the data
 * source's state. Returns {set, state()}.
 */
export const mount = (slot, { online = navigator.onLine, events = globalThis } = {}) => {
  const short = h('span');
  const rest = h('span', { class: 'offline-rest' });
  const chip = h('span', { class: 'offline-chip', hidden: true }, icon('cloudOff'), short, rest);
  slot.replaceChildren(h('span', { class: 'offline-status', role: 'status' }, chip));
  let st = { online, failed: false, hasData: false };
  const paint = () => {
    const m = offlineModel(st);
    chip.hidden = !m;
    short.textContent = m?.short ?? '';
    rest.textContent = m?.rest ?? '';
  };
  const set = (patch) => { st = { ...st, ...patch }; paint(); };
  events.addEventListener?.('offline', () => set({ online: false }));
  events.addEventListener?.('online', () => set({ online: true, failed: false }));
  paint();
  return { set, state: () => st };
};
