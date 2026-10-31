// Apply the saved theme before first paint (external file to satisfy the CSP).
(function () {
  try {
    var t = localStorage.getItem('nodara.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
