// Classic script in <head> so the saved theme is on <html> before first paint (a module would be
// deferred and flash). Keep the key and values in step with src/theme.js; theme.test.js checks it.
(function () {
  try {
    var t = localStorage.getItem('pr-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system */ }
})();
