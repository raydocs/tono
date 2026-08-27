// Runs before first paint so a dark-theme operator never sees a light flash.
// External rather than inline: the /ops CSP is script-src 'self'.
(() => {
  let saved = 'system';
  try {
    saved = localStorage.getItem('tono-ops-theme') || 'system';
  } catch {
    // Blocked storage falls back to the system preference.
  }
  const dark = saved === 'dark' || (saved === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('#color-scheme');
  if (meta) meta.content = dark ? 'dark' : 'light';
})();
