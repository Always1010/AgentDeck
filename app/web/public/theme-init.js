// Apply before the application bundle and first paint. Storage is optional.
(function () {
  var choice = 'system';
  try {
    var stored = JSON.parse(localStorage.getItem('theme') || 'null');
    if (stored === 'system' || stored === 'light' || stored === 'dark') choice = stored;
  } catch (_) { /* Use system preference if storage is blocked or invalid. */ }
  var dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
