/* OneReal School Management System — Production Mode
 * Seed is disabled. This file only ensures any old demo/seed data
 * is cleared from localStorage on first load.
 */
(function clearOldSeedData() {
    'use strict';
    var PROD_VERSION = '2026-prod-v1';
    try {
        if (localStorage.getItem('onerealSeedVersion') === PROD_VERSION) return;

        // Clear ALL cached collections so the app starts clean
        var keysToWipe = [
            'students', 'teachers', 'users', 'classes', 'subjects',
            'academicYears', 'terms', 'gradingScales', 'results', 'reports',
            'scores', 'studentReportDetails', 'parentContacts',
            'attendanceMarks', 'attendanceSettings', 'auditLogs',
            'activeGradingScale', 'activeAcademicYear', 'activeTerm',
            'schoolSettings', 'schoolInfo',
            // Legacy seed keys
            'onerealSeedVersion', 'seedVersion', 'demoData'
        ];
        keysToWipe.forEach(function (key) {
            try { localStorage.removeItem(key); } catch (e) {}
        });

        // Stamp the production version so this only runs once
        localStorage.setItem('onerealSeedVersion', PROD_VERSION);
        console.log('[OneReal] Production mode — localStorage cleared. Ready for real data.');
    } catch (e) {}
})();
