/* OneReal School Management System — Service Worker Retirement
 * This service worker immediately unregisters itself and clears all caches.
 * The app is Firebase-only and does not use offline caching.
 */
self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(k) {
                return caches.delete(k);
            }));
        }).then(function() {
            return self.clients.claim();
        }).then(function() {
            // Unregister self so this worker never runs again
            return self.registration.unregister();
        })
    );
});

// Pass all fetch requests straight through — no caching at all
self.addEventListener('fetch', function(event) {
    event.respondWith(fetch(event.request));
});
