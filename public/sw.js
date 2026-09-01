// One-time recovery worker. It removes cached releases that referenced the
// retired custom domain, then unregisters itself so future pages are served
// directly from the live host.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
      .then(() => self.registration.unregister())
  );
});
