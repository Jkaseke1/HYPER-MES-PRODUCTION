export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    // GitHub Pages serves versioned Vite assets directly. A custom worker used
    // to auto-update and reload active screens, which could interrupt forms.
    // Remove retired workers once and let normal browser caching handle assets.
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch((error) => console.warn('[PWA] Legacy service worker cleanup failed:', error));
  }, { once: true });
}
