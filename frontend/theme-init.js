// Set the saved theme before the page paints. app.js keeps it in sync later.
(() => {
  let preference = 'system';
  try {
    preference = localStorage.getItem('appThemePreference') || 'system';
  } catch (_) {
    // Storage can be unavailable in a restricted browser context.
  }
  if (!['light', 'dark', 'system'].includes(preference)) preference = 'system';
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  const mode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.bsTheme = mode;
  root.dataset.themePreference = preference;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = mode;
})();
