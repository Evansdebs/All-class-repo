/* OneReal School Management System — Storage Sanitizer & Production Safeguard
 * Runs immediately on script parse before any other engine components.
 */
(function initStorageSanitizer() {
    'use strict';
    try {
        // 1. Prune bloated schoolDepartments if present in localStorage
        const rawDepts = localStorage.getItem('schoolDepartments');
        if (rawDepts) {
            try {
                const depts = JSON.parse(rawDepts);
                if (Array.isArray(depts) && depts.length > 10) {
                    const unique = [];
                    const seen = new Set();
                    depts.forEach(d => {
                        const name = (d && (d.name || d.id || '')) .trim();
                        if (name && !seen.has(name.toLowerCase())) {
                            seen.add(name.toLowerCase());
                            unique.push({
                                id: d.id || ('dept_' + name.toLowerCase().replace(/\s+/g, '_')),
                                name: name,
                                gradingType: d.gradingType || (name.toLowerCase().includes('jhs') ? 'jhs' : 'primary')
                            });
                        }
                    });
                    if (!unique.length) {
                        unique.push({ id: 'dept_primary', name: 'PRIMARY', gradingType: 'primary' }, { id: 'dept_jhs', name: 'JHS', gradingType: 'jhs' });
                    }
                    localStorage.setItem('schoolDepartments', JSON.stringify(unique));
                    console.log('[OneReal] Pruned bloated schoolDepartments from localStorage (kept ' + unique.length + ' unique).');
                }
            } catch (err) {
                localStorage.removeItem('schoolDepartments');
            }
        }

        // 2. Clear obsolete Service Worker caches on clients
        if (typeof caches !== 'undefined' && caches.keys) {
            caches.keys().then(keys => {
                keys.forEach(k => {
                    if (k && !k.includes('v3.2')) {
                        caches.delete(k).catch(() => {});
                    }
                });
            }).catch(() => {});
        }
    } catch (e) {
        console.warn('Storage sanitizer notice:', e);
    }
})();
