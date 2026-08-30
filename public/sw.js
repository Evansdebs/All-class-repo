// OneReal School Management System - Service Worker
const CACHE_NAME = 'onereal-sms-v2.4';
const OFFLINE_URL = '/offline.html';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/report.html',
    '/admin.html',
    '/student.html',
    '/alumni.html',
    '/timetable.html',
    '/excel.html',
    '/offline.html',
    '/admin.css',
    '/report.css',
    '/font-awesome.css',
    '/jspdf.umd.min.js',
    '/jszip.min.js',
    '/chart.umd.js',
    '/manifest.json',
    '/fa-solid-900.woff2',
    '/fa-regular-400.woff2',
    '/fa-brands-400.woff2'
];

// Install: pre-cache critical assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[SW] Some static assets failed to pre-cache:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: cleanup stale caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Clearing obsolete cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch strategy:
// 1. Static HTML/CSS/JS/Fonts -> Stale-While-Revalidate with offline fallback
// 2. API GET -> Network-First, caching successful responses for offline reading
// 3. Mutation API (POST/PUT/DELETE) -> Direct network, client-side IndexedDB/localStorage fallback
self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    // Skip cross-origin non-GET requests or browser extensions
    if (!url.protocol.startsWith('http')) return;

    // Handle API requests
    if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET') {
            event.respondWith(
                fetch(req)
                    .then(networkRes => {
                        if (networkRes && networkRes.status === 200) {
                            const resClone = networkRes.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
                        }
                        return networkRes;
                    })
                    .catch(() => {
                        return caches.match(req).then(cached => {
                            if (cached) return cached;
                            return new Response(JSON.stringify({ offline: true, error: 'Offline cached data unavailable for this endpoint' }), {
                                status: 503,
                                headers: { 'Content-Type': 'application/json; charset=UTF-8' }
                            });
                        });
                    })
            );
            return;
        }
        // Non-GET API calls pass through to network
        return;
    }

    // Handle navigation & static pages
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(networkRes => {
                    const resClone = networkRes.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
                    return networkRes;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    if (cached) return cached;
                    const offlinePage = await caches.match(OFFLINE_URL);
                    return offlinePage || new Response('Offline - No connection available', { status: 503, headers: { 'Content-Type': 'text/plain' } });
                })
        );
        return;
    }

    // Static Assets: Stale-While-Revalidate
    event.respondWith(
        caches.match(req).then(cached => {
            const fetchPromise = fetch(req)
                .then(networkRes => {
                    if (networkRes && networkRes.status === 200) {
                        const resClone = networkRes.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
                    }
                    return networkRes;
                })
                .catch(err => {
                    // Ignore network error if we have cache
                    return cached;
                });

            return cached || fetchPromise;
        })
    );
});

// Offline background sync event handler
self.addEventListener('sync', event => {
    if (event.tag === 'onereal-offline-sync') {
        console.log('[SW] Background sync triggered');
    }
});
