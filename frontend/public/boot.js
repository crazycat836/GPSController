// Boot splash dismissal. Extracted from index.html so CSP can forbid
// inline scripts (`script-src 'self'`) without allowing `'unsafe-inline'`.
// Vite copies anything in /public/ to the build root unchanged.
(function () {
  var root = document.getElementById('root');
  if (!root) return;
  var obs = new MutationObserver(function () {
    if (root.childElementCount > 0) {
      var boot = document.getElementById('boot');
      if (boot) {
        boot.classList.add('hide');
        setTimeout(function () { boot.remove(); }, 400);
      }
      obs.disconnect();
    }
  });
  obs.observe(root, { childList: true, subtree: true });
})();
