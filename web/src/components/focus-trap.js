export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index to focus when Tab (or Shift+Tab) leaves the end of a trap of `count` items. */
export const trapIndex = (count, current, shift) => {
  if (count === 0) return -1;
  if (shift) return current <= 0 ? count - 1 : current - 1;
  return current >= count - 1 ? 0 : current + 1;
};

/** keydown handler body: keeps Tab inside `root`. Hidden controls are skipped. */
export const trapTab = (ev, root) => {
  if (ev.key !== 'Tab') return;
  const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  const next = trapIndex(items.length, items.indexOf(document.activeElement), ev.shiftKey);
  if (next < 0) return;
  ev.preventDefault();
  items[next].focus();
};
