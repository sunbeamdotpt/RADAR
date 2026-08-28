/**
 * Shared theme toggle markup and scripts for the RADAR HTML pages.
 *
 * The pages support a `beam-dark` (default) and `beam-light` theme. The user's
 * choice is persisted in `localStorage` under the key `radar-theme` and applied
 * before the first paint to avoid a flash of the wrong theme.
 */

/** Inline script that must run in the `<head>` to set the theme before paint. */
export function themeInitScript(): string {
  return `<script>(function(){try{var t=localStorage.getItem('radar-theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){}})();</script>`;
}

/** Theme toggle button placed in the header next to the Grafana link. */
export function themeToggleButton(): string {
  return `<button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle light and dark theme">
  <svg id="theme-icon" class="theme-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>
</button>`;
}

/**
 * Client-side script that wires the toggle button. Must be included once near
 * the end of the document body.
 */
export function themeToggleScript(): string {
  return `<script>
(function(){
  const toggle = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  if (!toggle || !icon) return;
  const sunIcon = '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  const moonIcon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    icon.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
    toggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    try { localStorage.setItem('radar-theme', theme); } catch (e) {}
  }
  apply(document.documentElement.dataset.theme || 'dark');
  toggle.addEventListener('click', function() {
    apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
})();
</script>`;
}
