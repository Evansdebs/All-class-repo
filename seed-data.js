/* OneReal School Management System — Firebase-Only Boot Script
 * Clears ALL local cache on every load. Firestore is the only source of truth.
 */
(function firebaseOnlyBoot() {
    'use strict';
    try {
        // Wipe ALL localStorage so no stale or phantom credentials can survive
        localStorage.clear();

        // Unregister any lingering service workers (offline cache must not serve stale data)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(registrations) {
                registrations.forEach(function(reg) {
                    reg.unregister();
                    console.log('[OneReal] Unregistered service worker:', reg.scope);
                });
            }).catch(function() {});
        }

        // Delete all browser caches so no old JS/HTML is served from cache
        if (typeof caches !== 'undefined' && caches.keys) {
            caches.keys().then(function(keys) {
                keys.forEach(function(k) {
                    caches.delete(k).catch(function() {});
                });
                if (keys.length) {
                    console.log('[OneReal] Cleared ' + keys.length + ' cache(s). App is Firebase-only.');
                }
            }).catch(function() {});
        }
    } catch (e) {
        // Silent fail — never block app startup
    }
})();
