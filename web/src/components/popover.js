/**
 * One way to run a [popover] element whether or not the browser has the Popover API.
 * Invokers carry `popovertarget`; with the API the browser opens, light-dismisses and closes on
 * Escape. Without it this toggles `hidden` and adds the same Escape and outside-click behavior.
 * onOpen(opener) runs as it opens, onClose(opener) after it closes. closeOnScroll closes it when the
 * page scrolls, for popovers placed at fixed coordinates. Returns {hide, isOpen}.
 */
export const popover = (pop, invokers, { onOpen: opened, onClose: closed, closeOnScroll = false } = {}) => {
  // Scroll events are dispatched in the next frame, so the scroll that brought the button into view
  // (or focusing an item) would close the popover it just opened: listen from the next frame on.
  let frame = 0;
  const onScroll = () => hideIt();
  const onOpen = (b) => {
    opened?.(b);
    if (closeOnScroll) frame = requestAnimationFrame(() => addEventListener('scroll', onScroll, { passive: true }));
  };
  const onClose = (b) => {
    cancelAnimationFrame(frame);
    removeEventListener('scroll', onScroll);
    closed?.(b);
  };
  let hideIt = () => {};
  let opener = invokers[0];
  // Registered before any other click listener, and click runs before popovertarget activation.
  invokers.forEach((b) => b.addEventListener('click', () => { opener = b; }));
  const setExpanded = (on) => invokers.forEach((b) => b.setAttribute('aria-expanded', String(on && b === opener)));
  setExpanded(false);

  if (typeof pop.showPopover === 'function') {
    // beforetoggle is synchronous on open; toggle is queued.
    pop.addEventListener('beforetoggle', (e) => { if (e.newState === 'open') { setExpanded(true); onOpen?.(opener); } });
    pop.addEventListener('toggle', (e) => { if (e.newState === 'closed') { setExpanded(false); onClose?.(opener); } });
    hideIt = () => { if (pop.matches(':popover-open')) pop.hidePopover(); };
    return {
      hide: hideIt,
      isOpen: () => pop.matches(':popover-open'),
    };
  }

  // The attributes are inert without the API; dropping them keeps a half-supporting browser from
  // running both behaviors at once.
  pop.removeAttribute('popover');
  invokers.forEach((b) => b.removeAttribute('popovertarget'));
  pop.hidden = true;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); } };
  const onDown = (e) => { if (!pop.contains(e.target) && !invokers.some((b) => b.contains(e.target))) hide(); };
  const hide = () => {
    if (pop.hidden) return;
    pop.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    setExpanded(false);
    onClose?.(opener);
  };
  const show = () => {
    pop.hidden = false;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    setExpanded(true);
    onOpen?.(opener);
  };
  hideIt = hide;
  invokers.forEach((b) => b.addEventListener('click', () => (pop.hidden ? show() : hide())));
  return { hide, isOpen: () => !pop.hidden };
};

/**
 * Focus goes back to the button that opened a popover, unless the user already moved it somewhere
 * else (clicked a link, opened the drawer).
 */
export const restoreFocus = (pop, opener) => {
  const at = document.activeElement;
  if (opener?.isConnected && (!at || at === document.body || pop.contains(at))) opener.focus({ preventScroll: true });
};
