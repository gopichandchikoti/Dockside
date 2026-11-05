// Applies the saved theme/motion preference before first paint to avoid a flash. Kept external for the strict CSP.
(function () {
  try {
    var raw = window.localStorage.getItem('dockside.prefs.v1');
    var prefs = raw ? JSON.parse(raw) : {};
    var root = document.documentElement;
    if (prefs.theme === 'light' || prefs.theme === 'dark') root.setAttribute('data-theme', prefs.theme);
    if (prefs.motion === 'reduce' || prefs.motion === 'allow') root.setAttribute('data-motion', prefs.motion);
  } catch {
    /* storage unavailable: fall back to system preferences */
  }
})();
