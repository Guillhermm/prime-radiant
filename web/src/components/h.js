// Tiny DOM builder. Text always goes through textContent or text nodes, never innerHTML.
// A function under an `on*` key becomes a listener: as an attribute it would be stringified
// into an inline handler, which does nothing useful and which the CSP blocks.
export const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function' && key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (typeof value === 'function') throw new TypeError(`h: function given for attribute "${key}"`);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
};
