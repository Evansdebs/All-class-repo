/**
 * OneReal School Management System — PWA Offline Engine & Sync Controller
 * Handles Service Worker registration, offline state monitoring, mutation queue, and snapshot export.
 */

(function() {
    'use strict';

    const QUEUE_KEY = 'onereal_offline_mutation_queue_v1';
    const CACHE_DB_KEY = 'onereal_offline_cached_db_v1';

    // ── 1. Register Service Worker ─────────────────────────────────────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => {
                    console.log('[PWA] Service Worker registered with scope:', reg.scope);
                })
                .catch(err => {
                    console.warn('[PWA] Service Worker registration failed:', err);
                });
        });
    }

    // ── 2. Offline Banner / Status Indicator ──────────────────────────────────
    function createOfflineBanner() {
        if (document.getElementById('onereal-offline-status-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'onereal-offline-status-bar';
        bar.style.cssText = `
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 99999;
            background: #1e293b;
            color: #f8fafc;
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 10px 16px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            transform: translateY(100px);
            opacity: 0;
            pointer-events: auto;
        `;
        bar.innerHTML = `
            <span id="onereal-offline-dot" style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; display: inline-block;"></span>
            <span id="onereal-offline-text">Online & Synced</span>
            <span id="onereal-queue-badge" style="display:none; background: #3b82f6; color: white; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 700;">0</span>
            <button id="onereal-sync-now-btn" style="display:none; background: #2563eb; color: white; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; font-weight: 600; margin-left: 4px;">Sync</button>
        `;
        document.body.appendChild(bar);

        const syncBtn = document.getElementById('onereal-sync-now-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.OneRealSync.processQueue();
            });
        }
    }

    function updateConnectionStatus() {
        const bar = document.getElementById('onereal-offline-status-bar');
        const dot = document.getElementById('onereal-offline-dot');
        const text = document.getElementById('onereal-offline-text');
        const badge = document.getElementById('onereal-queue-badge');
        const syncBtn = document.getElementById('onereal-sync-now-btn');
        if (!bar || !dot || !text) return;

        const queue = getQueue();
        const isOnline = navigator.onLine;

        if (queue.length > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = `${queue.length} pending`;
            syncBtn.style.display = isOnline ? 'inline-block' : 'none';
        } else {
            badge.style.display = 'none';
            syncBtn.style.display = 'none';
        }

        if (!isOnline) {
            bar.style.transform = 'translateY(0)';
            bar.style.opacity = '1';
            bar.style.borderColor = '#f59e0b';
            dot.style.background = '#f59e0b';
            text.textContent = 'Offline Mode Active';
        } else if (queue.length > 0) {
            bar.style.transform = 'translateY(0)';
            bar.style.opacity = '1';
            bar.style.borderColor = '#3b82f6';
            dot.style.background = '#3b82f6';
            text.textContent = 'Back Online — Syncing...';
            window.OneRealSync.processQueue();
        } else {
            // briefly show online then tuck away
            dot.style.background = '#22c55e';
            text.textContent = 'Cloud Synchronized';
            setTimeout(() => {
                if (navigator.onLine && getQueue().length === 0) {
                    bar.style.transform = 'translateY(100px)';
                    bar.style.opacity = '0';
                }
            }, 3000);
        }
    }

    // ── 3. Queue Management ───────────────────────────────────────────────────
    function getQueue() {
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveQueue(q) {
        try {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
            updateConnectionStatus();
        } catch (e) {}
    }

    // ── 4. Global API ─────────────────────────────────────────────────────────
    window.OneRealSync = {
        isOnline() {
            return navigator.onLine;
        },

        getPendingQueue() {
            return getQueue();
        },

        enqueueMutation(url, method, payload, description = 'Offline change') {
            const queue = getQueue();
            const item = {
                id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
                url,
                method: method.toUpperCase(),
                payload,
                description,
                createdAt: new Date().toISOString()
            };
            queue.push(item);
            saveQueue(queue);
            console.log('[PWA Sync] Queued offline mutation:', item);
            return item;
        },

        async processQueue() {
            if (!navigator.onLine) return { synced: 0, remaining: getQueue().length };
            const queue = getQueue();
            if (queue.length === 0) return { synced: 0, remaining: 0 };

            let successCount = 0;
            const remaining = [];

            for (const item of queue) {
                try {
                    const res = await fetch(item.url, {
                        method: item.method,
                        headers: { 'Content-Type': 'application/json' },
                        body: item.payload ? JSON.stringify(item.payload) : undefined
                    });
                    if (res.ok) {
                        successCount++;
                    } else {
                        remaining.push(item);
                    }
                } catch (e) {
                    remaining.push(item);
                }
            }

            saveQueue(remaining);
            if (successCount > 0) {
                console.log(`[PWA Sync] Successfully synced ${successCount} offline actions.`);
            }
            updateConnectionStatus();
            return { synced: successCount, remaining: remaining.length };
        },

        // Take instant cloud snapshot
        async takeCloudSnapshot(note = '') {
            try {
                const res = await fetch('/api/backup/snapshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: note || 'One-click automated snapshot' })
                });
                const data = await res.json();
                return data;
            } catch (e) {
                console.error('[PWA Sync] Snapshot creation error:', e);
                return { success: false, error: e.message };
            }
        },

        // Export local JSON snapshot directly in browser
        async exportLocalSnapshotFile() {
            try {
                const res = await fetch('/api/export/backup');
                const blob = await res.blob();
                const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `onereal_school_backup_${now}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return true;
            } catch (e) {
                alert('Could not download snapshot: ' + e.message);
                return false;
            }
        }
    };

    // ── 5. Initialize DOM listeners ───────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            createOfflineBanner();
            updateConnectionStatus();
        });
    } else {
        createOfflineBanner();
        updateConnectionStatus();
    }

    window.addEventListener('online', () => {
        console.log('[PWA] Network status: ONLINE');
        updateConnectionStatus();
        window.OneRealSync.processQueue();
    });

    window.addEventListener('offline', () => {
        console.warn('[PWA] Network status: OFFLINE');
        updateConnectionStatus();
    });

})();
