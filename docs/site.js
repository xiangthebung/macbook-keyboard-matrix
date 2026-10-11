// Use the same appearance preference on every page of the site.
(function () {
  function applyTheme() {
    try {
      var prefs = JSON.parse(localStorage.getItem('keychord.learning.v2') || '{}').preferences || {};
      if (prefs.theme === 'light' || prefs.theme === 'dark') document.documentElement.dataset.theme = prefs.theme;
      else delete document.documentElement.dataset.theme;
    } catch (_) { /* System appearance works without storage. */ }
  }
  applyTheme();
  window.addEventListener('storage', applyTheme);
})();
