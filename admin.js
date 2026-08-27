// ============================================================================
// OneReal School Admin Dashboard — admin.js
// ============================================================================

'use strict';

// Safe localStorage JSON parser to guard against malformed data
function safeLocalGet(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        console.warn(`[LocalStore] Failed parsing key "${key}":`, e.message);
        return fallback;
    }
}

// ─── State ──────────────────────────────────────────────────────────────────
let adminState = {
    students:      [],
    teachers:      [],
    classes:       [],
    subjects:      [],
    academicYears: [],
    terms:         [],
    results:       [],
    reports:       [],
    gradingScales: [],
    auditLogs:     [],
    settings:      {},

    // Pagination
    studentPage: 1,  studentsPerPage: 20,
    resultPage:  1,  resultsPerPage:  20,
    auditPage:   1,  auditPerPage:    30,

    // Pending import
    importCollection: null,
    importData:       [],

    // Charts
    charts: {},

    // Currently editing IDs
    editingStudent: null,
    editingTeacher: null,
    editingClass:   null,
    editingSubject: null,
    editingGrading: null,
};

// Report field toggles definition
const REPORT_FIELD_TOGGLES = [
    { key: 'showStudentPhoto',      label: 'Student Photo' },
    { key: 'showAttendance',        label: 'Attendance' },
    { key: 'showPosition',          label: 'Class Position' },
    { key: 'showClassTeacherRemark',label: "Class Teacher's Remark" },
    { key: 'showHeadteacherRemark', label: "Headteacher's Remark" },
    { key: 'showGradingTable',      label: 'Grading Key Table' },
    { key: 'showConduct',           label: 'Conduct & Interest' },
    { key: 'showPromotionStatus',   label: 'Promotion Status' },
    { key: 'showNextTerm',          label: 'Next Term Info (Closing/Reopening)' },
    { key: 'showSchoolLogo',        label: 'School Logo' },
    { key: 'showSignature',         label: "Headteacher's Signature" },
    { key: 'showSchoolMotto',       label: 'School Motto' },
    { key: 'showNumberOnRoll',      label: 'Number on Roll' },
];

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initFirebase();

    // Check existing active local session first to persist on page refresh
    const isUnlocked = sessionStorage.getItem('adminUnlocked') === 'true';
    const savedEmail = sessionStorage.getItem('adminEmail');

    if (isUnlocked && savedEmail) {
        const account = findAccountByEmail(savedEmail);
        if (account && account.status !== 'inactive' && isAdminPortalRole(account.role)) {
            setLocalProfile(account);
            hideAuthOverlay();
            await initAdminApp();
            return;
        }
    }

    if (typeof firebase !== 'undefined' && firebase.auth && isFirebaseActive) {
        firebase.auth().onAuthStateChanged(async (user) => {
            if (!user) {
                if (!sessionStorage.getItem('adminUnlocked')) {
                    currentUserProfile = null;
                    showAuthOverlay();
                }
                return;
            }

            // Load the Firestore profile; if it fails, fall back to local lookup
            try { await loadUserProfile(user.uid); } catch (e) {}

            let role = getCurrentUserRole();

            // If Firestore returned no useful role, try the local accounts list
            if (!role || role === 'Guest' || role === 'Teacher') {
                const localAccount = findAccountByEmail(user.email || '');
                if (localAccount && isAdminPortalRole(localAccount.role)) {
                    setLocalProfile(localAccount);
                    role = localAccount.role;
                }
            }

            // Block teachers from accessing the admin portal
            if (role && ['Teacher', 'Class Teacher'].includes(role) && !isAdminPortalRole(role)) {
                try { await firebase.auth().signOut(); } catch (e) {}
                sessionStorage.removeItem('adminUnlocked');
                sessionStorage.removeItem('adminEmail');
                showAuthOverlay('You do not have admin access. Contact your system administrator.');
                return;
            }

            if (role && isAdminPortalRole(role)) {
                sessionStorage.setItem('adminUnlocked', 'true');
                sessionStorage.setItem('adminEmail', user.email);
                if (!getCurrentUserProfile()) setLocalProfile({ email: user.email, role });
                hideAuthOverlay();
                await initAdminApp();
            }
        });
    } else {
        if (!isUnlocked) {
            showAuthOverlay();
        }
    }
});

// ─── Auth ────────────────────────────────────────────────────────────────────
function showAuthOverlay(msg) {
    const overlay = document.getElementById('adminAuthOverlay');
    if (overlay) overlay.style.display = 'flex';
    if (msg) {
        const err = document.getElementById('adminAuthError');
        if (err) { err.textContent = msg; err.style.display = 'block'; }
    }
    const app = document.getElementById('adminApp');
    if (app) app.style.display = 'none';
}

function showAdminOverlay(msg) {
    showAuthOverlay(msg);
}

function hideAuthOverlay() {
    const overlay = document.getElementById('adminAuthOverlay');
    if (overlay) overlay.style.display = 'none';
    const app = document.getElementById('adminApp');
    if (app) app.style.display = 'flex';
}

// ─── Strict admin access ─────────────────────────────────────────────────────
// Roles allowed into the Admin Dashboard.
const ADMIN_PORTAL_ROLES = ['Super Admin', 'Administrator', 'Headteacher'];

function getLocalTeachers() {
    try { return JSON.parse(localStorage.getItem('teachers') || '[]'); } catch (e) { return []; }
}

function isAdminPortalRole(role) {
    return ADMIN_PORTAL_ROLES.includes(role);
}

// True when at least one admin-level account exists in the teachers list.
function hasAnyAdminLevelAccount() {
    return getLocalTeachers().some(t => isAdminPortalRole(t.role));
}

// Find any staff account matching the email.
function findAccountByEmail(email) {
    const lc = String(email || '').toLowerCase();
    return getLocalTeachers().find(t => (t.email || '').toLowerCase() === lc) || null;
}

// Set the shared profile object so role helpers (isAdmin/isHeadteacher/...)
// work for locally-authenticated accounts, not just Firebase ones.
function setLocalProfile(user) {
    currentUserProfile = {
        uid:           user.uid || user.id || 'local',
        email:         user.email || '',
        displayName:   user.displayName || user.name || user.email || 'Administrator',
        role:          user.role || 'Administrator',
        assignedClasses:  user.assignedClasses  || [],
        assignedSubjects: user.assignedSubjects || [],
        status:        user.status || 'active'
    };
    return currentUserProfile;
}

function showAuthError(errorEl, msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
}

async function handleAdminLogin() {
    const email    = document.getElementById('adminEmail')?.value?.trim() || '';
    const password = document.getElementById('adminPassword')?.value || '';
    const errorEl  = document.getElementById('adminAuthError');
    const btn      = document.getElementById('adminLoginBtn');

    if (errorEl) errorEl.style.display = 'none';

    if (!email || !password) {
        showAuthError(errorEl, 'Please enter email and password.');
        return;
    }

    const btnText   = btn?.querySelector('.btn-text');
    const btnLoader = btn?.querySelector('.btn-loader');
    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'inline-flex';
    if (btn) btn.disabled = true;

    async function enterAdmin(user, source) {
        setLocalProfile(user);
        sessionStorage.setItem('adminUnlocked', 'true');
        sessionStorage.setItem('adminEmail', user.email || email);
        hideAuthOverlay();
        await initAdminApp();
        try { await logActivity('Admin Login', `Signed in as ${user.email} (${source})`); } catch (e) {}
    }

    try {
        // BOOTSTRAP: when no admin-level account exists anywhere yet, the very
        // first sign-in creates the Super Admin in teachers so the school is not locked out.
        if (!hasAnyAdminLevelAccount()) {
            if (password.length < 6) {
                showAuthError(errorEl, 'Password must be at least 6 characters to create the first admin account.');
                return;
            }
            const firstAdmin = {
                id: 'admin_' + Date.now().toString(36),
                name: email.split('@')[0],
                email,
                role: 'Super Admin',
                status: 'active',
                password,
                assignedClasses: [],
                assignedSubjects: []
            };
            const list = getLocalTeachers();
            list.push(firstAdmin);
            localStorage.setItem('teachers', JSON.stringify(list));
            adminState.teachers = list;
            if (typeof syncSaveCollection === 'function') { try { await syncSaveCollection('teachers', list); } catch (e) {} }
            await enterAdmin(firstAdmin, 'first-run setup');
            showToast('Super Admin account created.', 'success');
            return;
        }

        // Find the account for this email.
        const account = findAccountByEmail(email);

        // Firebase sign-in (validates the real password), then enforce role.
        if (isFirebaseActive && typeof loginFirebaseUser === 'function') {
            try {
                await loginFirebaseUser(email, password);
                const profile = getCurrentUserProfile();
                const role = profile?.role || account?.role || '';
                if (!isAdminPortalRole(role)) {
                    try { await logoutFirebaseUser(); } catch (e) {}
                    currentUserProfile = null;
                    showAuthError(errorEl, 'This account does not have admin access. Contact your system administrator.');
                    return;
                }
                await enterAdmin(profile || account, 'cloud');
                return;
            } catch (e) {
                const code = e.code || '';
                const msg  = e.message || '';
                if (/deactivated/i.test(msg)) { showAuthError(errorEl, msg); return; }
                if (code === 'auth/invalid-email') { showAuthError(errorEl, 'Invalid email address.'); return; }
                if (code === 'auth/too-many-requests') { showAuthError(errorEl, 'Too many attempts. Try again later.'); return; }
                // Fall through to the local password check for offline/local accounts.
            }
        }

        // Local account check.
        if (!account) {
            showAuthError(errorEl, 'No admin account found for this email. Only accounts created by the school can sign in.');
            return;
        }
        if (account.status === 'inactive' || account.status === 'deleted' || account.isDeleted) {
            showAuthError(errorEl, 'This account has been deactivated / deleted by the Administrator.');
            return;
        }
        if (!isAdminPortalRole(account.role)) {
            showAuthError(errorEl, 'This account does not have admin access. Contact your system administrator.');
            return;
        }
        if (!account.password || account.password !== password) {
            showAuthError(errorEl, 'Incorrect email or password.');
            return;
        }
        await enterAdmin(account, 'local');
    } catch (e) {
        showAuthError(errorEl, `Login failed: ${e.message || e}`);
    } finally {
        if (btnText) btnText.style.display = 'inline-flex';
        if (btnLoader) btnLoader.style.display = 'none';
        if (btn) btn.disabled = false;
    }
}

async function handleAdminLogout() {
    await logoutFirebaseUser();
    sessionStorage.removeItem('adminUnlocked');
    sessionStorage.removeItem('adminEmail');
    currentUserProfile = null;
    showAuthOverlay();
    // Destroy charts
    Object.values(adminState.charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    adminState.charts = {};
}

async function handleForgotPassword() {
    const email = document.getElementById('adminEmail')?.value?.trim();
    if (!email) { showToast('Enter your email address first.', 'warning'); return; }
    try {
        await resetPassword(email);
        showToast('Password reset email sent!', 'success');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    btn.innerHTML = isPass ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
}

// ─── Init Admin App ──────────────────────────────────────────────────────────
async function initAdminApp() {
    // Restore sidebar state for desktop
    if (window.innerWidth > 768) {
        const isCollapsed = localStorage.getItem('adminSidebarCollapsed') === 'true';
        const sidebar = document.getElementById('sidebar');
        if (sidebar && isCollapsed) {
            sidebar.classList.add('collapsed');
        }
    }
    updateSidebarToggleState();

    updateSidebarUser();
    if (typeof Attendance !== 'undefined' && Attendance.hydrateFromServer) {
        try { await Attendance.hydrateFromServer(); } catch (e) {}
    }
    await loadAllData();
    loadDashboard();
    renderFieldToggles();

    // Real-time listeners for key collections
    if (isFirebaseActive && typeof setupAdminRealtimeListeners === 'function') {
        setupAdminRealtimeListeners([
            { name: 'results' },
            { name: 'auditLogs' }
        ], (name, data) => {
            if (name === 'results')   { adminState.results   = data; renderResultsTable(); updateNavBadges(); }
            if (name === 'auditLogs') { adminState.auditLogs = data; renderAuditLogs(); }
        });
    }

    // Support URL hash routing (e.g. #timetables, #attendance)
    if (window.location.hash) {
        const targetSection = window.location.hash.replace('#', '').trim();
        if (targetSection && document.getElementById(`section-${targetSection}`)) {
            switchSection(targetSection);
        }
    }

    // Poll data in the background, but do not rebuild open form checkboxes
    if (!isFirebaseActive) {
        setInterval(() => loadAllData({ refreshForms: false }), 3000);
    }
}

function isAnyAdminModalOpen() {
    return Array.from(document.querySelectorAll('.modal-overlay')).some(el => {
        const display = window.getComputedStyle(el).display;
        return display && display !== 'none';
    });
}

// ── Helper to deduplicate teacher accounts by email ─────────────────────────
function deduplicateTeachers(teacherList) {
    if (!Array.isArray(teacherList)) return [];
    const map = new Map();
    for (const t of teacherList) {
        if (!t || t.status === 'deleted' || t.isDeleted) continue;
        const key = (t.email || '').toLowerCase().trim() || String(t.id);
        if (!map.has(key)) {
            map.set(key, { ...t });
        } else {
            const existing = map.get(key);
            const assignedClasses = (existing.assignedClasses && existing.assignedClasses.length) 
                ? existing.assignedClasses 
                : (t.assignedClasses || []);
            const assignedSubjects = (existing.assignedSubjects && existing.assignedSubjects.length) 
                ? existing.assignedSubjects 
                : (t.assignedSubjects || []);
            map.set(key, {
                ...existing,
                ...t,
                id: existing.id || t.id,
                name: (existing.name && existing.name.length > (t.name || '').length) ? existing.name : (t.name || existing.name),
                role: existing.role || t.role || 'Teacher',
                phone: existing.phone || t.phone || '',
                password: existing.password || t.password || '',
                assignedClasses,
                assignedSubjects
            });
        }
    }
    return Array.from(map.values());
}

async function loadAllData(opts = {}) {
    const refreshForms = opts.refreshForms !== false;
    try {
        const [students, teachers, classes, subjects, academicYears,
               terms, results, reports, gradingScales, scores, studentReportDetails] = await Promise.all([
            safeGetCollection('students'),
            safeGetCollection('teachers'),
            safeGetCollection('classes'),
            safeGetCollection('subjects'),
            safeGetCollection('academicYears'),
            safeGetCollection('terms'),
            safeGetCollection('results'),
            safeGetCollection('reports'),
            safeGetCollection('gradingScales'),
            safeGetCollection('scores'),
            safeGetCollection('studentReportDetails')
        ]);

        adminState.students             = students;
        adminState.teachers             = deduplicateTeachers(teachers);
        adminState.classes              = classes;
        adminState.subjects             = subjects;
        adminState.academicYears        = academicYears;
        adminState.terms                = terms;
        adminState.results              = results;
        adminState.reports              = reports;
        adminState.gradingScales        = gradingScales;
        adminState.scores               = scores;
        adminState.studentReportDetails = studentReportDetails;
        
        syncScoresIntoResults();
        
        let localLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
        if (!localLogs.length) {
            try {
                const res = await fetch('/api/audit-logs?limit=100');
                if (res.ok) {
                    const sLogs = await res.json();
                    if (Array.isArray(sLogs) && sLogs.length) {
                        localLogs = sLogs;
                        localStorage.setItem('auditLogs', JSON.stringify(localLogs));
                    }
                }
            } catch (e) {}
        }
        if (!localLogs.length && typeof fetchAuditLogs === 'function') {
            try {
                const fbLogs = await fetchAuditLogs(100);
                if (Array.isArray(fbLogs) && fbLogs.length) {
                    localLogs = fbLogs;
                    localStorage.setItem('auditLogs', JSON.stringify(localLogs));
                }
            } catch (e) {}
        }
        adminState.auditLogs = localLogs;

        const settings = await fetchSchoolSettings();
        if (settings) adminState.settings = settings;
        if (typeof Attendance !== 'undefined') Attendance.load();

        updateNavBadges();
        if (refreshForms && !isAnyAdminModalOpen()) {
            populateAllDropdowns();
        }
        const attSection = document.getElementById('section-attendance');
        if (attSection && attSection.classList.contains('active')) {
            const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
            if (!typing) renderAttendanceSection();
        }
    } catch (e) {
        console.error('Error loading admin data:', e);
    }
}

async function safeGetCollection(name) {
    try {
        const cached = JSON.parse(localStorage.getItem(name) || '[]');
        if (cached && (Array.isArray(cached) ? cached.length > 0 : Object.keys(cached).length > 0)) {
            return cached;
        }
        if (isFirebaseActive && typeof getCollection === 'function') {
            const fresh = await getCollection(name);
            if (fresh) return fresh;
        }
        return cached;
    } catch (e) {
        return JSON.parse(localStorage.getItem(name) || '[]');
    }
}

// ─── Sidebar User ────────────────────────────────────────────────────────────
function updateSidebarUser() {
    const profile = getCurrentUserProfile();
    const name    = profile?.displayName || profile?.email || 'Administrator';
    const role    = profile?.role || 'Admin';
    const initial = name.charAt(0).toUpperCase();

    const nameEl   = document.getElementById('sidebarUserName');
    const roleEl   = document.getElementById('sidebarUserRole');
    const avatarEl = document.getElementById('sidebarUserAvatar');
    const topAvatar= document.getElementById('topbarAvatar');

    if (nameEl)   nameEl.textContent   = name;
    if (roleEl)   roleEl.textContent   = role;
    if (avatarEl) avatarEl.textContent = initial;
    if (topAvatar)topAvatar.textContent= initial;
}

// ─── Navigation ─────────────────────────────────────────────────────────────
function switchSection(sectionId) {
    if (sectionId === 'firebase') {
        const isDevUnlocked = sessionStorage.getItem('devUnlocked') === 'true';
        if (!isDevUnlocked) {
            openDevPasswordModal();
            return;
        }
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.content-section').forEach(el => el.classList.remove('active'));

    const navEl  = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    const sectEl = document.getElementById(`section-${sectionId}`);

    if (navEl)  navEl.classList.add('active');
    if (sectEl) sectEl.classList.add('active');

    // Update breadcrumb
    const labels = {
        'dashboard':'Dashboard','students':'Students','teachers':'Teachers',
        'classes':'Classes','subjects':'Subjects','academic-years':'Academic Years & Terms',
        'grading':'Grading System','results':'Results','reports':'Reports',
        'timetables':'Timetables & Examination Management',
        'settings':'School Settings','firebase':'Firebase Cloud Connection',
        'attendance':'Attendance',
        'audit-logs':'Activity Logs','data-management':'Data Management',
        'templates':'Excel & CSV Templates','backup-sync':'One-Click Cloud Backup & Offline Sync'
    };
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = `<span>${labels[sectionId] || sectionId}</span>`;

    // Clear search filter fields on section navigation so user searches manually with empty state
    ['globalSearch', 'studentFilterSearch', 'teacherFilterSearch', 'resultsFilterSearch', 'auditLogSearch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // Auto-close sidebar on mobile after selecting a section
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
            sidebar.classList.remove('mobile-open');
            if (backdrop) backdrop.classList.remove('show');
            document.body.classList.remove('nav-open');
            updateSidebarToggleState();
        }
    }

    // Lazy-render sections
    switch(sectionId) {
        case 'dashboard':      loadDashboard(); break;
        case 'students':       renderStudentsTable(); break;
        case 'teachers':       renderTeachersTable(); break;
        case 'classes':        renderClassesTable(); break;
        case 'subjects':       renderSubjectsTable(); break;
        case 'academic-years': renderAcademicYears(); break;
        case 'grading':        renderGradingScales(); break;
        case 'results':        renderResultsTable(); break;
        case 'reports':        renderReportsTable(); break;
        case 'timetables':     initAdminTimetablesSection(); break;
        case 'users':          renderUsersTable(); break;
        case 'firebase':       loadFirebaseForm(); break;
        case 'audit-logs':     renderAuditLogs(); break;
        case 'data-management':renderDataManagement(); break;
        case 'templates':      renderTemplatesSection(); break;
        case 'attendance':     renderAttendanceSection(); break;
        case 'settings':       loadSettingsForm(); break;
        case 'backup-sync':    loadBackupSnapshots(); break;
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;
    if (window.innerWidth <= 768) {
        const open = !sidebar.classList.contains('mobile-open');
        sidebar.classList.toggle('mobile-open', open);
        if (backdrop) backdrop.classList.toggle('show', open);
        document.body.classList.toggle('nav-open', open);
    } else {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        try {
            localStorage.setItem('adminSidebarCollapsed', isCollapsed ? 'true' : 'false');
        } catch (e) {}
    }
    updateSidebarToggleState();
}

function updateSidebarToggleState() {
    const sidebar = document.getElementById('sidebar');
    const collapseIcon = document.getElementById('sidebarCollapseIcon');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const topbarIcon = document.getElementById('topbarToggleIcon');
    const topbarBtn = document.getElementById('topbarSidebarToggle');
    if (!sidebar) return;

    const isMobile = window.innerWidth <= 768;
    const isMobileOpen = sidebar.classList.contains('mobile-open');
    const isCollapsed = sidebar.classList.contains('collapsed');

    if (isMobile) {
        if (collapseIcon) {
            collapseIcon.className = isMobileOpen ? 'fas fa-times' : 'fas fa-bars';
        }
        if (collapseBtn) {
            collapseBtn.title = isMobileOpen ? 'Close Navigation' : 'Open Navigation';
            collapseBtn.setAttribute('aria-label', isMobileOpen ? 'Close Navigation' : 'Open Navigation');
        }
        if (topbarIcon) {
            topbarIcon.className = isMobileOpen ? 'fas fa-times' : 'fas fa-bars';
        }
        if (topbarBtn) {
            topbarBtn.title = isMobileOpen ? 'Close Menu' : 'Open Menu';
            topbarBtn.setAttribute('aria-label', isMobileOpen ? 'Close Menu' : 'Open Menu');
        }
    } else {
        if (collapseIcon) {
            collapseIcon.className = isCollapsed ? 'fas fa-chevron-right' : 'fas fa-bars';
        }
        if (collapseBtn) {
            collapseBtn.title = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
            collapseBtn.setAttribute('aria-label', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
        }
        if (topbarIcon) {
            topbarIcon.className = isCollapsed ? 'fas fa-indent' : 'fas fa-bars';
        }
        if (topbarBtn) {
            topbarBtn.title = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
            topbarBtn.setAttribute('aria-label', isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
        }
    }
}

// Window resize handler to maintain consistent sidebar state
window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;
    if (window.innerWidth > 768) {
        sidebar.classList.remove('mobile-open');
        if (backdrop) backdrop.classList.remove('show');
        document.body.classList.remove('nav-open');
        const isCollapsed = localStorage.getItem('adminSidebarCollapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
        } else {
            sidebar.classList.remove('collapsed');
        }
    }
    updateSidebarToggleState();
});

function updateNavBadges() {
    const activeStudents = adminState.students.filter(s => s.status !== 'deleted' && !s.isDeleted);
    const activeTeachers = adminState.teachers.filter(t => t.status !== 'deleted' && !t.isDeleted);

    const studBadge = document.getElementById('nav-badge-students');
    if (studBadge) studBadge.textContent = activeStudents.length;

    const teachBadge = document.getElementById('nav-badge-teachers');
    if (teachBadge) teachBadge.textContent = activeTeachers.length;

    const studHeaderBadge = document.getElementById('studentsHeaderBadge');
    if (studHeaderBadge) studHeaderBadge.textContent = activeStudents.length;

    const teachHeaderBadge = document.getElementById('teachersHeaderBadge');
    if (teachHeaderBadge) teachHeaderBadge.textContent = activeTeachers.length;

    const pendingResults = adminState.results.filter(r => r.status === 'Submitted').length;
    const pendingReports = adminState.reports.filter(r => !['approved','published'].includes(String(r.status||'').toLowerCase())).length;
    const resBadge = document.getElementById('nav-badge-results');
    if (resBadge) {
        resBadge.textContent = pendingResults;
        resBadge.style.display = pendingResults > 0 ? 'inline-flex' : 'none';
    }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard() {
    const activeYear = adminState.academicYears.find(y => y.isActive);
    const activeTerm = adminState.terms.find(t => t.isActive);
    const pendingResults = adminState.results.filter(r => r.status === 'Submitted').length;

    const activeStudents = adminState.students.filter(s => s.status !== 'inactive' && s.status !== 'deleted' && !s.isDeleted);
    const activeTeachers = adminState.teachers.filter(t => t.status !== 'inactive' && t.status !== 'deleted' && !t.isDeleted);
    const activeClasses = adminState.classes.filter(c => c.status !== 'inactive' && c.status !== 'deleted' && !c.isDeleted);
    const activeSubjects = adminState.subjects.filter(s => s.status !== 'inactive' && s.status !== 'deleted' && !s.isDeleted);

    setKPI('kpi-students', activeStudents.length);
    setKPI('kpi-teachers', activeTeachers.length);
    setKPI('kpi-classes',  activeClasses.length);
    setKPI('kpi-subjects', activeSubjects.length);
    setKPI('kpi-reports',  adminState.reports.length);
    setKPI('kpi-pending',  pendingResults);
    setKPI('kpi-year',     activeYear ? activeYear.name : 'None');
    setKPI('kpi-term',     activeTerm ? activeTerm.name : 'None');

    renderGradeDistChart();
    renderSubjectAvgChart();
    renderClassPerfChart();
    renderResultStatusChart();
    renderRecentActivity();
}

function setKPI(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '–';
}

const CHART_TAB_MAP = {
    grade:   'gradeDistChart',
    subject: 'subjectAvgChart',
    class:   'classPerfChart',
    status:  'resultStatusChart',
};

function switchDashboardChart(tabId) {
    document.querySelectorAll('.chart-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.chartTab === tabId);
    });
    document.querySelectorAll('.chart-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.chartPane === tabId);
    });
    const filter = document.getElementById('gradeDistClassFilter');
    if (filter) filter.style.visibility = tabId === 'grade' ? 'visible' : 'hidden';

    requestAnimationFrame(() => {
        const chartKey = CHART_TAB_MAP[tabId];
        const chart = adminState.charts[chartKey];
        if (chart) {
            try { chart.resize(); } catch (e) {}
        } else if (tabId === 'grade') {
            renderGradeDistChart();
        } else if (tabId === 'subject') {
            renderSubjectAvgChart();
        } else if (tabId === 'class') {
            renderClassPerfChart();
        } else if (tabId === 'status') {
            renderResultStatusChart();
        }
    });
}

// ─── Charts ──────────────────────────────────────────────────────────────────
function renderGradeDistChart() {
    const box = document.getElementById('gradeDistChart');
    if (!box) return;
    destroyChart('gradeDistChart');

    const classFilter = document.getElementById('gradeDistClassFilter')?.value || '';
    let results = adminState.results;
    if (classFilter) results = results.filter(r => r.classId === classFilter);

    const gradeCounts = {};
    results.forEach(r => {
        if (r.grade) gradeCounts[r.grade] = (gradeCounts[r.grade] || 0) + 1;
    });

    const entries = Object.entries(gradeCounts);
    if (!entries.length) {
        box.innerHTML = '<div class="grade-bars-empty">No graded results yet</div>';
        return;
    }

    const max = Math.max(...entries.map(([, n]) => n), 1);
    const colors = ['#4f46e5','#059669','#d97706','#dc2626','#0284c7','#7c3aed','#0d9488','#db2777'];
    box.innerHTML = entries.map(([grade, count], i) => {
        const pct = Math.max(8, Math.round((count / max) * 100));
        return `<div class="grade-bar-col">
            <div class="grade-bar-count">${count}</div>
            <div class="grade-bar-track"><div class="grade-bar-fill" style="height:${pct}%;background:${colors[i % colors.length]}"></div></div>
            <div class="grade-bar-label">${escHtml(grade)}</div>
        </div>`;
    }).join('');
}

function renderSubjectAvgChart() {
    const ctx = document.getElementById('subjectAvgChart');
    if (!ctx) return;

    const subjectMap = {};
    adminState.results.forEach(r => {
        if (!r.subjectId || !r.totalScore) return;
        if (!subjectMap[r.subjectId]) subjectMap[r.subjectId] = { sum: 0, count: 0 };
        subjectMap[r.subjectId].sum   += parseFloat(r.totalScore) || 0;
        subjectMap[r.subjectId].count += 1;
    });

    const subjects = adminState.subjects.slice(0, 10);
    const labels   = subjects.map(s => s.name || s.id);
    const averages = subjects.map(s => {
        const data = subjectMap[s.id];
        return data ? Math.round(data.sum / data.count) : 0;
    });

    destroyChart('subjectAvgChart');
    adminState.charts.subjectAvgChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Average Score', data: averages, backgroundColor: '#6366f1', borderRadius: 8 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' } } }
        }
    });
}

function renderClassPerfChart() {
    const ctx = document.getElementById('classPerfChart');
    if (!ctx) return;

    const classMap = {};
    adminState.results.forEach(r => {
        if (!r.classId || !r.totalScore) return;
        if (!classMap[r.classId]) classMap[r.classId] = { sum: 0, count: 0 };
        classMap[r.classId].sum   += parseFloat(r.totalScore) || 0;
        classMap[r.classId].count += 1;
    });

    const classes  = adminState.classes.slice(0, 10);
    const labels   = classes.map(c => c.name);
    const averages = classes.map(c => {
        const d = classMap[c.id];
        return d ? Math.round(d.sum / d.count) : 0;
    });

    destroyChart('classPerfChart');
    adminState.charts.classPerfChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Class Average',
                data: averages,
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79,70,229,.1)',
                borderWidth: 2,
                fill: true, tension: 0.4, pointRadius: 5,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } }
        }
    });
}

function renderResultStatusChart() {
    const ctx = document.getElementById('resultStatusChart');
    if (!ctx) return;

    const statuses = ['Draft', 'Submitted', 'Reviewed', 'Approved', 'Published'];
    const counts   = statuses.map(s => adminState.results.filter(r => r.status === s).length);

    destroyChart('resultStatusChart');
    adminState.charts.resultStatusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels:   statuses,
            datasets: [{ data: counts, backgroundColor: ['#94a3b8','#0284c7','#d97706','#059669','#4f46e5'], borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { padding: 10, font: { size: 11 }, boxWidth: 12 } } },
            cutout: '65%'
        }
    });
}

function destroyChart(id) {
    if (adminState.charts[id]) {
        adminState.charts[id].destroy();
        delete adminState.charts[id];
    }
}

function renderRecentActivity() {
    const tbody = document.getElementById('recentActivityBody');
    if (!tbody) return;
    const logs = adminState.auditLogs.slice(0, 4);
    tbody.innerHTML = logs.length ? logs.map(l => `
        <tr>
            <td>${escHtml(l.user || '')}</td>
            <td><span class="status-pill">${escHtml(l.role || '')}</span></td>
            <td>${escHtml(l.action || '')}</td>
            <td>${escHtml(l.details || '')}</td>
            <td>${l.formattedTime || ''}</td>
        </tr>`).join('') : emptyRow(5, 'No recent activity');
}

// ─── Populate Dropdowns ───────────────────────────────────────────────────────
function populateAllDropdowns() {
    // Year dropdown in Dashboard filter
    populateSelect('dashboardYearFilter', adminState.academicYears, 'id', 'name', 'All Years');

    // Student form
    populateSelect('sm-class', adminState.classes, 'id', 'name', 'Select Class');
    populateSelect('sm-academicYear', adminState.academicYears, 'id', 'name', 'Select Year');

    // Class form — teacher options (exclude deleted/inactive)
    populateSelect('cm-classTeacher', adminState.teachers.filter(t => t.status !== 'deleted' && !t.isDeleted), 'id', 'name', 'None');

    // Subject form — class checkboxes
    renderCheckboxes('subm-classes-checkboxes', adminState.classes, 'id', 'name');

    // Teacher form — classes & subjects
    renderCheckboxes('tm-classes-checkboxes',  adminState.classes,  'id', 'name');
    renderCheckboxes('tm-subjects-checkboxes', adminState.subjects, 'id', 'name');

    // Student filter
    populateSelect('studentFilterClass', adminState.classes, 'id', 'name', 'All Classes');

    // Results filters
    populateSelect('resultsFilterYear',  adminState.academicYears, 'id', 'name', 'All Years');
    populateSelect('resultsFilterTerm',  adminState.terms,         'id', 'name', 'All Terms');
    populateSelect('resultsFilterClass', adminState.classes,       'id', 'name', 'All Classes');

    // Reports filters
    populateSelect('reportsFilterYear',  adminState.academicYears, 'id', 'name', 'All Years');
    populateSelect('reportsFilterTerm',  adminState.terms,         'id', 'name', 'All Terms');
    populateSelect('reportsFilterClass', adminState.classes,       'id', 'name', 'All Classes');

    // Grade dist filter
    populateSelect('gradeDistClassFilter', adminState.classes, 'id', 'name', 'All Classes');
    populateSelect('attFilterClass', adminState.classes, 'id', 'name', 'All Classes');

    // Generate report modal
    populateSelect('gr-class',   adminState.classes,       'id', 'name', 'Select Class');
    populateSelect('gr-year',    adminState.academicYears, 'id', 'name', 'Select Year');
    populateSelect('gr-term',    adminState.terms,         'id', 'name', 'Select Term');
    populateSelect('gr-student', adminState.students,      'id', 'name', 'Select Student');

    // Timetables and Exams section dropdowns
    if (typeof populateAdminTtClassDropdown === 'function') {
        populateAdminTtClassDropdown();
    }
    if (typeof populateAdminTtTeacherDropdown === 'function') {
        populateAdminTtTeacherDropdown();
    }
}

function populateSelect(id, items, valField, labelField, defaultLabel = '') {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = defaultLabel ? `<option value="">${defaultLabel}</option>` : '';
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value       = item[valField];
        opt.textContent = item[labelField] || item[valField];
        el.appendChild(opt);
    });
    if (current) el.value = current;
}

function renderCheckboxes(containerId, items, valField, labelField, selected = []) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map(item => `
        <label class="checkbox-item ${selected.includes(item[valField]) ? 'checked' : ''}">
            <input type="checkbox" value="${item[valField]}" ${selected.includes(item[valField]) ? 'checked' : ''}>
            ${escHtml(item[labelField] || item[valField])}
        </label>`).join('');
    el.querySelectorAll('label').forEach(lbl => {
        lbl.querySelector('input')?.addEventListener('change', () => lbl.classList.toggle('checked'));
    });
}

function getCheckedValues(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}

// ─── STUDENTS ────────────────────────────────────────────────────────────────
function renderStudentsTable() {
    const search   = (document.getElementById('studentFilterSearch')?.value  || '').toLowerCase();
    const classF   =  document.getElementById('studentFilterClass')?.value   || '';
    const statusF  =  document.getElementById('studentFilterStatus')?.value  || '';

    let data = adminState.students.filter(s => s.status !== 'deleted' && !s.isDeleted);
    if (search)  data = data.filter(s => `${s.name} ${s.admissionNo}`.toLowerCase().includes(search));
    if (classF)  data = data.filter(s => s.classId === classF || s.class === classF);
    if (statusF) data = data.filter(s => (s.status || 'active') === statusF);

    const page  = adminState.studentPage;
    const total = data.length;
    const start = (page - 1) * adminState.studentsPerPage;
    const paged = data.slice(start, start + adminState.studentsPerPage);

    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;

    tbody.innerHTML = paged.length ? paged.map((s, i) => {
        const className = resolveClass(s.classId || s.class);
        return `<tr>
            <td>${start + i + 1}</td>
            <td><strong>${escHtml(s.admissionNo || '—')}</strong></td>
            <td>${escHtml(s.name || '')}</td>
            <td>${escHtml(s.gender || '—')}</td>
            <td>${escHtml(className)}</td>
            <td>${s.dob || '—'}</td>
            <td><span class="status-pill ${s.status || 'active'}">${s.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" title="View Profile" onclick="openStudentDrawer('${s.id}')"><i class="fas fa-eye"></i></button>
                    <button class="action-btn" title="Edit" onclick="openStudentModal('${s.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" title="Delete" onclick="confirmDeleteStudent('${s.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('') : emptyRow(8, 'No students found');

    const countEl = document.getElementById('studentsCount');
    if (countEl) countEl.textContent = `${total} student${total === 1 ? '' : 's'}`;

    const headerBadge = document.getElementById('studentsHeaderBadge');
    if (headerBadge) headerBadge.textContent = adminState.students.filter(s => s.status !== 'deleted' && !s.isDeleted).length;

    renderPagination('studentsPagination', total, adminState.studentsPerPage, page, (p) => {
        adminState.studentPage = p;
        renderStudentsTable();
    });
}

function openStudentModal(id = null) {
    adminState.editingStudent = id;
    const modal = document.getElementById('studentModal');
    const title = document.getElementById('studentModalTitle');
    if (!modal) return;

    // Clear form
    ['sm-admissionNo','sm-fullName','sm-dob','sm-parentPhone','sm-parentName'].forEach(fId => {
        const el = document.getElementById(fId);
        if (el) el.value = '';
    });
    document.getElementById('sm-id').value = '';
    document.getElementById('sm-gender').value = '';
    document.getElementById('sm-status').value = 'active';

    if (id) {
        const s = adminState.students.find(s => s.id === id);
        if (s) {
            if (title) title.innerHTML = '<i class="fas fa-user-graduate"></i> Edit Student';
            document.getElementById('sm-id').value            = s.id;
            document.getElementById('sm-admissionNo').value   = s.admissionNo || '';
            document.getElementById('sm-fullName').value      = s.name || '';
            document.getElementById('sm-gender').value        = s.gender || '';
            document.getElementById('sm-dob').value           = s.dob || '';
            document.getElementById('sm-class').value         = s.classId || s.class || '';
            document.getElementById('sm-academicYear').value  = s.academicYearId || '';
            document.getElementById('sm-status').value        = s.status || 'active';
            document.getElementById('sm-parentPhone').value   = s.parentPhone || '';
            document.getElementById('sm-parentName').value    = s.parentName || '';
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-user-graduate"></i> Add Student';
    }

    populateSelect('sm-class', adminState.classes, 'id', 'name', 'Select Class');
    populateSelect('sm-academicYear', adminState.academicYears, 'id', 'name', 'Select Year');
    modal.style.display = 'flex';
}

async function saveStudent() {
    const id           = document.getElementById('sm-id')?.value || null;
    const admissionNo  = document.getElementById('sm-admissionNo')?.value?.trim() || '';
    const name         = document.getElementById('sm-fullName')?.value?.trim() || '';
    const gender       = document.getElementById('sm-gender')?.value || '';
    const dob          = document.getElementById('sm-dob')?.value || '';
    const classId      = document.getElementById('sm-class')?.value || '';
    const academicYearId = document.getElementById('sm-academicYear')?.value || '';
    const status       = document.getElementById('sm-status')?.value || 'active';
    const parentPhone  = document.getElementById('sm-parentPhone')?.value?.trim() || '';
    const parentName   = document.getElementById('sm-parentName')?.value?.trim() || '';

    if (!name) { showToast('Student name is required.', 'error'); return; }

    const data = { admissionNo, name, gender, dob, classId, class: resolveClass(classId), academicYearId, status, parentPhone, parentName };

    try {
        let docId = id;
        if (id) {
            const idx = adminState.students.findIndex(s => String(s.id) === String(id));
            if (idx >= 0) adminState.students[idx] = { ...adminState.students[idx], ...data };
            showToast('Student updated!', 'success');
        } else {
            docId = 'stu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            adminState.students.push({ id: docId, ...data });
            showToast('Student added!', 'success');
        }
        localStorage.setItem('students', JSON.stringify(adminState.students));
        closeModal('studentModal');
        renderStudentsTable();
        updateNavBadges();

        // Remote database sync in background
        (async () => {
            if (id) {
                await updateDocument('students', id, data);
                await logActivity('Student Updated', `Updated student ${name}`, id);
            } else {
                await updateDocument('students', docId, data);
                await logActivity('Student Added', `Added student ${name}`, docId);
            }
            if (typeof syncSaveCollection === 'function') {
                await syncSaveCollection('students', adminState.students);
            }
        })().catch(err => console.warn('Background student save error:', err));
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function confirmDeleteStudent(id) {
    const s = adminState.students.find(s => s.id === id);
    showConfirm(`Delete student "${s?.name}"? This cannot be undone.`, async () => {
        await deleteDocument('students', id);
        adminState.students = adminState.students.filter(s => s.id !== id);
        renderStudentsTable();
        updateNavBadges();
        showToast('Student deleted.', 'success');
        await logActivity('Student Deleted', `Deleted student ${s?.name}`, id);
    });
}

// Student Profile Drawer
function openStudentDrawer(id) {
    const s = adminState.students.find(s => s.id === id);
    if (!s) return;

    document.getElementById('drawerStudentName').textContent = s.name || 'Student Profile';

    const results = adminState.results.filter(r => r.studentId === id);
    const body    = document.getElementById('drawerStudentBody');
    if (!body) return;

    body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div class="stat-item">
                <div class="stat-item-label">Admission No.</div>
                <div style="font-weight:600;">${escHtml(s.admissionNo || '—')}</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-label">Gender</div>
                <div style="font-weight:600;">${escHtml(s.gender || '—')}</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-label">Class</div>
                <div style="font-weight:600;">${escHtml(resolveClass(s.classId || s.class))}</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-label">Status</div>
                <div><span class="status-pill ${s.status || 'active'}">${s.status || 'active'}</span></div>
            </div>
        </div>
        <h4 style="margin-bottom:12px;font-size:13.5px;color:#475569;">Academic Results (${results.length})</h4>
        ${results.length ? `
        <table class="admin-table">
            <thead><tr><th>Subject</th><th>CS</th><th>Exam</th><th>Total</th><th>Grade</th><th>Status</th></tr></thead>
            <tbody>${results.map(r => `
                <tr>
                    <td>${escHtml(r.subjectId || '—')}</td>
                    <td>${r.classScore ?? '—'}</td>
                    <td>${r.examScore ?? '—'}</td>
                    <td>${r.totalScore ?? '—'}</td>
                    <td>${r.grade ?? '—'}</td>
                    <td><span class="status-pill ${(r.status||'draft').toLowerCase()}">${r.status||'Draft'}</span></td>
                </tr>`).join('')}
            </tbody>
        </table>` : '<p style="color:#94a3b8;text-align:center;padding:20px;">No results recorded.</p>'}
    `;

    document.getElementById('studentDrawerOverlay').style.display = 'block';
    document.getElementById('studentDrawer').style.transform = 'translateX(0)';
}

function closeStudentDrawer() {
    document.getElementById('studentDrawerOverlay').style.display = 'none';
    document.getElementById('studentDrawer').style.transform = 'translateX(100%)';
}

// ─── TEACHERS ────────────────────────────────────────────────────────────────
function renderTeachersTable() {
    const search  = (document.getElementById('teacherFilterSearch')?.value || '').toLowerCase();
    const statusF =  document.getElementById('teacherFilterStatus')?.value || '';

    let data = deduplicateTeachers(adminState.teachers.filter(t => t.status !== 'deleted' && !t.isDeleted));
    if (search)  data = data.filter(t => `${t.name} ${t.email}`.toLowerCase().includes(search));
    if (statusF) data = data.filter(t => (t.status || 'active') === statusF);

    const tbody = document.getElementById('teachersTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.length ? data.map((t, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${escHtml(t.name || '')}</strong></td>
            <td>${escHtml(t.email || '')}</td>
            <td>${escHtml(t.phone || '—')}</td>
            <td><span class="status-pill ${rolePillClass(t.role || 'Teacher')}">${escHtml(t.role || 'Teacher')}</span></td>
            <td>${(t.assignedClasses || []).map(c => resolveClass(c)).join(', ') || '—'}</td>
            <td>${(t.assignedSubjects || []).map(s => resolveSubject(s)).join(', ') || '—'}</td>
            <td><span class="status-pill ${t.status || 'active'}">${t.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" title="Edit Teacher" onclick="openTeacherModal('${t.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn" title="Reset Password" onclick="openResetStaffPasswordModal('${t.id}')"><i class="fas fa-key"></i></button>
                    <button class="action-btn ${t.status === 'inactive' ? 'success' : 'warning'}" title="${t.status === 'inactive' ? 'Activate Account' : 'Deactivate Account'}" onclick="toggleTeacherStatus('${t.id}')">
                        <i class="fas ${t.status === 'inactive' ? 'fa-user-check' : 'fa-user-slash'}"></i>
                    </button>
                    <button class="action-btn delete" title="Delete Teacher" onclick="confirmDeleteTeacher('${t.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`).join('') : emptyRow(9, 'No teachers found');

    const countEl = document.getElementById('teachersCount');
    if (countEl) countEl.textContent = `${data.length} teacher${data.length === 1 ? '' : 's'}`;

    const activeTeachers = deduplicateTeachers(adminState.teachers.filter(t => t.status !== 'deleted' && !t.isDeleted));
    const headerBadge = document.getElementById('teachersHeaderBadge');
    if (headerBadge) headerBadge.textContent = activeTeachers.length;

    const navBadge = document.getElementById('nav-badge-teachers');
    if (navBadge) navBadge.textContent = activeTeachers.length;
}

let currentEditingTeacherSignature = null;

function renderAdminTeacherSignaturePreview(sig) {
    const preview = document.getElementById('tm-signature-preview');
    const removeBtn = document.getElementById('tm-signature-remove-btn');
    if (!preview) return;
    if (sig) {
        preview.innerHTML = `<img src="${sig}" style="max-height:46px;max-width:180px;object-fit:contain;" alt="Teacher Signature">`;
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
        preview.innerHTML = `<span style="color:#94a3b8;font-size:12px;font-style:italic;">No signature on file (teacher can also sign in their portal)</span>`;
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

function handleAdminTeacherSignatureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        currentEditingTeacherSignature = e.target.result;
        renderAdminTeacherSignaturePreview(currentEditingTeacherSignature);
    };
    reader.readAsDataURL(file);
}

function clearAdminTeacherSignature() {
    currentEditingTeacherSignature = null;
    renderAdminTeacherSignaturePreview(null);
    const fileInput = document.getElementById('tm-signature-file');
    if (fileInput) fileInput.value = '';
}

function onTeacherRoleChange() {
    const role = document.getElementById('tm-role')?.value || 'Teacher';
    const classGroup = document.getElementById('tm-classTeacherClassGroup');
    if (classGroup) {
        if (role === 'Class Teacher') {
            classGroup.style.borderColor = 'var(--primary)';
            classGroup.style.background = '#eef2ff';
        } else {
            classGroup.style.borderColor = '#e2e8f0';
            classGroup.style.background = '#f8fafc';
        }
    }
}

function openTeacherModal(id = null) {
    const modal = document.getElementById('teacherModal');
    if (!modal) return;
    const title = document.getElementById('teacherModalTitle');

    // Populate Class Teacher Assignment dropdown
    const activeClasses = (adminState.classes || []).filter(c => c.status !== 'inactive');
    populateSelect('tm-classTeacherClass', activeClasses, 'id', 'name', 'None (Subject Teacher only)');

    document.getElementById('tm-name').value  = '';
    document.getElementById('tm-email').value = '';
    document.getElementById('tm-phone').value = '';
    document.getElementById('tm-id').value = '';
    document.getElementById('tm-role').value = 'Teacher';
    document.getElementById('tm-status').value = 'active';
    document.getElementById('tm-classTeacherClass').value = '';
    currentEditingTeacherSignature = null;
    renderAdminTeacherSignaturePreview(null);

    renderCheckboxes('tm-classes-checkboxes',  adminState.classes,  'id', 'name');
    renderCheckboxes('tm-subjects-checkboxes', adminState.subjects, 'id', 'name');

    const pwSection = document.getElementById('tm-password-section');
    const pwLabel = document.getElementById('tm-password-label');
    const pwInput = document.getElementById('tm-password');
    if (pwInput) pwInput.value = '';

    if (id) {
        const t = adminState.teachers.find(t => t.id === id);
        if (t) {
            if (title) title.innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Edit Teacher';
            document.getElementById('tm-id').value    = t.id;
            document.getElementById('tm-name').value  = t.name || '';
            document.getElementById('tm-email').value = t.email || '';
            document.getElementById('tm-phone').value = t.phone || '';
            document.getElementById('tm-role').value  = t.role || 'Teacher';
            document.getElementById('tm-status').value = t.status || 'active';
            
            // Resolve assigned primary class (Class Teacher Of)
            const assignedClass = adminState.classes.find(c => String(c.classTeacherId) === String(t.id)) ||
                                  adminState.classes.find(c => String(c.id) === String(t.classTeacherOf) || String(c.name) === String(t.classTeacherOf));
            if (assignedClass) {
                document.getElementById('tm-classTeacherClass').value = assignedClass.id;
            } else if (t.classTeacherOf) {
                document.getElementById('tm-classTeacherClass').value = t.classTeacherOf;
            }

            currentEditingTeacherSignature = t.signature || t.teacherSignature || localStorage.getItem('teacherSignature_' + t.id) || null;
            renderAdminTeacherSignaturePreview(currentEditingTeacherSignature);

            if (pwSection) pwSection.style.display = 'block';
            if (pwLabel) pwLabel.textContent = 'New Password (leave blank to keep current)';
            renderCheckboxes('tm-classes-checkboxes',  adminState.classes,  'id', 'name', t.assignedClasses  || []);
            renderCheckboxes('tm-subjects-checkboxes', adminState.subjects, 'id', 'name', t.assignedSubjects || []);
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Add Teacher';
        if (pwSection) pwSection.style.display = 'block';
        if (pwLabel) pwLabel.textContent = 'Password *';
    }

    onTeacherRoleChange();
    modal.style.display = 'flex';
}

async function saveTeacher() {
    const id       = document.getElementById('tm-id')?.value || null;
    const name     = document.getElementById('tm-name')?.value?.trim() || '';
    const email    = document.getElementById('tm-email')?.value?.trim() || '';
    const phone    = document.getElementById('tm-phone')?.value?.trim() || '';
    const role     = document.getElementById('tm-role')?.value || 'Teacher';
    const password = document.getElementById('tm-password')?.value || '';
    const status   = document.getElementById('tm-status')?.value || 'active';
    const primaryClassId = document.getElementById('tm-classTeacherClass')?.value || '';
    let assignedClasses  = getCheckedValues('tm-classes-checkboxes');
    const assignedSubjects = getCheckedValues('tm-subjects-checkboxes');

    if (!name || !email) { showToast('Name and email are required.', 'error'); return; }

    // Check if a teacher with this email already exists in the system
    const existingByEmail = adminState.teachers.find(t => t.email && t.email.toLowerCase() === email.toLowerCase());
    const effectiveId = id || (existingByEmail ? existingByEmail.id : null);

    if (!effectiveId && !password) { showToast('A password is required so the teacher can sign in.', 'error'); return; }

    // If a primary class was selected as Class Teacher, make sure it is in assignedClasses
    if (primaryClassId && !assignedClasses.includes(primaryClassId)) {
        assignedClasses.push(primaryClassId);
    }

    const teacherData = {
        name,
        email,
        phone,
        role,
        status,
        classTeacherOf: primaryClassId,
        assignedClasses,
        assignedSubjects
    };
    if (currentEditingTeacherSignature) {
        teacherData.signature = currentEditingTeacherSignature;
    } else if (effectiveId) {
        const existingT = adminState.teachers.find(t => String(t.id) === String(effectiveId));
        if (existingT?.signature && currentEditingTeacherSignature !== null) {
            teacherData.signature = existingT.signature;
        }
    }
    if (password) teacherData.password = password;

    try {
        let teacherId = effectiveId;
        let isNew = !effectiveId;
        let docId = effectiveId;

        if (!effectiveId) {
            docId = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            teacherData.id = docId;
            teacherData.createdAt = new Date().toISOString();
            adminState.teachers.push(teacherData);
            teacherId = docId;
            showToast('Teacher added!', 'success');
        } else {
            const idx = adminState.teachers.findIndex(t => String(t.id) === String(effectiveId));
            if (idx >= 0) adminState.teachers[idx] = { ...adminState.teachers[idx], ...teacherData, id: effectiveId };
            showToast('Teacher profile updated!', 'success');
        }

        if (teacherId && currentEditingTeacherSignature) {
            localStorage.setItem('teacherSignature_' + teacherId, currentEditingTeacherSignature);
        }

        // ── Assign as Class Teacher to the selected class (or remove from old if changed) ──
        if (teacherId) {
            // First, if primaryClassId is assigned:
            if (primaryClassId) {
                adminState.classes.forEach(c => {
                    if (String(c.id) === String(primaryClassId) || String(c.name) === String(primaryClassId)) {
                        c.classTeacherId = teacherId;
                        c.classTeacherName = name;
                        if (!Array.isArray(c.assignedTeacherIds)) c.assignedTeacherIds = [];
                        if (!c.assignedTeacherIds.includes(teacherId)) c.assignedTeacherIds.push(teacherId);
                    } else if (String(c.classTeacherId) === String(teacherId)) {
                        // Unassign from previous primary class if they moved to a different one
                        c.classTeacherId = '';
                        c.classTeacherName = '';
                    }
                });
            } else {
                // If role is Class Teacher and checked classes exist, assign first checked class if not already assigned
                if (role === 'Class Teacher' && assignedClasses.length > 0) {
                    const firstClass = adminState.classes.find(c => assignedClasses.includes(c.id) || assignedClasses.includes(c.name));
                    if (firstClass && (!firstClass.classTeacherId || String(firstClass.classTeacherId) === String(teacherId))) {
                        firstClass.classTeacherId = teacherId;
                        firstClass.classTeacherName = name;
                        teacherData.classTeacherOf = firstClass.id;
                        if (!Array.isArray(firstClass.assignedTeacherIds)) firstClass.assignedTeacherIds = [];
                        if (!firstClass.assignedTeacherIds.includes(teacherId)) firstClass.assignedTeacherIds.push(teacherId);
                    }
                }
                // Keep updated name for all classes already assigned to this teacher
                adminState.classes.forEach(c => {
                    if (String(c.classTeacherId) === String(teacherId)) c.classTeacherName = name;
                });
            }
            localStorage.setItem('classes', JSON.stringify(adminState.classes));
        }

        // Deduplicate any duplicates with matching email
        adminState.teachers = deduplicateTeachers(adminState.teachers);
        localStorage.setItem('teachers', JSON.stringify(adminState.teachers));

        if (role === 'Headteacher' && status !== 'inactive') {
            const settings = { ...(adminState.settings || {}), headTeacher: name };
            adminState.settings = settings;
            persistSchoolInfoPatch({ headTeacher: name });
        }

        closeModal('teacherModal');
        renderTeachersTable();
        renderClassesTable();
        renderClassTeacherMap();
        updateNavBadges();

        // Background cloud / REST persistence
        (async () => {
            if (isNew && isFirebaseActive && password) {
                try {
                    const creds = await registerFirebaseUser(email, password, name, role, teacherData);
                    if (creds && creds.user) {
                        teacherData.userId = creds.user.uid;
                        teacherData.uid = creds.user.uid;
                    }
                } catch (err) {
                    console.warn('Firebase user creation notice:', err);
                }
            }
            await updateDocument('teachers', docId, teacherData);
            if (typeof syncSaveCollection === 'function') {
                await syncSaveCollection('teachers', adminState.teachers);
            }
            for (const c of adminState.classes) {
                if (String(c.classTeacherId) === String(teacherId) || primaryClassId === c.id) {
                    try {
                        await updateDocument('classes', c.id, {
                            classTeacherId: c.classTeacherId || '',
                            classTeacherName: c.classTeacherName || '',
                            assignedTeacherIds: c.assignedTeacherIds || []
                        });
                    } catch (e) {}
                }
            }
            if (typeof syncSaveCollection === 'function') {
                await syncSaveCollection('classes', adminState.classes);
            }
            if (role === 'Headteacher' && status !== 'inactive') {
                try { await saveSchoolSettings({ ...(adminState.settings || {}), headTeacher: name }); } catch (e) {}
            }
            await logActivity(isNew ? 'Teacher Added' : 'Teacher Updated', `${isNew ? 'Added' : 'Updated'} teacher ${name}${primaryClassId ? ` (Class Teacher of ${primaryClassId})` : ''}`, docId);
        })().catch(e => console.warn('Background teacher save error:', e));
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function openResetStaffPasswordModal(id) {
    const t = adminState.teachers.find(t => t.id === id);
    if (!t) return;
    document.getElementById('rpm-staffId').value = t.id;
    document.getElementById('rpm-staffName').textContent = t.name || 'Staff Member';
    document.getElementById('rpm-staffEmail').textContent = t.email || '—';
    document.getElementById('rpm-password').value = '';
    document.getElementById('rpm-error').style.display = 'none';
    document.getElementById('resetStaffPasswordModal').style.display = 'flex';
    setTimeout(() => { document.getElementById('rpm-password')?.focus(); }, 100);
}

async function submitStaffPasswordReset(e) {
    if (e && e.preventDefault) e.preventDefault();
    const id = document.getElementById('rpm-staffId')?.value;
    const password = document.getElementById('rpm-password')?.value || '';
    const errorEl = document.getElementById('rpm-error');

    if (!password || password.length < 6) {
        if (errorEl) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.style.display = 'block';
        }
        return;
    }

    const t = adminState.teachers.find(t => t.id === id);
    if (!t) {
        showToast('Staff member not found.', 'error');
        return;
    }

    try {
        t.password = password;
        await updateDocument('teachers', id, { password });
        await syncSaveCollection('teachers', adminState.teachers);

        closeModal('resetStaffPasswordModal');
        showToast(`Password updated for ${t.name}! They can now log in with this new password.`, 'success');
        await logActivity('Staff Password Reset', `Admin set new password for ${t.name} (${t.email})`, id);
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = `Error: ${err.message}`;
            errorEl.style.display = 'block';
        }
    }
}

function generateRandomPassword(targetInputId) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%';
    let pwd = '';
    for (let i = 0; i < 8; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const input = document.getElementById(targetInputId);
    if (input) {
        input.value = pwd;
        input.type = 'text';
    }
}

function toggleTeacherStatus(id) {
    const t = adminState.teachers.find(t => t.id === id);
    if (!t) return;
    const newStatus = t.status === 'inactive' ? 'active' : 'inactive';
    // Optimistic UI — update locally first, cloud write in background
    t.status = newStatus;
    localStorage.setItem('teachers', JSON.stringify(adminState.teachers));
    renderTeachersTable();
    showToast(`Teacher account ${newStatus === 'active' ? 'activated' : 'deactivated'}.`, 'success');
    (async () => {
        try { await updateDocument('teachers', id, { status: newStatus }); } catch(e) {}
        try { await syncSaveCollection('teachers', adminState.teachers); } catch(e) {}
        try { await logActivity('Teacher Status Changed', `Set teacher ${t.name} to ${newStatus}`, id); } catch(e) {}
    })().catch(e => console.warn('toggleTeacherStatus bg error:', e));
}

async function confirmDeleteTeacher(id) {
    const t = adminState.teachers.find(t => t.id === id);
    if (!t) return;
    showConfirm(`Permanently delete "${t.name}"? Their info will be completely removed from the system including class assignments.`, async () => {
        // Purge teacher from all class assignments
        adminState.classes.forEach(c => {
            if (String(c.classTeacherId) === String(id)) {
                c.classTeacherId = '';
                c.classTeacherName = '';
            }
            if (Array.isArray(c.assignedTeacherIds)) {
                c.assignedTeacherIds = c.assignedTeacherIds.filter(tid => String(tid) !== String(id));
            }
        });
        localStorage.setItem('classes', JSON.stringify(adminState.classes));

        // Mark teacher as deleted
        t.status = 'deleted';
        t.isDeleted = true;
        t.deletedAt = new Date().toISOString();
        localStorage.setItem('teachers', JSON.stringify(adminState.teachers));

        // Re-render immediately
        renderTeachersTable();
        renderClassesTable();
        updateNavBadges();
        showToast('Staff member deleted and removed from all class assignments.', 'success');

        // Background cloud sync
        (async () => {
            try { await updateDocument('teachers', id, { status: 'deleted', isDeleted: true, deletedAt: t.deletedAt }); } catch(e) {}
            try { await syncSaveCollection('teachers', adminState.teachers); } catch(e) {}
            try { await syncSaveCollection('classes', adminState.classes); } catch(e) {}
            for (const c of adminState.classes) {
                try { await updateDocument('classes', c.id, { classTeacherId: c.classTeacherId || '', classTeacherName: c.classTeacherName || '' }); } catch(e) {}
            }
            try { await logActivity('Teacher Deleted', `Deleted teacher ${t.name} and removed from all class assignments`, id); } catch(e) {}
            try { triggerAdminNotification('Staff Account Deleted', `Teacher ${t.name} (${t.email}) was deleted and removed from all class assignments.`, 'warning', 'teachers'); } catch(e) {}
        })().catch(e => console.warn('deleteTeacher bg error:', e));
    });
}

// ─── CLASSES ─────────────────────────────────────────────────────────────────
function getReadableGradingScaleName(c) {
    if (!c) return 'Ghana Primary (Default)';
    if (c.gradingScaleId) {
        if (c.gradingScaleId === 'preset_jhs_bece') return 'BECE Stanine (1-9)';
        if (c.gradingScaleId === 'preset_ghana_primary') return 'Ghana Primary (A-B)';
        if (c.gradingScaleId === 'preset_standard_letter') return 'Standard Letter (A-F)';
        const custom = (adminState.gradingScales || []).find(s => String(s.id) === String(c.gradingScaleId) || String(s.name || '').toLowerCase() === String(c.gradingScaleId).toLowerCase());
        if (custom) return `${custom.name} (Custom)`;
        return `Custom Scale (${c.gradingScaleId})`;
    }
    const level = c.level || (String(c.name || '').toLowerCase().includes('jhs') ? 'JHS' : 'Primary');
    return level === 'JHS' ? 'BECE Scale (Dept Auto)' : 'Ghana Primary (Dept Auto)';
}

function populateClassGradingScaleDropdown(selectedVal = '') {
    const gsEl = document.getElementById('cm-gradingScale');
    if (!gsEl) return;

    let html = `
        <option value="">(Auto-detect by Department)</option>
        <optgroup label="Standard Scale Presets">
            <option value="preset_ghana_primary">Ghana Primary Scale (A, P, AP, D, B)</option>
            <option value="preset_jhs_bece">JHS / BECE Stanine Scale (Grade 1 - 9)</option>
            <option value="preset_standard_letter">Standard Letter Scale (A+, A, B, C, D, F)</option>
        </optgroup>
    `;

    const customScales = (adminState.gradingScales || []).filter(s => s && s.id);
    if (customScales.length > 0) {
        html += `<optgroup label="Custom School Grading Schemes">`;
        customScales.forEach(s => {
            const deptText = s.department ? ` • Dept: ${s.department}` : '';
            html += `<option value="${escHtml(s.id)}">${escHtml(s.name)}${deptText}</option>`;
        });
        html += `</optgroup>`;
    }

    gsEl.innerHTML = html;
    gsEl.value = selectedVal || '';
}

function renderClassesTable() {
    const tbody = document.getElementById('classesTableBody');
    if (!tbody) return;
    tbody.innerHTML = adminState.classes.length ? adminState.classes.map((c, i) => {
        const teacher  = adminState.teachers.find(t => t.id === c.classTeacherId);
        const students = adminState.students.filter(s => s.classId === c.id || s.class === c.name).length;
        const level    = c.level || (c.name.toLowerCase().includes('jhs') ? 'JHS' : 'Primary');
        const scaleName= getReadableGradingScaleName(c);
        const isCustomAssigned = !!c.gradingScaleId;

        return `<tr>
            <td>${i + 1}</td>
            <td><strong>${escHtml(c.name)}</strong></td>
            <td><span class="status-pill ${level === 'JHS' ? 'published' : 'active'}">${escHtml(level)}</span></td>
            <td>
                <span class="status-pill ${isCustomAssigned ? 'active' : 'inactive'}" style="font-size:12px;" title="${escHtml(scaleName)}">
                    ${isCustomAssigned ? '<i class="fas fa-check-circle" style="margin-right:4px;"></i>' : ''}${escHtml(scaleName)}
                </span>
            </td>
            <td>${escHtml(teacher?.name || '—')}</td>
            <td>${students}</td>
            <td><span class="status-pill ${c.status || 'active'}">${c.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" onclick="openClassModal('${c.id}')" title="Edit Class"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteClass('${c.id}')" title="Delete Class"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('') : emptyRow(8, 'No classes found');
}

function openClassModal(id = null) {
    adminState.editingClass = id;
    const modal = document.getElementById('classModal');
    if (!modal) return;

    document.getElementById('cm-id').value   = '';
    document.getElementById('cm-name').value  = '';
    document.getElementById('cm-level').value = 'Primary';
    document.getElementById('cm-status').value = 'active';
    populateSelect('cm-classTeacher', adminState.teachers.filter(t => t.status !== 'deleted' && !t.isDeleted), 'id', 'name', 'None');

    const teachersList = adminState.teachers.filter(t => t.status !== 'inactive');

    if (id) {
        const c = adminState.classes.find(c => c.id === id);
        if (c) {
            document.getElementById('classModalTitle').innerHTML = '<i class="fas fa-school"></i> Edit Class';
            document.getElementById('cm-id').value            = c.id;
            document.getElementById('cm-name').value          = c.name || '';
            document.getElementById('cm-level').value         = c.level || 'Primary';
            populateClassGradingScaleDropdown(c.gradingScaleId || '');
            document.getElementById('cm-classTeacher').value  = c.classTeacherId || '';
            document.getElementById('cm-status').value        = c.status || 'active';

            const assignedTeacherIds = (Array.isArray(c.assignedTeacherIds) ? c.assignedTeacherIds.slice() : []).concat(
                adminState.teachers.filter(t => (t.assignedClasses || []).includes(c.id) || (t.assignedClasses || []).includes(c.name)).map(t => t.id)
            );
            if (c.classTeacherId) assignedTeacherIds.push(c.classTeacherId);

            renderCheckboxes('cm-teachers-checkboxes', teachersList, 'id', 'name', Array.from(new Set(assignedTeacherIds)));
        }
    } else {
        document.getElementById('classModalTitle').innerHTML = '<i class="fas fa-school"></i> Add Class';
        populateClassGradingScaleDropdown('');
        renderCheckboxes('cm-teachers-checkboxes', teachersList, 'id', 'name', []);
    }
    modal.style.display = 'flex';
}

async function saveClass() {
    const id            = document.getElementById('cm-id')?.value || null;
    const name          = document.getElementById('cm-name')?.value?.trim() || '';
    const level         = document.getElementById('cm-level')?.value || 'Primary';
    const gradingScaleId= document.getElementById('cm-gradingScale')?.value || '';
    const classTeacherId= document.getElementById('cm-classTeacher')?.value || '';
    const assignedTeacherIds = getCheckedValues('cm-teachers-checkboxes');
    const status        = document.getElementById('cm-status')?.value || 'active';

    if (!name) { showToast('Class name is required.', 'error'); return; }

    const teacher = adminState.teachers.find(t => String(t.id) === String(classTeacherId));
    const allAssignedTeacherIds = Array.from(new Set(assignedTeacherIds.concat(classTeacherId ? [classTeacherId] : [])));
    const data = {
        name,
        level,
        gradingScaleId,
        classTeacherId,
        classTeacherName: teacher?.name || '',
        assignedTeacherIds: allAssignedTeacherIds,
        status
    };

    try {
        let classDocId = id;
        const isNew = !id;
        if (id) {
            const idx = adminState.classes.findIndex(c => String(c.id) === String(id));
            if (idx >= 0) adminState.classes[idx] = { ...adminState.classes[idx], ...data, id };
            showToast('Class updated!', 'success');
        } else {
            classDocId = 'cls_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            adminState.classes.push({ id: classDocId, ...data });
            showToast('Class added!', 'success');
        }

        // Update assignedClasses in memory
        for (const t of adminState.teachers) {
            const isAssigned = allAssignedTeacherIds.includes(String(t.id)) || allAssignedTeacherIds.includes(t.id);
            const classSet = new Set((t.assignedClasses || []).map(String));
            const hasClass = classSet.has(String(classDocId)) || (id && classSet.has(String(id))) || classSet.has(name);

            if (isAssigned && !hasClass) {
                classSet.add(String(classDocId));
                classSet.add(name);
                t.assignedClasses = Array.from(classSet);
            }
        }

        localStorage.setItem('teachers', JSON.stringify(adminState.teachers));
        localStorage.setItem('classes', JSON.stringify(adminState.classes));

        closeModal('classModal');
        renderClassesTable();
        renderClassTeacherMap();
        populateAllDropdowns();

        // Background cloud sync
        (async () => {
            if (id) {
                await updateDocument('classes', id, data);
            } else {
                await updateDocument('classes', classDocId, data);
            }
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('teachers', adminState.teachers); } catch (e) {}
                try { await syncSaveCollection('classes', adminState.classes); } catch (e) {}
            }
            await logActivity(isNew ? 'Class Added' : 'Class Updated', `${isNew ? 'Created' : 'Updated'} class ${name}`, classDocId);
        })().catch(e => console.warn('Background class save error:', e));
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function confirmDeleteClass(id) {
    const c = adminState.classes.find(c => c.id === id);
    showConfirm(`Delete class "${c?.name}"?`, async () => {
        await deleteDocument('classes', id);
        adminState.classes = adminState.classes.filter(c => c.id !== id);
        renderClassesTable();
        showToast('Class deleted.', 'success');
    });
}

// ─── SUBJECTS ────────────────────────────────────────────────────────────────
function renderSubjectsTable() {
    const tbody = document.getElementById('subjectsTableBody');
    if (!tbody) return;
    tbody.innerHTML = adminState.subjects.length ? adminState.subjects.map((s, i) => {
        const classNames = (s.classIds || []).map(id => resolveClass(id)).filter(Boolean).join(', ');
        return `<tr>
            <td>${i + 1}</td>
            <td>${escHtml(s.code || '—')}</td>
            <td><strong>${escHtml(s.name || '')}</strong></td>
            <td>${escHtml(classNames || '—')}</td>
            <td><span class="status-pill ${s.status || 'active'}">${s.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" onclick="openSubjectModal('${s.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteSubject('${s.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('') : emptyRow(6, 'No subjects found');
}

function openSubjectModal(id = null) {
    adminState.editingSubject = id;
    const modal = document.getElementById('subjectModal');
    if (!modal) return;

    document.getElementById('subm-id').value   = '';
    document.getElementById('subm-code').value = '';
    document.getElementById('subm-name').value = '';
    document.getElementById('subm-status').value = 'active';
    const isCoreEl = document.getElementById('subm-isCore');
    if (isCoreEl) isCoreEl.checked = false;
    renderCheckboxes('subm-classes-checkboxes', adminState.classes, 'id', 'name');

    if (id) {
        const s = adminState.subjects.find(s => s.id === id);
        if (s) {
            document.getElementById('subjectModalTitle').innerHTML = '<i class="fas fa-book-open"></i> Edit Subject';
            document.getElementById('subm-id').value     = s.id;
            document.getElementById('subm-code').value   = s.code || '';
            document.getElementById('subm-name').value   = s.name || '';
            document.getElementById('subm-status').value = s.status || 'active';
            if (isCoreEl) isCoreEl.checked = !!s.isCore;
            renderCheckboxes('subm-classes-checkboxes', adminState.classes, 'id', 'name', s.classIds || []);
        }
    } else {
        document.getElementById('subjectModalTitle').innerHTML = '<i class="fas fa-book-open"></i> Add Subject';
    }
    modal.style.display = 'flex';
}

async function saveSubject() {
    const id     = document.getElementById('subm-id')?.value || null;
    const code   = document.getElementById('subm-code')?.value?.trim() || '';
    const name   = document.getElementById('subm-name')?.value?.trim() || '';
    const status = document.getElementById('subm-status')?.value || 'active';
    const isCore = document.getElementById('subm-isCore')?.checked || false;
    const classIds = getCheckedValues('subm-classes-checkboxes');

    if (!name) { showToast('Subject name is required.', 'error'); return; }

    const data = { code, name, status, classIds, isCore };
    try {
        let subDocId = id;
        const isNew = !id;
        if (id) {
            const idx = adminState.subjects.findIndex(s => String(s.id) === String(id));
            if (idx >= 0) adminState.subjects[idx] = { ...adminState.subjects[idx], ...data, id };
            showToast('Subject updated!', 'success');
        } else {
            subDocId = 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            adminState.subjects.push({ id: subDocId, ...data });
            showToast('Subject added!', 'success');
        }
        localStorage.setItem('subjects', JSON.stringify(adminState.subjects));
        closeModal('subjectModal');
        renderSubjectsTable();
        populateAllDropdowns();

        // Background persistence
        (async () => {
            if (id) {
                await updateDocument('subjects', id, data);
            } else {
                await updateDocument('subjects', subDocId, data);
            }
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('subjects', adminState.subjects); } catch (e) {}
            }
            await logActivity(isNew ? 'Subject Added' : 'Subject Updated', `${isNew ? 'Created' : 'Updated'} subject ${name}`, subDocId);
        })().catch(e => console.warn('Background subject save error:', e));
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function confirmDeleteSubject(id) {
    const s = adminState.subjects.find(s => s.id === id);
    showConfirm(`Delete subject "${s?.name}"?`, async () => {
        await deleteDocument('subjects', id);
        adminState.subjects = adminState.subjects.filter(s => s.id !== id);
        localStorage.setItem('subjects', JSON.stringify(adminState.subjects));
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('subjects', adminState.subjects); } catch (e) {}
        }
        renderSubjectsTable();
        showToast('Subject deleted.', 'success');
    });
}

// ─── ACADEMIC YEARS ───────────────────────────────────────────────────────────
function renderAcademicYears() {
    const container = document.getElementById('academicYearsGrid');
    if (!container) return;

    if (!adminState.academicYears.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-alt"></i><p>No academic years created yet.</p></div>';
        return;
    }

    container.innerHTML = adminState.academicYears.map(year => {
        const yearTerms = adminState.terms.filter(t => t.yearId === year.id);
        return `<div class="year-card ${year.isActive ? 'active-year' : ''}">
            <div class="year-card-header">
                <div class="year-name">${escHtml(year.name)}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    ${year.isActive ? '<span class="year-active-badge">Active</span>' : ''}
                    ${!year.isActive ? `<button class="btn-admin btn-primary btn-sm" onclick="setActiveYear('${year.id}')">Set Active</button>` : ''}
                    <button class="action-btn delete" onclick="confirmDeleteYear('${year.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div class="terms-list">
                ${yearTerms.map(t => `
                    <div class="term-item">
                        <div class="term-name">
                            ${escHtml(t.name)}
                            ${t.isActive ? '<span class="status-pill approved" style="font-size:10px;">Active</span>' : ''}
                            ${t.isClosed ? '<span class="status-pill inactive" style="font-size:10px;">Closed</span>' : ''}
                        </div>
                        <div class="term-actions">
                            ${!t.isActive && !t.isClosed ? `<button class="btn-admin btn-primary btn-sm" onclick="setActiveTerm('${t.id}','${year.id}')">Set Active</button>` : ''}
                            ${t.isActive && !t.isClosed ? `<button class="btn-admin btn-warning btn-sm" onclick="closeTerm('${t.id}')">Close Term</button>` : ''}
                        </div>
                    </div>`).join('')}
                ${!yearTerms.length ? '<p style="color:#94a3b8;font-size:12px;">No terms created.</p>' : ''}
            </div>
        </div>`;
    }).join('');
}

function openAcademicYearModal() {
    document.getElementById('ay-name').value = '';
    document.getElementById('ay-setActive').checked = true;
    document.getElementById('academicYearModal').style.display = 'flex';
}

async function saveAcademicYear() {
    const name      = document.getElementById('ay-name')?.value?.trim() || '';
    const setActive = document.getElementById('ay-setActive')?.checked || false;
    const termNames = Array.from(document.querySelectorAll('.ay-term-name')).map(i => i.value.trim()).filter(Boolean);

    if (!name) { showToast('Academic year name is required.', 'error'); return; }

    try {
        if (setActive) {
            adminState.academicYears.forEach(y => { y.isActive = false; });
            adminState.terms.forEach(t => { t.isActive = false; });
        }

        const yearDocId = 'ay_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const yearDoc = { id: yearDocId, name, isActive: setActive, isArchived: false };
        adminState.academicYears.push(yearDoc);

        const newTerms = [];
        for (let i = 0; i < termNames.length; i++) {
            const isFirstTerm = i === 0 && setActive;
            const termDoc = {
                id:         'term_' + Date.now().toString(36) + '_' + i,
                name:       termNames[i],
                yearId:     yearDocId,
                termNumber: i + 1,
                isActive:   isFirstTerm,
                isClosed:   false
            };
            adminState.terms.push(termDoc);
            newTerms.push(termDoc);
        }

        localStorage.setItem('academicYears', JSON.stringify(adminState.academicYears));
        localStorage.setItem('terms', JSON.stringify(adminState.terms));
        if (setActive) persistSchoolInfoPatch({ academicYear: name, term: '1' });

        closeModal('academicYearModal');
        renderAcademicYears();
        populateAllDropdowns();
        setKPI('kpi-year', setActive ? name : document.getElementById('kpi-year')?.textContent);
        showToast(`Academic year "${name}" created!`, 'success');

        // Background persistence
        (async () => {
            if (setActive) {
                for (const y of adminState.academicYears) {
                    if (y.id !== yearDocId && y.isActive) await updateDocument('academicYears', y.id, { isActive: false });
                }
                for (const t of adminState.terms) {
                    if (!newTerms.some(nt => nt.id === t.id) && t.isActive) await updateDocument('terms', t.id, { isActive: false });
                }
            }
            await updateDocument('academicYears', yearDocId, yearDoc);
            for (const t of newTerms) {
                await updateDocument('terms', t.id, t);
            }
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('academicYears', adminState.academicYears); } catch(e) {}
                try { await syncSaveCollection('terms', adminState.terms); } catch(e) {}
            }
            await logActivity('Academic Year Created', `Created year ${name}`, yearDocId);
        })().catch(e => console.warn('Background academic year save error:', e));
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function setActiveYear(id) {
    adminState.academicYears.forEach(y => { y.isActive = y.id === id; });
    const year = adminState.academicYears.find(y => y.id === id);
    localStorage.setItem('academicYears', JSON.stringify(adminState.academicYears));
    persistSchoolInfoPatch({ academicYear: year?.name || '' });
    renderAcademicYears();
    showToast('Active academic year updated!', 'success');
    loadDashboard();

    (async () => {
        for (const y of adminState.academicYears) {
            await updateDocument('academicYears', y.id, { isActive: y.id === id });
        }
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('academicYears', adminState.academicYears); } catch(e) {}
        }
        await logActivity('Active Year Set', `Set academic year active`, id);
    })().catch(e => console.warn(e));
}

async function setActiveTerm(termId, yearId) {
    adminState.terms.forEach(t => { t.isActive = t.id === termId; });
    localStorage.setItem('terms', JSON.stringify(adminState.terms));
    const term = adminState.terms.find(t => t.id === termId);
    if (term) persistSchoolInfoPatch({ term: String(term.termNumber || term.name || '1') });
    renderAcademicYears();
    showToast('Active term updated!', 'success');
    loadDashboard();

    (async () => {
        for (const t of adminState.terms) {
            await updateDocument('terms', t.id, { isActive: t.id === termId });
        }
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('terms', adminState.terms); } catch(e) {}
        }
        await logActivity('Active Term Set', `Set active term`, termId);
    })().catch(e => console.warn(e));
}

async function closeTerm(termId) {
    showConfirm('Close this term? School days on reports will be weekdays only (weekends excluded). Results for the term will lock.', async () => {
        const today = (typeof Attendance !== 'undefined' && Attendance.todayISO()) || new Date().toISOString().slice(0, 10);
        const t = adminState.terms.find(t => t.id === termId);
        if (t) { t.isActive = false; t.isClosed = true; t.endDate = today; }
        localStorage.setItem('terms', JSON.stringify(adminState.terms));
        let days = 0;
        if (typeof Attendance !== 'undefined') {
            days = Attendance.finalizeClosedTerm(today);
        }
        renderAcademicYears();
        showToast(days ? `Term closed. Report attendance is now days present out of ${days} school days (weekends excluded).` : 'Term closed.', 'success');
        
        (async () => {
            await updateDocument('terms', termId, { isActive: false, isClosed: true, endDate: today });
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('terms', adminState.terms); } catch(e) {}
            }
            await logActivity('Term Closed', `Closed term — ${days} weekday school days`, termId);
        })().catch(e => console.warn(e));
    });
}

async function confirmDeleteYear(id) {
    const y = adminState.academicYears.find(y => y.id === id);
    showConfirm(`Delete academic year "${y?.name}"? All associated terms will also be deleted.`, async () => {
        adminState.academicYears = adminState.academicYears.filter(y => y.id !== id);
        const termIds = adminState.terms.filter(t => t.yearId === id).map(t => t.id);
        adminState.terms = adminState.terms.filter(t => t.yearId !== id);
        localStorage.setItem('academicYears', JSON.stringify(adminState.academicYears));
        localStorage.setItem('terms', JSON.stringify(adminState.terms));
        renderAcademicYears();
        showToast('Academic year deleted.', 'success');

        (async () => {
            await deleteDocument('academicYears', id);
            for (const tid of termIds) await deleteDocument('terms', tid);
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('academicYears', adminState.academicYears); } catch(e) {}
                try { await syncSaveCollection('terms', adminState.terms); } catch(e) {}
            }
        })().catch(e => console.warn(e));
    });
}

// ─── GRADING SYSTEM (MULTIPLE ACTIVE BY DEPARTMENT & CUSTOM CLASS ASSIGNMENT) ─────
function renderGradingScales() {
    const container = document.getElementById('gradingScalesContainer');
    if (!container) return;

    if (!adminState.gradingScales.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-star-half-alt"></i><p>No grading scales configured. Create one to get started.</p></div>';
        return;
    }

    container.innerHTML = adminState.gradingScales.map(scale => {
        const dept = scale.department || 'All';
        const isActive = scale.isActive !== false;
        const assignedClasses = (adminState.classes || []).filter(c => 
            String(c.gradingScaleId) === String(scale.id) || 
            String(c.gradingScaleId) === String(scale.name)
        );

        return `
        <div class="scale-card ${isActive ? 'active-scale' : ''}">
            <div class="scale-card-header">
                <div>
                    <div class="scale-name" style="font-weight:700;font-size:15px;">${escHtml(scale.name)}</div>
                    <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                        <span class="status-pill published" style="font-size:11px;">Department: ${escHtml(dept)}</span>
                        ${isActive ? '<span class="scale-active-badge">Active</span>' : '<span class="status-pill inactive" style="font-size:11px;">Inactive</span>'}
                        ${assignedClasses.length > 0 ? `<span class="status-pill active" style="font-size:11px;"><i class="fas fa-school" style="margin-right:3px;"></i> ${assignedClasses.length} ${assignedClasses.length === 1 ? 'Class' : 'Classes'} Assigned</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button class="btn-admin btn-ghost btn-sm" onclick="openAssignClassesToScaleModal('${scale.id}')" title="Assign directly to classes">
                        <i class="fas fa-link"></i> Assign Classes
                    </button>
                    ${isActive 
                        ? `<button class="btn-admin btn-ghost btn-sm" onclick="toggleActiveGradingScale('${scale.id}')">Deactivate</button>` 
                        : `<button class="btn-admin btn-primary btn-sm" onclick="toggleActiveGradingScale('${scale.id}')">Set Active</button>`}
                    <button class="action-btn" onclick="openGradingScaleModal('${scale.id}')" title="Edit Scale"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteGradingScale('${scale.id}')" title="Delete Scale"><i class="fas fa-trash"></i></button>
                </div>
            </div>

            <!-- Assigned Classes Row -->
            <div style="margin-top:10px;padding:8px 12px;background:var(--bg-secondary,#f8fafc);border-radius:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;border:1px solid var(--border,#e2e8f0);">
                <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                    <span style="font-weight:600;color:var(--text-primary,#1e293b);"><i class="fas fa-layer-group" style="color:var(--primary,#4f46e5);margin-right:4px;"></i> Custom Assigned Classes:</span>
                    ${assignedClasses.length > 0 
                        ? assignedClasses.map(c => `<span class="status-pill active" style="font-size:11px;padding:2px 8px;">${escHtml(c.name)}</span>`).join('') 
                        : '<span style="color:var(--text-secondary,#94a3b8);font-style:italic;">None (Uses department default)</span>'}
                </div>
                <button class="btn-admin btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;" onclick="openAssignClassesToScaleModal('${scale.id}')">
                    <i class="fas fa-plus"></i> / <i class="fas fa-minus"></i> Change
                </button>
            </div>

            <table class="scale-table" style="margin-top:10px;">
                <thead><tr><th>Min</th><th>Max</th><th>Grade</th><th>Remark</th><th>Description</th></tr></thead>
                <tbody>
                    ${(scale.items || scale.ranges || []).map(item => `<tr>
                        <td>${item.min}</td><td>${item.max}</td>
                        <td><strong>${escHtml(item.grade)}</strong></td>
                        <td>${escHtml(item.remark)}</td>
                        <td>${escHtml(item.description || '')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    }).join('');
}

function openGradingScaleModal(id = null) {
    adminState.editingGrading = id;
    document.getElementById('gs-id').value = '';
    document.getElementById('gs-name').value = '';
    const deptEl = document.getElementById('gs-department');
    if (deptEl) deptEl.value = 'Primary';
    document.getElementById('gs-isActive').checked = true;

    const defaultRows = [
        { min: 80, max: 100, grade: 'A',  remark: 'ADVANCE', description: '' },
        { min: 68, max: 79,  grade: 'P',  remark: 'PROFICIENCY', description: '' },
        { min: 54, max: 67,  grade: 'AP', remark: 'APPROACHING PROFICIENCY', description: '' },
        { min: 40, max: 53,  grade: 'D',  remark: 'DEVELOPING', description: '' },
        { min: 0,  max: 39,  grade: 'B',  remark: 'BEGINNER', description: '' },
    ];

    let rows = defaultRows;
    let assignedClassIds = [];

    if (id) {
        const scale = adminState.gradingScales.find(s => String(s.id) === String(id));
        if (scale) {
            document.getElementById('gs-id').value = scale.id;
            document.getElementById('gs-name').value = scale.name || '';
            if (deptEl) deptEl.value = scale.department || 'Primary';
            document.getElementById('gs-isActive').checked = scale.isActive !== false;
            rows = scale.items || scale.ranges || defaultRows;

            assignedClassIds = (adminState.classes || [])
                .filter(c => String(c.gradingScaleId) === String(scale.id) || String(c.gradingScaleId) === String(scale.name))
                .map(c => c.id);
        }
    }

    renderGradeRows(rows);

    // Populate Class Assignment Checkboxes in Grading Scale Modal
    const activeClasses = (adminState.classes || []).filter(c => c.status !== 'inactive');
    renderCheckboxes('gs-classes-checkboxes', activeClasses, 'id', 'name', assignedClassIds);

    document.getElementById('gradingScaleModal').style.display = 'flex';
}

function applyGradingPreset(type) {
    if (type === 'jhs') {
        document.getElementById('gs-name').value = 'JHS Stanine Scale (1-9)';
        const deptEl = document.getElementById('gs-department');
        if (deptEl) deptEl.value = 'JHS';
        renderGradeRows([
            { min:80, max:100, grade:'1', remark:'EXCELLENT', description:'Highest standard' },
            { min:70, max:79,  grade:'2', remark:'VERY GOOD', description:'High achievement' },
            { min:65, max:69,  grade:'3', remark:'GOOD', description:'Above average' },
            { min:60, max:64,  grade:'4', remark:'CREDIT', description:'Competent' },
            { min:55, max:59,  grade:'5', remark:'AVERAGE', description:'Acceptable standard' },
            { min:50, max:54,  grade:'6', remark:'PASS', description:'Borderline standard' },
            { min:45, max:49,  grade:'7', remark:'WEAK PASS', description:'Marginal' },
            { min:40, max:44,  grade:'8', remark:'FAIL', description:'Below minimum standard' },
            { min:0,  max:39,  grade:'9', remark:'FAIL', description:'Lowest standard' }
        ]);
    } else if (type === 'primary') {
        document.getElementById('gs-name').value = 'Ghana Primary Scale (A-B)';
        const deptEl = document.getElementById('gs-department');
        if (deptEl) deptEl.value = 'Primary';
        renderGradeRows([
            { min:80, max:100, grade:'A',  remark:'ADVANCE', description:'Demonstrates deep understanding' },
            { min:68, max:79,  grade:'P',  remark:'PROFICIENCY', description:'Demonstrates sound understanding' },
            { min:54, max:67,  grade:'AP', remark:'APPROACHING PROFICIENCY', description:'Developing required skills' },
            { min:40, max:53,  grade:'D',  remark:'DEVELOPING', description:'Basic comprehension' },
            { min:0,  max:39,  grade:'B',  remark:'BEGINNER', description:'Needs focused assistance' }
        ]);
    } else if (type === 'letter') {
        document.getElementById('gs-name').value = 'Standard Letter Grade System (A-F)';
        const deptEl = document.getElementById('gs-department');
        if (deptEl) deptEl.value = 'All';
        renderGradeRows([
            { min:90, max:100, grade:'A+', remark:'EXCELLENT', description:'Outstanding mastery' },
            { min:80, max:89,  grade:'A',  remark:'VERY GOOD',  description:'High level of achievement' },
            { min:70, max:79,  grade:'B',  remark:'GOOD',       description:'Competent performance' },
            { min:60, max:69,  grade:'C',  remark:'CREDIT',     description:'Satisfactory understanding' },
            { min:50, max:59,  grade:'D',  remark:'PASS',       description:'Minimum passing standard' },
            { min:0,  max:49,  grade:'F',  remark:'FAIL',       description:'Needs substantial improvement' }
        ]);
    }
}

function renderGradeRows(rows) {
    const container = document.getElementById('gradeRowsContainer');
    if (!container) return;
    container.innerHTML = rows.map((r, i) => gradeRowHTML(r, i)).join('');
}

function gradeRowHTML(r = {}, i) {
    return `<div class="grade-row" data-idx="${i}">
        <input type="number" class="grade-min" placeholder="Min" value="${r.min ?? ''}">
        <input type="number" class="grade-max" placeholder="Max" value="${r.max ?? ''}">
        <input type="text" class="grade-grade" placeholder="Grade" value="${r.grade ?? ''}">
        <input type="text" class="grade-remark" placeholder="Remark" value="${r.remark ?? ''}">
        <input type="text" class="grade-description" placeholder="Description" value="${r.description ?? ''}">
        <button class="remove-grade" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    </div>`;
}

function addGradeRow() {
    const container = document.getElementById('gradeRowsContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.innerHTML = gradeRowHTML({}, container.children.length);
    container.appendChild(div.firstElementChild);
}

async function saveGradingScale() {
    const id         = document.getElementById('gs-id')?.value || null;
    const name       = document.getElementById('gs-name')?.value?.trim() || '';
    const department = document.getElementById('gs-department')?.value || 'Primary';
    const isActive   = document.getElementById('gs-isActive')?.checked || false;

    if (!name) { showToast('Grading scale name is required.', 'error'); return; }

    const rows = Array.from(document.querySelectorAll('.grade-row')).map(row => ({
        min:         parseFloat(row.querySelector('.grade-min')?.value) || 0,
        max:         parseFloat(row.querySelector('.grade-max')?.value) || 0,
        grade:       row.querySelector('.grade-grade')?.value?.trim() || '',
        remark:      row.querySelector('.grade-remark')?.value?.trim() || '',
        description: row.querySelector('.grade-description')?.value?.trim() || '',
    })).filter(r => r.grade);

    const data = { name, department, isActive, items: rows, ranges: rows };

    // 0ms instant UI update
    if (isActive) {
        adminState.gradingScales.forEach(s => {
            if (s.department === department && String(s.id) !== String(id)) {
                s.isActive = false;
            }
        });
    }

    let scaleId = id;
    const isNew = !id;
    if (id) {
        const idx = adminState.gradingScales.findIndex(s => String(s.id) === String(id));
        if (idx >= 0) adminState.gradingScales[idx] = { ...adminState.gradingScales[idx], ...data, id };
    } else {
        scaleId = 'gs_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        adminState.gradingScales.push({ id: scaleId, ...data });
    }

    // Process Custom Class Assignments
    const checkedClassIds = getCheckedValues('gs-classes-checkboxes');
    let classesUpdated = false;

    (adminState.classes || []).forEach(c => {
        const isChecked = checkedClassIds.includes(String(c.id));
        const wasAssigned = String(c.gradingScaleId) === String(scaleId) || (id && String(c.gradingScaleId) === String(id));

        if (isChecked && c.gradingScaleId !== scaleId) {
            c.gradingScaleId = scaleId;
            classesUpdated = true;
        } else if (!isChecked && wasAssigned) {
            c.gradingScaleId = '';
            classesUpdated = true;
        }
    });

    if (classesUpdated) {
        localStorage.setItem('classes', JSON.stringify(adminState.classes));
        renderClassesTable();
    }

    localStorage.setItem('gradingScales', JSON.stringify(adminState.gradingScales));
    closeModal('gradingScaleModal');
    renderGradingScales();
    showToast('Grading scale saved successfully!', 'success');

    // Background sync
    (async () => {
        if (id) {
            await updateDocument('gradingScales', id, data);
        } else {
            await updateDocument('gradingScales', scaleId, data);
        }
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('gradingScales', adminState.gradingScales); } catch (e) {}
            if (classesUpdated) {
                try { await syncSaveCollection('classes', adminState.classes); } catch (e) {}
            }
        }
        await logActivity(isNew ? 'Grading Scale Created' : 'Grading Scale Updated', `Saved grading scale ${name} for ${department}`, scaleId);
    })().catch(e => console.warn('Background grading save error:', e));
}

// Open Quick Modal to Assign Classes to a Grading Scheme
function openAssignClassesToScaleModal(scaleId) {
    const scale = (adminState.gradingScales || []).find(s => String(s.id) === String(scaleId));
    if (!scale) return;

    const modal = document.getElementById('assignScaleClassesModal');
    if (!modal) return;

    document.getElementById('asc-scaleId').value = scaleId;
    document.getElementById('assignScaleModalTitle').innerHTML = `<i class="fas fa-link"></i> Assign "${escHtml(scale.name)}" to Classes`;
    document.getElementById('assignScaleDescription').textContent = `Select which classes should strictly use the "${scale.name}" grading scheme:`;

    const assignedClassIds = (adminState.classes || [])
        .filter(c => String(c.gradingScaleId) === String(scaleId) || String(c.gradingScaleId) === String(scale.name))
        .map(c => c.id);

    const activeClasses = (adminState.classes || []).filter(c => c.status !== 'inactive');
    renderCheckboxes('asc-classes-checkboxes', activeClasses, 'id', 'name', assignedClassIds);

    modal.style.display = 'flex';
}

// Save Class Assignments from Quick Modal
async function saveScaleClassAssignments() {
    const scaleId = document.getElementById('asc-scaleId')?.value;
    if (!scaleId) return;

    const scale = (adminState.gradingScales || []).find(s => String(s.id) === String(scaleId));
    const scaleName = scale ? scale.name : scaleId;
    const checkedClassIds = getCheckedValues('asc-classes-checkboxes');

    let classesUpdated = false;
    (adminState.classes || []).forEach(c => {
        const isChecked = checkedClassIds.includes(String(c.id));
        const wasAssigned = String(c.gradingScaleId) === String(scaleId);

        if (isChecked && c.gradingScaleId !== scaleId) {
            c.gradingScaleId = scaleId;
            classesUpdated = true;
        } else if (!isChecked && wasAssigned) {
            c.gradingScaleId = '';
            classesUpdated = true;
        }
    });

    if (classesUpdated) {
        localStorage.setItem('classes', JSON.stringify(adminState.classes));
        renderClassesTable();
    }

    closeModal('assignScaleClassesModal');
    renderGradingScales();
    showToast(`Assigned "${scaleName}" to ${checkedClassIds.length} ${checkedClassIds.length === 1 ? 'class' : 'classes'}!`, 'success');

    // Background sync
    (async () => {
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('classes', adminState.classes); } catch (e) {}
        }
        await logActivity('Grading Scale Assigned', `Assigned scale ${scaleName} to ${checkedClassIds.length} classes`, scaleId);
    })().catch(e => console.warn(e));
}

async function toggleActiveGradingScale(id) {
    const target = adminState.gradingScales.find(s => String(s.id) === String(id));
    if (!target) return;
    const willBeActive = !target.isActive;
    target.isActive = willBeActive;

    if (willBeActive && target.department) {
        adminState.gradingScales.forEach(s => {
            if (s.department === target.department && String(s.id) !== String(id)) {
                s.isActive = false;
            }
        });
    }

    localStorage.setItem('gradingScales', JSON.stringify(adminState.gradingScales));
    renderGradingScales();
    showToast(`Grading scale "${target.name}" is now ${willBeActive ? 'Active' : 'Inactive'}.`, 'success');

    (async () => {
        for (const s of adminState.gradingScales) {
            try { await updateDocument('gradingScales', s.id, { isActive: s.isActive }); } catch(e) {}
        }
        if (typeof syncSaveCollection === 'function') {
            try { await syncSaveCollection('gradingScales', adminState.gradingScales); } catch (e) {}
        }
    })().catch(e => console.warn(e));
}

async function confirmDeleteGradingScale(id) {
    const s = adminState.gradingScales.find(s => s.id === id);
    showConfirm(`Delete grading scale "${s?.name}"?`, async () => {
        adminState.gradingScales = adminState.gradingScales.filter(s => s.id !== id);
        localStorage.setItem('gradingScales', JSON.stringify(adminState.gradingScales));
        renderGradingScales();
        showToast('Grading scale deleted.', 'success');

        (async () => {
            await deleteDocument('gradingScales', id);
            if (typeof syncSaveCollection === 'function') {
                try { await syncSaveCollection('gradingScales', adminState.gradingScales); } catch(e) {}
            }
        })().catch(e => console.warn(e));
    });
}

// ── DEPARTMENT MANAGEMENT ────────────────────────────────────────────────────────
function getSchoolDepartments() {
    try {
        const raw = localStorage.getItem('schoolDepartments');
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveSchoolDepartments(depts) {
    localStorage.setItem('schoolDepartments', JSON.stringify(depts));
    if (typeof syncSaveCollection === 'function') {
        syncSaveCollection('schoolDepartments', depts).catch(() => {});
    }
}

function renderDepartmentsSetting() {
    const container = document.getElementById('departmentsListContainer');
    if (!container) return;
    const depts = getSchoolDepartments();
    if (!depts.length) {
        container.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:8px 0;">No departments yet. Add one above.</div>';
        return;
    }
    container.innerHTML = depts.map((d, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;">
            <div>
                <strong style="font-size:13px;">${escHtml(d.name)}</strong>
                ${d.gradingType ? `<span style="font-size:11px;color:#6366f1;margin-left:8px;">(${escHtml(d.gradingType)})</span>` : ''}
            </div>
            <button class="action-btn delete" onclick="removeDepartment(${i})" title="Remove"><i class="fas fa-trash"></i></button>
        </div>`);
    populateDepartmentDropdowns();
}

function addDepartmentSetting() {
    const input = document.getElementById('newDepartmentName');
    const gradingType = document.getElementById('newDepartmentGrading');
    const name = input ? input.value.trim() : '';
    if (!name) { showToast('Enter a department name.', 'error'); return; }
    const depts = getSchoolDepartments();
    if (depts.some(d => d.name.toLowerCase() === name.toLowerCase())) {
        showToast('Department already exists.', 'warning'); return;
    }
    depts.push({ name, gradingType: gradingType ? gradingType.value : 'standard' });
    saveSchoolDepartments(depts);
    if (input) input.value = '';
    renderDepartmentsSetting();
    showToast(`Department "${name}" added.`, 'success');
}

function removeDepartment(index) {
    const depts = getSchoolDepartments();
    const d = depts[index];
    showConfirm(`Remove department "${d?.name}"?`, () => {
        depts.splice(index, 1);
        saveSchoolDepartments(depts);
        renderDepartmentsSetting();
        showToast('Department removed.', 'success');
    });
}

function populateDepartmentDropdowns() {
    const depts = getSchoolDepartments();
    const selectors = [
        '#cm-department', '#subm-department', '#gs-department',
        '#tm-department', '#studentDeptFilter'
    ];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            const cur = el.value;
            el.innerHTML = '<option value="">-- Select Department --</option>' +
                depts.map(d => `<option value="${escHtml(d.name)}" ${cur === d.name ? 'selected' : ''}>${escHtml(d.name)}</option>`).join('');
        });
    });
}

// Department helper to get grading type
function getDeptGradingType(departmentName) {
    if (!departmentName) return 'standard';
    const depts = getSchoolDepartments();
    const d = depts.find(x => x.name.toLowerCase() === departmentName.toLowerCase());
    return d?.gradingType || 'standard';
}

// JHS detection helper
function isJHSDepartment(className, department) {
    const jhs = ['basic 7','basic 8','basic 9','jhs 1','jhs 2','jhs 3','jhs'];
    const cn = String(className || '').toLowerCase();
    const dep = String(department || '').toLowerCase();
    return jhs.some(k => cn.includes(k) || dep.includes(k)) || getDeptGradingType(department) === 'jhs';
}

// Get JHS stanine grade
const JHS_SCALE = [
    { min:80, max:100, grade:'1', remark:'EXCELLENT' },
    { min:70, max:79,  grade:'2', remark:'VERY GOOD' },
    { min:65, max:69,  grade:'3', remark:'GOOD' },
    { min:60, max:64,  grade:'4', remark:'CREDIT' },
    { min:55, max:59,  grade:'5', remark:'AVERAGE' },
    { min:50, max:54,  grade:'6', remark:'PASS' },
    { min:45, max:49,  grade:'7', remark:'WEAK PASS' },
    { min:40, max:44,  grade:'8', remark:'FAIL' },
    { min:0,  max:39,  grade:'9', remark:'FAIL' }
];

function getGradeForDept(score, isJHS, deptOrClassName = '', classId = '') {
    const t = Math.max(0, Math.min(100, Number(score) || 0));

    // 0. Check custom class scale override via getGradingScaleForClass
    const classRef = classId || deptOrClassName;
    if (classRef && typeof getGradingScaleForClass === 'function') {
        const clsScale = getGradingScaleForClass(classRef);
        if (clsScale && Array.isArray(clsScale) && clsScale.length > 0) {
            return clsScale.find(g => t >= g.min && t <= g.max) || clsScale[clsScale.length - 1];
        }
    }

    let targetDept = 'Primary';
    if (isJHS) {
        targetDept = 'JHS';
    } else if (typeof deptOrClassName === 'string' && deptOrClassName) {
        const lower = deptOrClassName.toLowerCase();
        if (lower.includes('jhs') || lower.includes('basic 7') || lower.includes('basic 8') || lower.includes('basic 9')) targetDept = 'JHS';
        else if (lower.includes('kg') || lower.includes('nursery') || lower.includes('kindergarten')) targetDept = 'Kindergarten';
        else targetDept = 'Primary';
    }

    const scales = adminState.gradingScales || [];
    // 1. Look for active scale specifically for this department
    const deptScale = scales.find(s => s.isActive && (s.department === targetDept || (targetDept === 'JHS' && (s.name || '').toLowerCase().includes('jhs')) || (targetDept === 'Primary' && (s.name || '').toLowerCase().includes('primary'))));
    if (deptScale && (deptScale.items || deptScale.ranges)) {
        const list = deptScale.items || deptScale.ranges;
        return list.find(g => t >= g.min && t <= g.max) || list[list.length - 1];
    }

    // 2. Look for any active scale matching 'All'
    const allScale = scales.find(s => s.isActive && s.department === 'All');
    if (allScale && (allScale.items || allScale.ranges)) {
        const list = allScale.items || allScale.ranges;
        return list.find(g => t >= g.min && t <= g.max) || list[list.length - 1];
    }

    // Fallbacks
    if (targetDept === 'JHS') return JHS_SCALE.find(g => t >= g.min && t <= g.max) || JHS_SCALE[JHS_SCALE.length - 1];
    return [
        { min:80, max:100, grade:'A', remark:'ADVANCE' },
        { min:68, max:79,  grade:'P', remark:'PROFICIENCY' },
        { min:54, max:67,  grade:'AP', remark:'APPROACHING PROFICIENCY' },
        { min:40, max:53,  grade:'D',  remark:'DEVELOPING' },
        { min:0,  max:39,  grade:'B',  remark:'BEGINNER' }
    ].find(g => t >= g.min && t <= g.max) || { grade: 'B', remark: 'BEGINNER' };
}

function syncScoresIntoResults() {
    try {
        let addedCount = 0;
        // 1. Sync from localStorage 'results'
        const storedResults = JSON.parse(localStorage.getItem('results') || '[]');
        storedResults.forEach(r => {
            const existing = adminState.results.find(ar =>
                String(ar.id) === String(r.id) ||
                (String(ar.studentId) === String(r.studentId) &&
                (ar.subjectId === r.subjectId || ar.subjectName === r.subjectName) &&
                String(ar.classId) === String(r.classId))
            );
            if (!existing) {
                adminState.results.push(r);
                addedCount++;
            }
        });

        // 2. Also sync from localStorage 'scores' bag (teacher portal direct mark entries)
        const scoresBag = JSON.parse(localStorage.getItem('scores') || '{}');
        const activeYear = adminState.academicYears.find(y => y.isActive);
        const activeTerm = adminState.terms.find(t => t.isActive);

        Object.keys(scoresBag).forEach(subName => {
            const studentScores = scoresBag[subName] || {};
            Object.keys(studentScores).forEach(studentId => {
                const se = studentScores[studentId];
                if (!se || (se.classScore === '' && se.examScore === '' && se.totalScore === '')) return;

                const student = adminState.students.find(s => String(s.id) === String(studentId));
                const classId = student?.classId || student?.class || '';

                // Resolve real subject object so we store the proper ID, not just the name
                const subjectsList = adminState.subjects || JSON.parse(localStorage.getItem('subjects') || '[]');
                const subObj = subjectsList.find(s => s.name === subName || String(s.id) === subName || s.code === subName);
                const resolvedSubName = subObj?.name || subName;
                const resolvedSubId   = subObj?.id   || subName;

                // Normalize for dedup comparison
                const subNameN = resolvedSubName.toLowerCase().trim();
                const subIdN   = String(resolvedSubId).toLowerCase().trim();

                const existing = adminState.results.find(ar =>
                    String(ar.studentId) === String(studentId) &&
                    (
                        String(ar.subjectName || '').toLowerCase().trim() === subNameN ||
                        String(ar.subjectId   || '').toLowerCase().trim() === subIdN   ||
                        String(ar.subjectId   || '').toLowerCase().trim() === subNameN ||
                        String(ar.subjectName || '').toLowerCase().trim() === subIdN
                    )
                );

                if (!existing) {
                    const csVal = (se.classScore !== '' && se.classScore != null) ? Number(se.classScore) : '';
                    const esVal = (se.examScore !== '' && se.examScore != null) ? Number(se.examScore) : '';
                    const cs50 = csVal !== '' ? Math.round((csVal / 100) * 50 * 10) / 10 : '';
                    const es50 = esVal !== '' ? Math.round((esVal / 100) * 50 * 10) / 10 : '';
                    const totVal = (cs50 !== '' && es50 !== '') ? Math.round((cs50 + es50) * 10) / 10 : (se.totalScore || '');
                    const className = resolveClass(classId);
                    const isJHS = isJHSDepartment(className);
                    const g = totVal !== '' ? getGradeForDept(totVal, isJHS) : { grade: se.grade || '', remark: se.remark || '' };

                    const newRes = {
                        id: 'res_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        studentId: String(studentId),
                        studentName: student?.name || '',
                        classId: classId,
                        subjectId: resolvedSubId,
                        subjectName: resolvedSubName,
                        classScore: csVal,
                        examScore: esVal,
                        classScore50: cs50,
                        examScore50: es50,
                        totalScore: totVal,
                        grade: g.grade,
                        remark: g.remark,
                        status: 'Submitted',
                        locked: false,
                        academicYearId: activeYear?.id || '',
                        termId: activeTerm?.id || '',
                        updatedAt: new Date().toISOString()
                    };
                    adminState.results.push(newRes);
                    addedCount++;
                }
            });
        });

        if (addedCount > 0) {
            localStorage.setItem('results', JSON.stringify(adminState.results));
            if (typeof syncSaveCollection === 'function') {
                try { syncSaveCollection('results', adminState.results); } catch (e) {}
            }
        }
    } catch(e) {
        console.warn('syncScoresIntoResults error:', e);
    }
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function persistResults() {
    localStorage.setItem('results', JSON.stringify(adminState.results));
    if (typeof syncSaveCollection === 'function') {
        try { syncSaveCollection('results', adminState.results); } catch (e) {}
    }
}

/**
 * Collapses duplicate result entries in the admin state (same student + subject).
 * Keeps latest updatedAt; Approved/Published status wins regardless of age.
 */
function deduplicateAdminResults(arr) {
    const seen = new Map();
    arr.forEach(r => {
        const subNorm = String(r.subjectName || r.subjectId || '').toLowerCase().trim();
        const key = String(r.studentId) + '|' + subNorm;
        if (!seen.has(key)) {
            seen.set(key, Object.assign({}, r));
        } else {
            const prev = seen.get(key);
            const prevDate = new Date(prev.updatedAt || 0).getTime();
            const curDate  = new Date(r.updatedAt  || 0).getTime();
            const winner   = curDate >= prevDate ? r : prev;
            const statusRank = s => ['approved','published'].includes((s||'').toLowerCase()) ? 2 : 1;
            const bestStatus = statusRank(r.status) >= statusRank(prev.status) ? r.status : prev.status;
            const bestSubjectId = (prev.subjectId && prev.subjectId !== prev.subjectName)
                ? prev.subjectId
                : (r.subjectId || prev.subjectId);
            seen.set(key, Object.assign({}, winner, { status: bestStatus, subjectId: bestSubjectId, subjectName: winner.subjectName || prev.subjectName }));
        }
    });
    return Array.from(seen.values());
}

function renderResultsTable() {

    const yearF    = document.getElementById('resultsFilterYear')?.value   || '';
    const termF    = document.getElementById('resultsFilterTerm')?.value   || '';
    const classF   = document.getElementById('resultsFilterClass')?.value  || '';
    const statusF  = document.getElementById('resultsFilterStatus')?.value || '';
    const subjectF = document.getElementById('resultsFilterSubject')?.value || '';
    const search   = (document.getElementById('resultsFilterSearch')?.value || '').toLowerCase();

    let data = adminState.results;
    if (yearF)    data = data.filter(r => r.academicYearId === yearF);
    if (termF)    data = data.filter(r => r.termId === termF);
    if (classF)   data = data.filter(r => r.classId === classF);
    if (statusF)  data = data.filter(r => r.status === statusF);
    if (subjectF) data = data.filter(r => (resolveSubject(r.subjectName || r.subjectId) === subjectF || r.subjectId === subjectF || r.subjectName === subjectF));
    if (search)   data = data.filter(r => {
        const s = adminState.students.find(s => s.id === r.studentId);
        const stuName = (s?.name || r.studentName || '').toLowerCase();
        const subName = (resolveSubject(r.subjectName || r.subjectId) || '').toLowerCase();
        return stuName.includes(search) || subName.includes(search) || (r.subjectId || '').toLowerCase().includes(search);
    });

    // Populate subject filter dropdown if present
    const subjectFilterEl = document.getElementById('resultsFilterSubject');
    if (subjectFilterEl && subjectFilterEl.options.length <= 1) {
        const allSubs = [...new Set(adminState.results.map(r => resolveSubject(r.subjectName || r.subjectId)).filter(Boolean))];
        allSubs.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub;
            opt.textContent = sub;
            subjectFilterEl.appendChild(opt);
        });
        if (subjectF) subjectFilterEl.value = subjectF;
    }

    const page  = adminState.resultPage;
    const total = data.length;
    const start = (page - 1) * adminState.resultsPerPage;
    const paged = data.slice(start, start + adminState.resultsPerPage);

    const tbody = document.getElementById('resultsTableBody');
    if (!tbody) return;

    tbody.innerHTML = paged.length ? paged.map(r => {
        const student = adminState.students.find(s => s.id === r.studentId);
        const status  = r.status || 'Draft';
        const locked  = r.locked ? 'locked' : 'unlocked';
        const csDisplay = r.classScore50 !== undefined && r.classScore50 !== '' ? r.classScore50 : (r.classScore != null && r.classScore !== '' ? Math.round((Number(r.classScore)/100)*50*10)/10 : '—');
        const esDisplay = r.examScore50 !== undefined && r.examScore50 !== '' ? r.examScore50 : (r.examScore != null && r.examScore !== '' ? Math.round((Number(r.examScore)/100)*50*10)/10 : '—');
        const displaySubject = resolveSubject(r.subjectName || r.subjectId) || '—';
        return `<tr>
            <td><input type="checkbox" class="result-checkbox" value="${r.id}" onchange="handleResultCheckbox()"></td>
            <td>${escHtml(student?.name || r.studentName || r.studentId || '—')}</td>
            <td>${escHtml(resolveClass(r.classId))}</td>
            <td>${escHtml(displaySubject)}</td>
            <td>${csDisplay}</td>
            <td>${esDisplay}</td>
            <td><strong>${r.totalScore ?? '—'}</strong></td>
            <td>${r.grade ?? '—'}</td>
            <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
            <td><span class="lock-badge ${locked}"><i class="fas fa-${locked === 'locked' ? 'lock' : 'lock-open'}"></i></span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" title="Edit Result" onclick="openEditResultModal('${r.id}')"><i class="fas fa-edit"></i></button>
                    ${['submitted','draft','reviewed'].includes((r.status||'').toLowerCase()) ? `<button class="action-btn success" title="Approve Result" onclick="approveResult('${r.id}')"><i class="fas fa-check"></i></button>` : ''}
                    ${['approved','published'].includes((r.status||'').toLowerCase()) ? `<button class="action-btn warning" title="Revoke Approval" onclick="revokeResult('${r.id}')"><i class="fas fa-undo"></i></button>` : ''}
                    <button class="action-btn ${r.locked ? 'warning' : 'secondary'}" title="${r.locked ? 'Unlock Mark Entry' : 'Lock Mark Entry'}" onclick="${r.locked ? `unlockResult('${r.id}')` : `lockResult('${r.id}')`}"><i class="fas fa-${r.locked ? 'unlock' : 'lock'}"></i></button>
                    <button class="action-btn delete" title="Delete Result" onclick="confirmDeleteResult('${r.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('') : emptyRow(11, 'No results found');

    const countEl = document.getElementById('resultsCount');
    if (countEl) countEl.textContent = `${total} results`;

    renderPagination('resultsPagination', total, adminState.resultsPerPage, page, (p) => {
        adminState.resultPage = p;
        renderResultsTable();
    });
}

function handleResultCheckbox() {
    const checkboxes = document.querySelectorAll('.result-checkbox');
    const checked = Array.from(checkboxes).filter(c => c.checked).length;
    const bulkBar = document.getElementById('resultsBulkActions');
    const countEl = document.getElementById('selectedResultsCount');
    const selectAllCb = document.getElementById('selectAllResults');
    if (bulkBar) bulkBar.style.display = checked > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${checked} selected`;
    if (selectAllCb) selectAllCb.checked = checked > 0 && checked === checkboxes.length;
}

function toggleSelectAllResults(cb) {
    document.querySelectorAll('.result-checkbox').forEach(c => { c.checked = cb.checked; });
    handleResultCheckbox();
}

function getSelectedResultIds() {
    return Array.from(document.querySelectorAll('.result-checkbox:checked')).map(c => c.value).filter(Boolean);
}

function openEditResultModal(id) {
    const r = adminState.results.find(x => String(x.id) === String(id));
    if (!r) { showToast('Result record not found.', 'error'); return; }
    const student = adminState.students.find(s => String(s.id) === String(r.studentId));
    
    document.getElementById('erm-id').value = r.id;
    document.getElementById('erm-student').value = student?.name || r.studentName || 'Student #' + r.studentId;
    document.getElementById('erm-class').value = resolveClass(r.classId);
    document.getElementById('erm-subject').value = resolveSubject(r.subjectName || r.subjectId) || '';
    document.getElementById('erm-classScore').value = (r.classScore !== undefined && r.classScore !== null) ? r.classScore : '';
    document.getElementById('erm-examScore').value = (r.examScore !== undefined && r.examScore !== null) ? r.examScore : '';
    document.getElementById('erm-status').value = r.status || 'Draft';
    calculateErmTotal();

    document.getElementById('editResultModal').style.display = 'flex';
}

function calculateErmTotal() {
    const cs = document.getElementById('erm-classScore')?.value;
    const es = document.getElementById('erm-examScore')?.value;
    const totEl = document.getElementById('erm-totalScore');
    const grEl = document.getElementById('erm-grade');
    if (!totEl || !grEl) return;

    if (cs !== '' && es !== '' && !isNaN(cs) && !isNaN(es)) {
        const cs50 = Math.round((Number(cs) / 100) * 50 * 10) / 10;
        const es50 = Math.round((Number(es) / 100) * 50 * 10) / 10;
        const tot = Math.round((cs50 + es50) * 10) / 10;
        totEl.value = tot;
        const className = document.getElementById('erm-class')?.value || '';
        const isJHS = isJHSDepartment(className);
        const g = getGradeForDept(tot, isJHS);
        grEl.value = `${g.grade} — ${g.remark}`;
    } else {
        totEl.value = '';
        grEl.value = '—';
    }
}

function saveEditedResult() {
    const id = document.getElementById('erm-id')?.value;
    const r = adminState.results.find(x => String(x.id) === String(id));
    if (!r) return;

    const cs = document.getElementById('erm-classScore')?.value?.trim();
    const es = document.getElementById('erm-examScore')?.value?.trim();
    const status = document.getElementById('erm-status')?.value || 'Submitted';

    let csVal = '', esVal = '', cs50 = '', es50 = '', totVal = '', gradeVal = '', remarkVal = '';
    if (cs !== '' && !isNaN(cs)) {
        csVal = Math.max(0, Math.min(100, Number(cs)));
        cs50 = Math.round((csVal / 100) * 50 * 10) / 10;
    }
    if (es !== '' && !isNaN(es)) {
        esVal = Math.max(0, Math.min(100, Number(es)));
        es50 = Math.round((esVal / 100) * 50 * 10) / 10;
    }
    if (csVal !== '' && esVal !== '') {
        totVal = Math.round((cs50 + es50) * 10) / 10;
        const className = resolveClass(r.classId);
        const isJHS = isJHSDepartment(className);
        const g = getGradeForDept(totVal, isJHS);
        gradeVal = g.grade;
        remarkVal = g.remark;
    }

    // ── Instant in-memory + localStorage update ──────────────────────────────
    r.classScore = csVal;
    r.examScore = esVal;
    r.classScore50 = cs50;
    r.examScore50 = es50;
    r.totalScore = totVal;
    r.grade = gradeVal;
    r.remark = remarkVal;
    r.status = status;
    r.updatedAt = new Date().toISOString();

    // Also sync into scores bag (teacher portal source)
    const subName = r.subjectName || r.subjectId || '';
    const scoresBag = JSON.parse(localStorage.getItem('scores') || '{}');
    if (subName) {
        if (!scoresBag[subName]) scoresBag[subName] = {};
        scoresBag[subName][String(r.studentId)] = {
            classScore: csVal,
            examScore: esVal,
            classScore50: cs50,
            examScore50:  es50,
            totalScore: totVal,
            grade: gradeVal,
            remark: remarkVal
        };
        localStorage.setItem('scores', JSON.stringify(scoresBag));
    }
    persistResults();

    // ── Instant UI response (0ms latency) ────────────────────────────────────
    closeModal('editResultModal');
    renderResultsTable();
    showToast('Result updated and synced across portals!', 'success');

    // ── Background cloud writes (non-blocking) ────────────────────────────────
    (async () => {
        try { await updateDocument('results', r.id, r); } catch(e) {}
        if (subName) {
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('scores', scoresBag); } catch(e) {}
        }
        try { await logActivity('Result Updated', `Admin updated result for student ${r.studentId} in ${subName}`, r.id); } catch(e) {}
    })().catch(e => console.warn('saveEditedResult bg error:', e));
}

function lockResult(id) {
    const r = adminState.results.find(r => String(r.id) === String(id));
    if (!r) return;
    r.locked = true;
    persistResults();
    renderResultsTable();
    showToast('Result mark entry locked.', 'info');
    (async () => {
        try { await updateDocument('results', id, { locked: true }); } catch(e) {}
        try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
        try { await logActivity('Result Locked', `Admin locked result ${id}`); } catch(e) {}
    })().catch(e => console.warn('lockResult bg error:', e));
}

function approveResult(id) {
    const r = adminState.results.find(r => String(r.id) === String(id));
    if (!r) return;
    r.status = 'Approved';
    r.locked = true;
    r.approvedAt = new Date().toISOString();
    persistResults();
    renderResultsTable();
    updateNavBadges();
    showToast('Result approved and locked.', 'success');
    (async () => {
        try { if (typeof approveResults === 'function') await approveResults([id], 'Approved'); } catch(e) {}
        try { await updateDocument('results', id, { status: 'Approved', locked: true, approvedAt: r.approvedAt }); } catch(e) {}
        try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
        try { await logActivity('Result Approved', `Admin approved result ${id}`); } catch(e) {}
    })().catch(e => console.warn('approveResult bg error:', e));
}

function unlockResult(id) {
    const r = adminState.results.find(r => String(r.id) === String(id));
    if (!r) return;
    r.status = 'Reviewed';
    r.locked = false;
    persistResults();
    renderResultsTable();
    updateNavBadges();
    showToast('Result unlocked for editing.', 'success');
    (async () => {
        try { if (typeof unlockResults === 'function') await unlockResults([id]); } catch(e) {}
        try { await updateDocument('results', id, { status: 'Reviewed', locked: false }); } catch(e) {}
        try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
        try { await logActivity('Result Unlocked', `Admin unlocked result ${id}`); } catch(e) {}
    })().catch(e => console.warn('unlockResult bg error:', e));
}

function bulkApproveResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result mark.', 'warning');
    showConfirm(`Approve ${ids.length} selected results?`, () => {
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            if (r) { r.status = 'Approved'; r.locked = true; r.approvedAt = new Date().toISOString(); }
        });
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} results approved successfully.`, 'success');
        (async () => {
            try { if (typeof approveResults === 'function') await approveResults(ids, 'Approved'); } catch(e) {}
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Approved', `Approved ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkApproveResults bg error:', e));
    });
}

function bulkLockResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result mark to lock.', 'warning');
    showConfirm(`Lock mark entry for ${ids.length} selected results?`, () => {
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            if (r) { r.locked = true; }
        });
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} results locked.`, 'info');
        (async () => {
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Locked', `Locked ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkLockResults bg error:', e));
    });
}

function bulkUnlockResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result.', 'warning');
    showConfirm(`Unlock ${ids.length} results for editing?`, () => {
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            if (r) { r.status = 'Reviewed'; r.locked = false; }
        });
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} results unlocked.`, 'success');
        (async () => {
            try { if (typeof unlockResults === 'function') await unlockResults(ids); } catch(e) {}
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Unlocked', `Unlocked ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkUnlockResults bg error:', e));
    });
}

function bulkPublishResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result.', 'warning');
    showConfirm(`Publish ${ids.length} results?`, () => {
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            if (r) { r.status = 'Published'; r.locked = true; }
        });
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} results published.`, 'success');
        (async () => {
            try { if (typeof approveResults === 'function') await approveResults(ids, 'Published'); } catch(e) {}
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Published', `Published ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkPublishResults bg error:', e));
    });
}

function bulkDeleteResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result mark to delete.', 'warning');
    showConfirm(`Delete ${ids.length} selected results? This cannot be undone.`, () => {
        // Purge scores from teacher portal bag first
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            _purgeResultFromScoresBag(r);
        });
        adminState.results = adminState.results.filter(r => !ids.includes(r.id));
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} results deleted and cleared from teacher portal.`, 'success');
        // Background cloud deletes
        (async () => {
            for (const id of ids) {
                try { await deleteDocument('results', id); } catch(e) {}
            }
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Deleted', `Deleted ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkDeleteResults bg error:', e));
    });
}

// Helper: remove a result's score from the teacher-portal scores bag
function _purgeResultFromScoresBag(r) {
    if (!r) return;
    const subName = resolveSubject(r.subjectName || r.subjectId) || r.subjectName || r.subjectId || '';
    const subId = r.subjectId || '';
    const scoresBag = JSON.parse(localStorage.getItem('scores') || '{}');
    [subName, subId, r.subjectName, r.subjectId].filter(Boolean).forEach(k => {
        if (scoresBag[k]) {
            delete scoresBag[k][String(r.studentId)];
            delete scoresBag[k][Number(r.studentId)];
        }
    });
    localStorage.setItem('scores', JSON.stringify(scoresBag));
    if (typeof syncSaveCollection === 'function') {
        try { syncSaveCollection('scores', scoresBag); } catch(e) {}
    }
}

function confirmDeleteResult(id) {
    const resultToDelete = adminState.results.find(r => String(r.id) === String(id));
    showConfirm('Delete this result? This will also clear the score from the teacher portal and report sheet.', () => {
        _purgeResultFromScoresBag(resultToDelete);
        adminState.results = adminState.results.filter(r => String(r.id) !== String(id));
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast('Result deleted and cleared from teacher portal.', 'success');

        (async () => {
            try { await deleteDocument('results', id); } catch(e) {}
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Result Deleted', `Admin deleted result ${id}`); } catch(e) {}
        })().catch(e => console.warn('deleteResult bg error:', e));
    });
}

function revokeResult(id) {
    const r = adminState.results.find(r => String(r.id) === String(id));
    if (!r) return;
    r.status = 'Reviewed';
    r.locked = false;
    r.revokedAt = new Date().toISOString();
    persistResults();
    renderResultsTable();
    updateNavBadges();
    showToast('Result approval revoked. Teacher can re-edit.', 'info');
    (async () => {
        try { await updateDocument('results', id, { status: 'Reviewed', locked: false, revokedAt: r.revokedAt }); } catch(e) {}
        try { await logActivity('Result Revoked', `Revoked approval for result ${id}`); } catch(e) {}
    })().catch(e => console.warn('revokeResult bg error:', e));
}

function bulkRevokeResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return showToast('Please select at least one result.', 'warning');
    showConfirm(`Revoke approval for ${ids.length} selected results?`, () => {
        ids.forEach(id => {
            const r = adminState.results.find(r => String(r.id) === String(id));
            if (r) { r.status = 'Reviewed'; r.locked = false; r.revokedAt = new Date().toISOString(); }
        });
        persistResults();
        renderResultsTable();
        handleResultCheckbox();
        updateNavBadges();
        showToast(`${ids.length} result approvals revoked.`, 'info');
        (async () => {
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('results', adminState.results); } catch(e) {}
            try { await logActivity('Bulk Results Revoked', `Revoked ${ids.length} results`); } catch(e) {}
        })().catch(e => console.warn('bulkRevokeResults bg error:', e));
    });
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function renderReportsTable() {
    const yearF   = document.getElementById('reportsFilterYear')?.value   || '';
    const termF   = document.getElementById('reportsFilterTerm')?.value   || '';
    const classF  = document.getElementById('reportsFilterClass')?.value  || '';
    const statusF = document.getElementById('reportsFilterStatus')?.value || '';

    let data = adminState.reports;
    if (yearF)   data = data.filter(r => r.academicYearId === yearF);
    if (termF)   data = data.filter(r => r.termId         === termF);
    if (classF)  data = data.filter(r => r.classId        === classF);
    if (statusF) data = data.filter(r => r.status === statusF);

    const tbody = document.getElementById('reportsTableBody');
    if (!tbody) return;

    tbody.innerHTML = data.length ? data.map((r, i) => {
        const student = adminState.students.find(s => s.id === r.studentId);
        const year    = adminState.academicYears.find(y => y.id === r.academicYearId);
        const term    = adminState.terms.find(t => t.id === r.termId);
        const status  = r.status || 'Pending';
        return `<tr>
            <td><input type="checkbox" class="report-checkbox" value="${r.id}" onchange="handleReportCheckbox()"></td>
            <td>${i + 1}</td>
            <td>${escHtml(student?.name || r.studentId || '—')}</td>
            <td>${escHtml(resolveClass(r.classId))}</td>
            <td>${escHtml(year?.name || r.academicYearId || '—')}</td>
            <td>${escHtml(term?.name || r.termId || '—')}</td>
            <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
            <td>${r.generatedAt ? new Date(r.generatedAt).toLocaleString() : '—'}</td>
            <td>
                <div class="action-btns">
                    ${['pending','generated'].includes(status.toLowerCase()) ? `<button class="action-btn success" title="Approve for download" onclick="approveReport('${r.id}')"><i class="fas fa-check"></i></button>` : ''}
                    ${['approved','published'].includes(status.toLowerCase()) ? `<button class="action-btn warning" title="Revoke approval" onclick="revokeReportApproval('${r.id}')"><i class="fas fa-undo"></i></button>` : ''}
                    <button class="action-btn" title="View Report" onclick="viewReport('${r.id}')"><i class="fas fa-file-alt"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteReport('${r.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('') : emptyRow(9, 'No reports found');

    const countEl = document.getElementById('reportsCount');
    if (countEl) countEl.textContent = `${data.length} reports`;
}

function handleReportCheckbox() {
    const checkboxes = document.querySelectorAll('.report-checkbox');
    const checked = Array.from(checkboxes).filter(c => c.checked).length;
    const bulkBar = document.getElementById('reportsBulkActions');
    const countEl = document.getElementById('selectedReportsCount');
    const selectAllCb = document.getElementById('selectAllReports');
    if (bulkBar) bulkBar.style.display = checked > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${checked} selected`;
    if (selectAllCb) selectAllCb.checked = checked > 0 && checked === checkboxes.length;
}

function toggleSelectAllReports(cb) {
    document.querySelectorAll('.report-checkbox').forEach(c => { c.checked = cb.checked; });
    handleReportCheckbox();
}

function getSelectedReportIds() {
    return Array.from(document.querySelectorAll('.report-checkbox:checked')).map(c => c.value).filter(Boolean);
}

async function bulkApproveSelectedReports() {
    const ids = getSelectedReportIds();
    if (!ids.length) return showToast('Please select at least one report.', 'warning');
    const now = new Date().toISOString();
    let count = 0;
    ids.forEach(id => {
        const r = adminState.reports.find(x => String(x.id) === String(id));
        if (r) {
            r.status = 'Approved';
            r.approvedAt = now;
            if (!r.approvalKey) {
                r.approvalKey = getReportApprovalKey(r.studentId, r.academicYearId, r.termId);
            }
            count++;
        }
    });
    persistReports();
    renderReportsTable();
    handleReportCheckbox();
    updateNavBadges();
    showToast(`${count} report(s) approved!`, 'success');
    await logActivity('Reports Approved', `Bulk-approved ${count} selected reports`);
}

async function bulkRevokeSelectedReports() {
    const ids = getSelectedReportIds();
    if (!ids.length) return showToast('Please select at least one report.', 'warning');
    let count = 0;
    ids.forEach(id => {
        const r = adminState.reports.find(x => String(x.id) === String(id));
        if (r) {
            r.status = 'Pending';
            count++;
        }
    });
    persistReports();
    renderReportsTable();
    handleReportCheckbox();
    updateNavBadges();
    showToast(`Approval revoked for ${count} report(s).`, 'warning');
    await logActivity('Reports Revoked', `Bulk-revoked approval for ${count} selected reports`);
}

async function bulkDeleteSelectedReports() {
    const ids = getSelectedReportIds();
    if (!ids.length) return showToast('Please select at least one report.', 'warning');
    showConfirm(`Delete ${ids.length} selected report(s)?`, async () => {
        const idSet = new Set(ids.map(String));
        for (const id of ids) {
            try { await deleteDocument('reports', id); } catch(e) {}
        }
        adminState.reports = adminState.reports.filter(r => !idSet.has(String(r.id)));
        persistReports();
        renderReportsTable();
        handleReportCheckbox();
        updateNavBadges();
        loadDashboard();
        showToast(`${ids.length} report(s) deleted.`, 'success');
        await logActivity('Reports Deleted', `Bulk-deleted ${ids.length} reports`);
    });
}

function formatOrdinal(n) {
    if (!n || isNaN(n)) return '';
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getAdminStudentClassRank(studentId, classIdOrName) {
    if (!studentId) return null;
    const targetClass = classIdOrName ? resolveClass(classIdOrName) : '';
    const classMates = (adminState.students || []).filter(s => {
        if (s.isDeleted || s.status === 'deleted' || s.status === 'inactive') return false;
        const sClass = resolveClass(s.classId || s.class);
        return targetClass ? (sClass === targetClass || s.classId === classIdOrName) : true;
    });
    if (!classMates.length) return null;

    const ranked = classMates.map(cm => {
        let total = 0, count = 0;
        (adminState.subjects || []).forEach(sub => {
            const se = getStudentSubjectScore(cm.id, sub.name || sub, sub.id);
            if (se && se.classScore !== '' && se.examScore !== '') {
                const cs = Number(se.classScore) || 0;
                const es = Number(se.examScore) || 0;
                const cs50 = Math.round((cs / 100) * 50 * 10) / 10;
                const es50 = Math.round((es / 100) * 50 * 10) / 10;
                const tot = se.totalScore !== undefined && se.totalScore !== '' ? Number(se.totalScore) : (cs50 + es50);
                total += tot;
                count++;
            }
        });
        return {
            id: String(cm.id),
            avg: count > 0 ? (total / count) : -1
        };
    }).sort((a, b) => b.avg - a.avg);

    const index = ranked.findIndex(r => r.id === String(studentId));
    if (index === -1) return null;
    const target = ranked[index];
    if (target.avg < 0) return { rank: null, total: classMates.length, formatted: '—' };
    const rank = index + 1;
    return {
        rank: rank,
        total: classMates.length,
        formatted: `${formatOrdinal(rank)} / ${classMates.length}`
    };
}

// ── Helper: build a PDF blob for a report data object using jsPDF text API ────
// Works without html2canvas. Returns a Uint8Array suitable for zip.file()
function buildReportPDFBlob(data) {
    // data: { studentName, className, yr, tm, schoolName, schoolAddress, headTeacher,
    //         classTeacherName, subjects: [{name, cs50, es50, tot, grade, remark}],
    //         avg, overallGrade, teacherRemark, headRemark, isJHS, jhsAggregate, showPosition, position }
    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') return null;
    const JsPDF = (window.jspdf && window.jspdf.jsPDF) || jsPDF;
    if (!JsPDF) return null;

    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 18;

    const centerText = (text, yPos, size = 11, style = 'normal') => {
        doc.setFontSize(size); doc.setFont('helvetica', style);
        doc.text(String(text || ''), W / 2, yPos, { align: 'center' });
    };
    const lText = (text, yPos, size = 10, style = 'normal') => {
        doc.setFontSize(size); doc.setFont('helvetica', style);
        doc.text(String(text || ''), margin, yPos);
    };

    // Header
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(0.8);
    centerText(data.schoolName || 'School', y, 16, 'bold'); y += 6;
    centerText(data.schoolAddress || '', y, 9); y += 5;
    centerText(`END OF ${String(data.tm || '').toUpperCase()} REPORT SHEET`, y, 10, 'bold'); y += 4;
    doc.line(margin, y, W - margin, y); y += 6;

    // Student info table
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(`Student: ${data.studentName}`, margin, y);
    doc.text(`Class: ${data.className}`, W / 2, y); y += 6;
    doc.text(`Academic Year: ${data.yr}`, margin, y);
    doc.text(`Term: ${data.tm}`, W / 2, y); y += 6;
    if (data.showPosition && data.position) {
        doc.text(`Class Position: ${data.position}`, margin, y); y += 6;
    }
    y += 2;

    // JHS Aggregate box
    if (data.isJHS && data.jhsAggregate !== undefined) {
        doc.setFillColor(30, 27, 75);
        doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text(`JHS TOTAL AGGREGATE: ${data.jhsAggregate}`, margin + 4, y + 1);
        doc.setTextColor(0, 0, 0); y += 12;
    }

    // Subjects table header
    const cols = [65, 24, 24, 24, 18, 30]; // widths
    const headers = ['SUBJECT', 'CLASS 50%', 'EXAM 50%', 'TOTAL', 'GRADE', 'REMARKS'];
    doc.setFillColor(79, 70, 229);
    doc.rect(margin, y - 4, W - margin * 2, 7, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    let cx = margin + 2;
    headers.forEach((h, i) => { doc.text(h, cx, y); cx += cols[i]; });
    doc.setTextColor(0, 0, 0); y += 5;

    // Subject rows
    (data.subjects || []).forEach((sub, idx) => {
        if (y > 265) { doc.addPage(); y = 18; }
        if (idx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 4, W - margin * 2, 6, 'F'); }
        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        cx = margin + 2;
        const cells = [sub.name, String(sub.cs50 ?? '—'), String(sub.es50 ?? '—'), String(sub.tot ?? '—'), String(sub.grade ?? '—'), String(sub.remark ?? '—')];
        cells.forEach((c, i) => { doc.text(c.substring(0, 30), cx, y); cx += cols[i]; });
        y += 6;
    });

    // Overall row
    doc.setFillColor(238, 242, 255);
    doc.rect(margin, y - 4, W - margin * 2, 7, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`AVERAGE: ${data.avg != null ? Number(data.avg).toFixed(1) + '%' : '—'}   OVERALL AVERAGE GRADE: ${data.overallGrade || '—'}${data.showPosition && data.position ? '   CLASS POSITION: ' + data.position : ''}`, margin + 2, y);
    y += 10;

    // Remarks / footer
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Teacher's Remark: ${data.teacherRemark || 'Satisfactory.'}`, margin, y); y += 6;
    doc.text(`Headteacher's Remark: ${data.headRemark || 'Good progress.'}`, margin, y); y += 8;
    doc.line(margin, y, W - margin, y); y += 5;
    doc.setFontSize(9);
    doc.text(`Class Teacher: ${data.classTeacherName || '________________'}`, margin, y);
    doc.text(`Headteacher: ${data.headTeacher || '________________'}`, W / 2, y);

    return doc.output('arraybuffer');
}

async function bulkDownloadSelectedReports() {
    const ids = getSelectedReportIds();
    if (!ids.length) return showToast('Please select at least one report.', 'warning');
    if (typeof JSZip === 'undefined') {
        showToast('ZIP library not loaded.', 'error');
        return;
    }
    showToast('Building ZIP for selected reports...', 'info');

    const zip = new JSZip();
    const detailsBag = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const settings = adminState.settings || {};
    const schoolInf = getSchoolInfo();

    let count = 0;
    for (const id of ids) {
        try {
            const r = adminState.reports.find(x => String(x.id) === String(id));
            if (!r) continue;
            const student = adminState.students.find(s => String(s.id) === String(r.studentId));
            if (!student) continue;
            const className = resolveClass(r.classId);
            const yr = adminState.academicYears.find(y => String(y.id) === String(r.academicYearId))?.name || '';
            const tm = adminState.terms.find(t => String(t.id) === String(r.termId))?.name || '';
            const d = detailsBag[student.id] || detailsBag[String(student.id)] || {};
            const classRec = adminState.classes.find(c => String(c.id) === String(r.classId));
            let classSubs = adminState.subjects;
            if (classRec && Array.isArray(classRec.subjectIds) && classRec.subjectIds.length) {
                classSubs = adminState.subjects.filter(s => classRec.subjectIds.includes(s.id));
            }
            if (!classSubs.length) classSubs = adminState.subjects;
            const isJHS = isJHSDepartment(className, classRec?.department || '');

            let rowsHtml = '';
            let totalScoreSum = 0, scoredCount = 0;
            const jhsSubjectResults = [];
            classSubs.forEach(sub => {
                const subName = sub.name || sub;
                const se = getStudentSubjectScore(student.id, subName, sub.id);
                if (se && se.classScore !== '' && se.examScore !== '') {
                    const cs50 = Math.round((Number(se.classScore) / 100) * 50 * 10) / 10;
                    const es50 = Math.round((Number(se.examScore) / 100) * 50 * 10) / 10;
                    const tot = se.totalScore !== undefined && se.totalScore !== '' ? Number(se.totalScore) : (cs50 + es50);
                    const g = getGradeForDept(tot, isJHS);
                    totalScoreSum += tot; scoredCount++;
                    jhsSubjectResults.push({ sub: subName, tot, grade: Number(g.grade) || 99 });
                    rowsHtml += `<tr><td style="text-align:left;font-weight:600;padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(subName)}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${cs50}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${es50}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;"><strong>${tot}</strong></td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${g.grade}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${g.remark}</td></tr>`;
                } else {
                    rowsHtml += `<tr><td style="text-align:left;color:#94a3b8;padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(subName)}</td><td colspan="5" style="padding:6px 8px;border:1px solid #cbd5e1;color:#94a3b8;">No scores</td></tr>`;
                }
            });
            const avg = scoredCount > 0 ? totalScoreSum / scoredCount : 0;
            const overallGrade = getGradeForDept(avg, isJHS);
            const logoSrc = settings.schoolLogo || schoolInf.schoolLogo;

            let jhsAggHTML = '';
            // Build JHS aggregate value
            let jhsAggValue;
            if (isJHS) {
                const coreKw = ['english','mathematics','science','social studies','integrated science'];
                const coreR = jhsSubjectResults.filter(r => r.tot !== null && coreKw.some(k => r.sub.toLowerCase().includes(k))).slice(0,4);
                const elecR = jhsSubjectResults.filter(r => r.tot !== null && !coreKw.some(k => r.sub.toLowerCase().includes(k))).sort((a,b) => a.grade - b.grade).slice(0,2);
                jhsAggValue = [...coreR, ...elecR].reduce((s, r) => s + r.grade, 0);
            }

            // Resolve class teacher strictly from assigned teacher ID
            const assignedTeacher = classRec?.classTeacherId ? adminState.teachers.find(t => String(t.id) === String(classRec.classTeacherId) && !t.isDeleted && t.status !== 'deleted') : null;
            const ctName = assignedTeacher?.name || '';
            const htTeacher = adminState.teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive' && !t.isDeleted);
            const htName = htTeacher?.name || settings.headTeacher || schoolInf.headTeacher || '';

            // Build subjects array for PDF
            const subjectsForPDF = classSubs.map(sub => {
                const subName = sub.name || sub;
                const se = getStudentSubjectScore(student.id, subName, sub.id);
                if (se && se.classScore !== '' && se.examScore !== '') {
                    const cs50 = Math.round((Number(se.classScore) / 100) * 50 * 10) / 10;
                    const es50 = Math.round((Number(se.examScore) / 100) * 50 * 10) / 10;
                    const tot = se.totalScore !== undefined && se.totalScore !== '' ? Number(se.totalScore) : (cs50 + es50);
                    const g = getGradeForDept(tot, isJHS);
                    return { name: subName, cs50, es50, tot, grade: g.grade, remark: g.remark };
                }
                return { name: subName, cs50: '—', es50: '—', tot: '—', grade: '—', remark: 'No scores' };
            });

            const fieldToggles = settings.fieldToggles || {};
            const showPosition = fieldToggles.showPosition !== false;
            let posText = '—';
            if (showPosition) {
                const rankInfo = getAdminStudentClassRank(student.id, r.classId || student.classId || student.class);
                if (rankInfo && rankInfo.formatted) posText = rankInfo.formatted;
            }

            const pdfData = {
                studentName: student.name, className, yr, tm,
                schoolName: settings.schoolName || schoolInf.schoolName || 'School',
                schoolAddress: settings.schoolAddress || settings.address || '',
                headTeacher: htName, classTeacherName: ctName,
                subjects: subjectsForPDF,
                avg, overallGrade: `${overallGrade.grade} (${overallGrade.remark})`,
                teacherRemark: d.teacherRemark || d.teacherRemarks || '',
                headRemark: d.headRemark || '',
                isJHS, jhsAggregate: jhsAggValue,
                showPosition, position: posText
            };

            const pdfBuffer = buildReportPDFBlob(pdfData);
            const safeName = student.name.replace(/[^a-zA-Z0-9]/g, '_');
            if (pdfBuffer) {
                zip.file(`${safeName}_Report.pdf`, pdfBuffer);
            } else {
                // Fallback to HTML if jsPDF not available
                zip.file(`${safeName}_Report.html`, `<html><body><h2>${student.name}</h2><p>Report for ${className} — ${yr} ${tm}</p></body></html>`);
            }
            count++;
        } catch (e) {
            console.error('Error packaging report:', e);
        }
    }

    if (count === 0) {
        showToast('Could not package selected reports.', 'warning');
        return;
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Selected_Student_Reports_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`Downloaded ZIP with ${count} PDF report(s)!`, 'success');
}

function getReportApprovalKey(studentId, yearId, termId) {
    const sYear = yearId ? (adminState.academicYears.find(y => y.id === yearId)?.name || yearId) : ((adminState.academicYears.find(y => y.isActive)?.name) || getSchoolInfo().academicYear || '');
    const sTerm = termId ? (adminState.terms.find(t => t.id === termId)?.termNumber || adminState.terms.find(t => t.id === termId)?.name || termId) : ((adminState.terms.find(t => t.isActive)?.termNumber) || getSchoolInfo().term || '1');
    return String(studentId) + '|' + sYear + '|' + String(sTerm);
}

function persistReports() {
    localStorage.setItem('reports', JSON.stringify(adminState.reports));
    if (typeof syncSaveCollection === 'function') {
        try { syncSaveCollection('reports', adminState.reports); } catch (e) {}
    }
}

function approveReport(id) {
    const r = adminState.reports.find(x => String(x.id) === String(id));
    if (!r) { showToast('Report not found.', 'error'); return; }
    r.status = 'Approved';
    r.approvedAt = new Date().toISOString();
    if (!r.approvalKey) {
        r.approvalKey = getReportApprovalKey(r.studentId, r.academicYearId, r.termId);
    }
    persistReports();
    renderReportsTable();
    updateNavBadges();
    showToast(`Approved ${r.studentName || 'report'} — teachers can now download it.`, 'success');
    (async () => {
        try { await updateDocument('reports', r.id, { status: 'Approved', approvedAt: r.approvedAt, approvalKey: r.approvalKey }); } catch (e) {}
        try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('reports', adminState.reports); } catch (e) {}
        try { await logActivity('Report Approved', `Approved report for ${r.studentName || r.studentId}`, r.id); } catch (e) {}
    })().catch(e => console.warn('approveReport bg error:', e));
}

function revokeReportApproval(id) {
    const r = adminState.reports.find(x => String(x.id) === String(id));
    if (!r) return;
    r.status = 'Pending';
    persistReports();
    renderReportsTable();
    updateNavBadges();
    showToast('Approval revoked. Download is locked again.', 'warning');
    (async () => {
        try { await updateDocument('reports', r.id, { status: 'Pending' }); } catch (e) {}
        try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('reports', adminState.reports); } catch (e) {}
        try { await logActivity('Report Approval Revoked', `Revoked approval for report ${id}`, r.id); } catch (e) {}
    })().catch(e => console.warn('revokeReportApproval bg error:', e));
}

function approveAllPendingReports() {
    const pending = adminState.reports.filter(r => !['approved','published'].includes(String(r.status||'').toLowerCase()));
    if (!pending.length) { showToast('No pending reports to approve.', 'info'); return; }
    showConfirm(`Approve ${pending.length} pending report(s) for download?`, () => {
        const now = new Date().toISOString();
        pending.forEach(r => {
            r.status = 'Approved';
            r.approvedAt = now;
            if (!r.approvalKey) {
                r.approvalKey = getReportApprovalKey(r.studentId, r.academicYearId, r.termId);
            }
        });
        persistReports();
        renderReportsTable();
        updateNavBadges();
        showToast(`${pending.length} reports approved. Teachers can download them now.`, 'success');
        (async () => {
            for (const r of pending) {
                try { await updateDocument('reports', r.id, { status: 'Approved', approvedAt: r.approvedAt, approvalKey: r.approvalKey }); } catch (e) {}
            }
            try { if (typeof syncSaveCollection === 'function') await syncSaveCollection('reports', adminState.reports); } catch (e) {}
            try { await logActivity('Reports Approved', `Bulk-approved ${pending.length} reports`); } catch (e) {}
        })().catch(e => console.warn('approveAllPendingReports bg error:', e));
    });
}

function openGenerateReportModal() {
    populateSelect('gr-class',   adminState.classes,       'id', 'name', 'Select Class');
    populateSelect('gr-year',    adminState.academicYears, 'id', 'name', 'Select Year');
    populateSelect('gr-term',    adminState.terms,         'id', 'name', 'Select Term');
    populateSelect('gr-student', adminState.students,      'id', 'name', 'Select Student');
    document.getElementById('generateReportModal').style.display = 'flex';

    document.getElementById('gr-type')?.addEventListener('change', function() {
        const isIndividual = this.value === 'individual';
        document.getElementById('gr-class-group').style.display   = isIndividual ? 'none'  : 'block';
        document.getElementById('gr-student-group').style.display = isIndividual ? 'block' : 'none';
    });
}

// ── Helper to resolve a student's latest score for a subject from scores or results ──
function getStudentSubjectScore(studentId, subjectName, subjectId) {
    const sId = String(studentId);
    const subName = String(subjectName || '').trim();
    const scoresBag = JSON.parse(localStorage.getItem('scores') || '{}');
    
    // 1. Direct key match in scoresBag
    let se = null;
    if (scoresBag[subName]) se = scoresBag[subName][sId] || scoresBag[subName][Number(studentId)];
    if (!se && scoresBag[subName.toUpperCase()]) se = scoresBag[subName.toUpperCase()][sId] || scoresBag[subName.toUpperCase()][Number(studentId)];
    
    // 2. Case-insensitive key match in scoresBag
    if (!se) {
        const matchingKey = Object.keys(scoresBag).find(k => k.toLowerCase().trim() === subName.toLowerCase());
        if (matchingKey) se = scoresBag[matchingKey][sId] || scoresBag[matchingKey][Number(studentId)];
    }
    
    // 3. Check in results collection (synced from teacher scores)
    if (!se || (se.classScore === '' && se.examScore === '')) {
        const resList = adminState.results || JSON.parse(localStorage.getItem('results') || '[]');
        const r = resList.find(item => 
            String(item.studentId) === sId && 
            (String(item.subjectName || '').toLowerCase().trim() === subName.toLowerCase() || (subjectId && String(item.subjectId) === String(subjectId)))
        );
        if (r && (r.classScore !== '' || r.examScore !== '')) {
            se = {
                classScore: r.classScore,
                examScore: r.examScore,
                totalScore: r.totalScore,
                grade: r.grade,
                remark: r.remark
            };
        }
    }
    
    return se;
}

async function generateReports() {
    const type      = document.getElementById('gr-type')?.value || 'class';
    const classId   = document.getElementById('gr-class')?.value || '';
    const studentId = document.getElementById('gr-student')?.value || '';
    const yearId    = document.getElementById('gr-year')?.value || '';
    const termId    = document.getElementById('gr-term')?.value || '';

    let studentsToProcess = [];
    if (type === 'individual') studentsToProcess = adminState.students.filter(s => String(s.id) === String(studentId));
    else if (type === 'class')  studentsToProcess = adminState.students.filter(s => s.classId === classId || s.class === resolveClass(classId));
    else                         studentsToProcess = adminState.students;

    if (!studentsToProcess.length) { showToast('No students to process.', 'warning'); return; }

    try {
        const now = new Date().toISOString();
        const currentUserId = getCurrentUserProfile()?.uid || 'admin';
        let count = 0;

        for (const s of studentsToProcess) {
            const key = getReportApprovalKey(s.id, yearId, termId);
            const existingIdx = adminState.reports.findIndex(r => 
                (String(r.studentId) === String(s.id) && String(r.termId) === String(termId)) || 
                r.approvalKey === key || 
                (r.approvalKey && String(r.approvalKey).split('|')[0] === String(s.id))
            );

            const reportPayload = {
                studentId:      String(s.id),
                studentName:    s.name,
                classId:        s.classId || classId || s.class,
                academicYearId: yearId,
                termId:         termId,
                approvalKey:    key,
                status:         existingIdx >= 0 ? adminState.reports[existingIdx].status : 'Pending',
                generatedAt:    now,
                generatedBy:    currentUserId
            };

            if (existingIdx >= 0) {
                adminState.reports[existingIdx] = { ...adminState.reports[existingIdx], ...reportPayload };
            } else {
                const rptId = 'rpt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                adminState.reports.push({ id: rptId, ...reportPayload });
            }
            count++;
        }

        persistReports();
        closeModal('generateReportModal');
        renderReportsTable();
        loadDashboard();
        showToast(`${count} report(s) generated/updated!`, 'success');
        await logActivity('Reports Generated', `Generated ${count} reports for term ${termId}`);
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

let currentPreviewReportId = null;

function viewReport(id) {
    const r = adminState.reports.find(x => String(x.id) === String(id));
    if (!r) { showToast('Report record not found.', 'error'); return; }
    currentPreviewReportId = id;

    const student = adminState.students.find(s => String(s.id) === String(r.studentId)) || { id: r.studentId, name: r.studentName || 'Student #' + r.studentId, class: resolveClass(r.classId) };
    const className = resolveClass(r.classId || student.classId || student.class);
    const yr = adminState.academicYears.find(y => String(y.id) === String(r.academicYearId))?.name || r.academicYearId || getSchoolInfo().academicYear || '2025/2026';
    const tm = adminState.terms.find(t => String(t.id) === String(r.termId))?.name || (r.termId ? ('Term ' + r.termId) : ('Term ' + (getSchoolInfo().term || '1')));

    const detailsBag = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const d = detailsBag[student.id] || detailsBag[String(student.id)] || {};
    const settings = adminState.settings || {};
    const schoolInf = getSchoolInfo();
    const primaryColor = settings.primaryColor || '#4f46e5';
    const secondaryColor = settings.secondaryColor || '#7e3af2';
    const headerTextColor = settings.headerTextColor || '#ffffff';
    const primaryDark = (typeof adjustColorBrightness === 'function') ? adjustColorBrightness(primaryColor, -15) : '#4338ca';

    const classRec = adminState.classes.find(c => String(c.id) === String(r.classId) || c.name === className);
    let classSubs = adminState.subjects;
    if (classRec && Array.isArray(classRec.subjectIds) && classRec.subjectIds.length) {
        classSubs = adminState.subjects.filter(sub => classRec.subjectIds.includes(sub.id));
    }
    if (!classSubs.length) classSubs = adminState.subjects;

    // Determine if JHS
    const isJHS = isJHSDepartment(className, classRec?.department || '');

    let totalScoreSum = 0;
    let scoredCount = 0;
    let rowsHtml = '';
    const jhsSubjectResults = [];

    classSubs.forEach(sub => {
        const subName = sub.name || sub;
        const scoreEntry = getStudentSubjectScore(student.id, subName, sub.id);

        if (scoreEntry && scoreEntry.classScore !== '' && scoreEntry.examScore !== '') {
            const cs = Number(scoreEntry.classScore) || 0;
            const es = Number(scoreEntry.examScore) || 0;
            const cs50 = Math.round((cs / 100) * 50 * 10) / 10;
            const es50 = Math.round((es / 100) * 50 * 10) / 10;
            const tot = scoreEntry.totalScore !== undefined && scoreEntry.totalScore !== '' ? Number(scoreEntry.totalScore) : (cs50 + es50);
            const gradeObj = getGradeForDept(tot, isJHS);
            totalScoreSum += tot;
            scoredCount++;
            jhsSubjectResults.push({ sub: subName, tot, grade: Number(gradeObj.grade) || 99 });
            rowsHtml += `<tr>
                <td style="text-align:left;font-weight:600;padding:8px 10px;border:1px solid #cbd5e1;">${escHtml(subName)}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${cs50}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${es50}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;"><strong>${tot}</strong></td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:${primaryColor}1a;color:${primaryDark};">${gradeObj.grade}</span></td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${gradeObj.remark}</td>
            </tr>`;
        } else {
            jhsSubjectResults.push({ sub: subName, tot: null, grade: 99 });
            rowsHtml += `<tr>
                <td style="text-align:left;color:#94a3b8;padding:8px 10px;border:1px solid #cbd5e1;">${escHtml(subName)}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;color:#94a3b8;" colspan="5">No scores entered</td>
            </tr>`;
        }
    });

    const avg = scoredCount > 0 ? (totalScoreSum / scoredCount) : 0;
    const overallGrade = getGradeForDept(avg, isJHS);
    const logoSrc = settings.schoolLogo || schoolInf.schoolLogo || null;
    const isApproved = ['approved', 'published'].includes(String(r.status || '').toLowerCase());

    const fieldToggles = settings.fieldToggles || {};
    const showPosition = fieldToggles.showPosition !== false;
    const showLogo = fieldToggles.showSchoolLogo !== false;
    const showNextTerm = fieldToggles.showNextTerm !== false;

    const logoEl = (showLogo && logoSrc)
        ? `<img src="${logoSrc}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo" crossorigin="anonymous">`
        : (showLogo ? `<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>` : '');

    // JHS Aggregate
    let jhsAggregateHTML = '';
    if (isJHS) {
        const adminCoreNames = new Set(
            adminState.subjects.filter(s => s.isCore).map(s => s.name.toLowerCase())
        );
        const fallbackCoreKeywords = ['english','mathematics','science','social studies','integrated science'];
        const useFallback = adminCoreNames.size === 0;

        const isCoreSubject = (subName) => {
            const lower = String(subName || '').toLowerCase();
            if (!useFallback) return adminCoreNames.has(lower);
            return fallbackCoreKeywords.some(k => lower.includes(k));
        };

        const coreResults = jhsSubjectResults.filter(r => r.tot !== null && isCoreSubject(r.sub)).slice(0, 4);
        const electiveResults = jhsSubjectResults.filter(r => r.tot !== null && !isCoreSubject(r.sub));
        electiveResults.sort((a, b) => a.grade - b.grade);
        const bestTwo = electiveResults.slice(0, 2);
        const allAgg = [...coreResults, ...bestTwo];
        const totalAgg = allAgg.reduce((s, r) => s + r.grade, 0);
        jhsAggregateHTML = `
        <div style="background:${primaryDark};color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;">
            <div style="font-weight:700;font-size:13px;letter-spacing:0.5px;">TOTAL AGGREGATE</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;margin-top:2px;">${totalAgg}</div>
        </div>`;
    }

    const allTeachers = adminState.teachers || [];
    const tMatch = allTeachers.find(t => t.class === className || (Array.isArray(t.classes) && t.classes.includes(className)) || (classRec?.classTeacherId && String(t.id) === String(classRec.classTeacherId)));
    const teacherName = tMatch ? (tMatch.name || tMatch.fullName) : (d.classTeacher || '');
    const teacherSig = localStorage.getItem('teacherSignature_' + className) || (tMatch && tMatch.signature) || null;
    const htTeacher = adminState.teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive' && !t.isDeleted);
    const htName = htTeacher?.name || settings.headTeacher || schoolInf.headTeacher || '—';
    const htSignature = settings.headTeacherSignature || schoolInf.headTeacherSignature || localStorage.getItem('headTeacherSignature') || settings.signature || schoolInf.signature || null;

    let posText = '—';
    if (showPosition) {
        const rankInfo = getAdminStudentClassRank(student.id, r.classId || student.classId || student.class);
        if (rankInfo && rankInfo.formatted) posText = rankInfo.formatted;
    }

    const modalBody = document.getElementById('adminPreviewReportBody');
    if (!modalBody) return;

    modalBody.innerHTML = `
        <div id="printableReportCard" style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',sans-serif;max-width:800px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${primaryColor};padding-bottom:14px;margin-bottom:18px;">
                ${logoEl}
                <div style="text-align:center;flex:1;padding:0 12px;">
                    <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;letter-spacing:-0.5px;">${escHtml(settings.schoolName || schoolInf.schoolName || 'The Living Spring School')}</h2>
                    <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${escHtml(settings.address || '')}</p>
                    <p style="font-size:11.5px;color:${primaryColor};font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${escHtml(settings.motto || 'Drink deep or taste not the spring of knowledge')}&rdquo;</em></p>
                    <div style="display:inline-block;background:${primaryColor};color:${headerTextColor};font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:0.5px;">
                        END OF ${escHtml(String(tm).toUpperCase())} REPORT SHEET
                    </div>
                </div>
                ${logoEl}
            </div>

            <div class="report-meta-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#f8fafc;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #e2e8f0;">
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">NAME OF LEARNER</span><strong>${escHtml(student.name)}</strong></div>
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS</span><strong>${escHtml(className)}</strong></div>
                ${showPosition ? `<div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="color:${primaryDark};font-size:13.5px;">${escHtml(posText)}</strong></div>` : ''}
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">ACADEMIC YEAR</span><strong>${escHtml(yr)}</strong></div>
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">TERM</span><strong>${escHtml(tm)}</strong></div>
                ${showNextTerm ? `
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">DATE OF VACATION</span><strong>${escHtml(settings.closingDate || schoolInf.closingDate || '—')}</strong></div>
                <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">RE-OPENING DATE</span><strong>${escHtml(settings.reopeningDate || schoolInf.reopeningDate || '—')}</strong></div>
                ` : ''}
            </div>

            <div class="table-wrap" style="margin-bottom:14px;">
                <table style="width:100%;min-width:440px;border-collapse:collapse;font-size:11.5px;text-align:center;">
                    <thead>
                        <tr style="background:${primaryColor};color:${headerTextColor};">
                            <th style="padding:7px 8px;text-align:left;border:1px solid ${primaryDark};">SUBJECT</th>
                            <th style="padding:7px 8px;border:1px solid ${primaryDark};">CLASS 50%</th>
                            <th style="padding:7px 8px;border:1px solid ${primaryDark};">EXAM 50%</th>
                            <th style="padding:7px 8px;border:1px solid ${primaryDark};">TOTAL 100%</th>
                            <th style="padding:7px 8px;border:1px solid ${primaryDark};">GRADE</th>
                            <th style="padding:7px 8px;border:1px solid ${primaryDark};">REMARKS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml || '<tr><td colspan="6" style="padding:16px;color:#94a3b8;">No subjects assigned</td></tr>'}
                    </tbody>
                </table>
            </div>

            ${jhsAggregateHTML}

            <div class="report-perf-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#eef2ff;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #c7d2fe;">
                <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
                <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">OVERALL AVERAGE GRADE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? overallGrade.grade + ' (' + overallGrade.remark + ')' : '—'}</strong></div>
                ${showPosition ? `<div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="font-size:14px;color:#1e1b4b;">${escHtml(posText)}</strong></div>` : ''}
                <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount} / ${classSubs.length}</strong></div>
            </div>

            <div class="report-conduct-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-bottom:14px;font-size:12px;">
                <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                    <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Attendance:</span> ${escHtml(d.attendance || '—')}</div>
                    <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Conduct:</span> ${escHtml(d.conduct || '—')}</div>
                    <div><span style="color:#64748b;font-weight:600;">Interest:</span> ${escHtml(d.interest || '—')}</div>
                </div>
                <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                    <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Promoted to / In:</span> ${escHtml(d.promotionTarget || (d.promotionStatus || '—'))}</div>
                    <div><span style="color:#64748b;font-weight:600;">Teacher Remarks:</span> <em>${escHtml(d.teacherRemarks || '—')}</em></div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569;gap:20px;">
                <div style="flex:1;">
                    <div><strong>Class Teacher:</strong> ${escHtml(teacherName || '—')}</div>
                    ${teacherSig ? `<div style="height:28px;margin-top:2px;display:flex;align-items:flex-end;"><img src="${teacherSig}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Class Teacher Signature" crossorigin="anonymous"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                    <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
                </div>
                <div style="flex:1;text-align:right;">
                    <div><strong>Headteacher:</strong> ${escHtml(htName || '—')}</div>
                    ${htSignature ? `<div style="height:28px;margin-top:2px;display:flex;justify-content:flex-end;align-items:flex-end;"><img src="${htSignature}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Headteacher Signature" crossorigin="anonymous"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                    <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
                </div>
            </div>
        </div>
    `;

    const statusEl = document.getElementById('adminPreviewReportStatus');
    if (statusEl) {
        statusEl.innerHTML = `<span class="status-pill ${r.status.toLowerCase()}">${r.status}</span> &nbsp; <small style="color:var(--text-muted);">${r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ''}</small>`;
    }

    const approveBtn = document.getElementById('adminPreviewApproveToggleBtn');
    if (approveBtn) {
        if (isApproved) {
            approveBtn.className = 'btn-admin btn-warning';
            approveBtn.innerHTML = '<i class="fas fa-undo"></i> Revoke Approval';
            approveBtn.onclick = async () => { await revokeReportApproval(id); viewReport(id); };
        } else {
            approveBtn.className = 'btn-admin btn-primary';
            approveBtn.innerHTML = '<i class="fas fa-check"></i> Approve for Download';
            approveBtn.onclick = async () => { await approveReport(id); viewReport(id); };
        }
    }

    const titleEl = document.getElementById('adminPreviewReportTitle');
    if (titleEl) titleEl.innerHTML = `<i class="fas fa-file-alt"></i> Report Sheet — ${escHtml(student.name)} (${escHtml(className)})`;

    document.getElementById('adminReportPreviewModal').style.display = 'flex';
}

function printAdminReport() {
    const printContent = document.getElementById('printableReportCard');
    if (!printContent) return;
    const win = window.open('', '_blank', 'width=900,height=750');
    win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Student Report Sheet</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                body { margin: 20px; font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                table th, table td { border: 1px solid #cbd5e1; }
            </style>
        </head>
        <body>
            ${printContent.outerHTML}
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `);
    win.document.close();
}

async function downloadAdminPreviewReport() {
    const printContent = document.getElementById('printableReportCard');
    if (!printContent) {
        showToast('No report preview loaded.', 'error');
        return;
    }
    showToast('Preparing PDF download...', 'info');

    const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
    if (typeof html2canvas !== 'undefined' && jsPDFConstructor) {
        try {
            const canvas = await html2canvas(printContent, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff'
            });
            const doc = new jsPDFConstructor('p', 'mm', 'a4');
            const W = doc.internal.pageSize.getWidth();
            const H = doc.internal.pageSize.getHeight();
            const imgData = canvas.toDataURL('image/png');
            const ratio = canvas.height / canvas.width;
            const imgH = W * ratio;
            let posY = 0;
            doc.addImage(imgData, 'PNG', 0, posY, W, imgH);
            if (imgH > H) {
                let remaining = imgH - H;
                while (remaining > 0) {
                    posY -= H;
                    doc.addPage();
                    doc.addImage(imgData, 'PNG', 0, posY, W, imgH);
                    remaining -= H;
                }
            }
            const r = adminState.reports.find(x => String(x.id) === String(currentPreviewReportId));
            const studentName = r?.studentName || 'student';
            const fileName = `${studentName.replace(/[^a-zA-Z0-9]/g, '_')}_report.pdf`;
            doc.save(fileName);
            showToast('PDF downloaded successfully.', 'success');
            return;
        } catch (err) {
            console.warn('html2canvas preview download fallback:', err);
        }
    }

    // Fallback: trigger print dialog for saving as PDF
    printAdminReport();
}

async function confirmDeleteReport(id) {
    showConfirm('Delete this report record?', async () => {
        const sid = String(id);
        await deleteDocument('reports', id);
        adminState.reports = adminState.reports.filter(r => String(r.id) !== sid);
        persistReports();
        renderReportsTable();
        updateNavBadges();
        loadDashboard();
        showToast('Report deleted.', 'success');
        await logActivity('Report Deleted', `Deleted report record ${id}`, id);
    });
}

// ── BULK DOWNLOAD for Admin ─────────────────────────────────────────────────
function openAdminBulkDownloadModal() {
    const modal = document.getElementById('adminBulkDownloadModal');
    if (!modal) { showToast('Bulk download modal not found.', 'error'); return; }

    // Populate class selector
    const sel = document.getElementById('bulkDownloadClassSelect');
    if (sel) {
        sel.innerHTML = '<option value="">-- All Classes --</option>' +
            adminState.classes.filter(c => c.status !== 'inactive')
                .map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
    }
    modal.style.display = 'flex';
}

async function executeAdminBulkDownload() {
    const classFilter = document.getElementById('bulkDownloadClassSelect')?.value || '';
    const statusFilter = document.getElementById('bulkDownloadStatusSelect')?.value || 'approved';

    const showToastMsg = (msg, type) => showToast(msg, type);
    showToastMsg('Preparing bulk download...', 'info');

    let reports = adminState.reports.filter(r => {
        const statusMatch = !statusFilter || ['approved','published'].includes(String(statusFilter).toLowerCase())
            ? ['approved','published'].includes(String(r.status || '').toLowerCase())
            : r.status === statusFilter;
        const classMatch = !classFilter || r.classId === classFilter;
        return statusMatch && classMatch;
    });

    if (!reports.length) { showToast('No approved reports found for the selection.', 'warning'); return; }

    if (typeof JSZip === 'undefined') {
        showToast('ZIP library not loaded. Cannot create bulk download.', 'error');
        return;
    }

    const zip = new JSZip();
    const detailsBag = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const settings = adminState.settings || {};
    const schoolInf = getSchoolInfo();

    let count = 0;
    for (const r of reports) {
        try {
            const student = adminState.students.find(s => String(s.id) === String(r.studentId));
            if (!student) continue;
            const className = resolveClass(r.classId);
            const yr = adminState.academicYears.find(y => String(y.id) === String(r.academicYearId))?.name || '';
            const tm = adminState.terms.find(t => String(t.id) === String(r.termId))?.name || '';
            const d = detailsBag[student.id] || detailsBag[String(student.id)] || {};
            const classRec = adminState.classes.find(c => String(c.id) === String(r.classId));
            let classSubs = adminState.subjects;
            if (classRec && Array.isArray(classRec.subjectIds) && classRec.subjectIds.length) {
                classSubs = adminState.subjects.filter(s => classRec.subjectIds.includes(s.id));
            }
            if (!classSubs.length) classSubs = adminState.subjects;
            const isJHS = isJHSDepartment(className, classRec?.department || '');

            let rowsHtml = '';
            let totalScoreSum = 0, scoredCount = 0;
            const jhsSubjectResults = [];
            classSubs.forEach(sub => {
                const subName = sub.name || sub;
                const se = getStudentSubjectScore(student.id, subName, sub.id);
                if (se && se.classScore !== '' && se.examScore !== '') {
                    const cs50 = Math.round((Number(se.classScore) / 100) * 50 * 10) / 10;
                    const es50 = Math.round((Number(se.examScore) / 100) * 50 * 10) / 10;
                    const tot = se.totalScore !== undefined && se.totalScore !== '' ? Number(se.totalScore) : (cs50 + es50);
                    const g = getGradeForDept(tot, isJHS);
                    totalScoreSum += tot; scoredCount++;
                    jhsSubjectResults.push({ sub: subName, tot, grade: Number(g.grade) || 99 });
                    rowsHtml += `<tr><td style="text-align:left;font-weight:600;padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(subName)}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${cs50}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${es50}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;"><strong>${tot}</strong></td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${g.grade}</td><td style="padding:6px 8px;border:1px solid #cbd5e1;">${g.remark}</td></tr>`;
                } else {
                    rowsHtml += `<tr><td style="text-align:left;color:#94a3b8;padding:6px 8px;border:1px solid #cbd5e1;">${escHtml(subName)}</td><td colspan="5" style="padding:6px 8px;border:1px solid #cbd5e1;color:#94a3b8;">No scores</td></tr>`;
                }
            });
            const avg = scoredCount > 0 ? totalScoreSum / scoredCount : 0;
            const overallGrade = getGradeForDept(avg, isJHS);
            const logoSrc = settings.schoolLogo || schoolInf.schoolLogo;

            let jhsAggValue;
            if (isJHS) {
                const coreKw = ['english','mathematics','science','social studies','integrated science'];
                const coreR = jhsSubjectResults.filter(r => r.tot !== null && coreKw.some(k => r.sub.toLowerCase().includes(k))).slice(0,4);
                const elecR = jhsSubjectResults.filter(r => r.tot !== null && !coreKw.some(k => r.sub.toLowerCase().includes(k))).sort((a,b) => a.grade - b.grade).slice(0,2);
                jhsAggValue = [...coreR, ...elecR].reduce((s, r) => s + r.grade, 0);
            }

            const assignedTeacher = classRec?.classTeacherId ? adminState.teachers.find(t => String(t.id) === String(classRec.classTeacherId) && !t.isDeleted && t.status !== 'deleted') : null;
            const ctName = assignedTeacher?.name || '';
            const htTeacher = adminState.teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive' && !t.isDeleted);
            const htName = htTeacher?.name || settings.headTeacher || schoolInf.headTeacher || '';
            const subjectsForPDF = classSubs.map(sub => {
                const subName = sub.name || sub;
                const se = getStudentSubjectScore(student.id, subName, sub.id);
                if (se && se.classScore !== '' && se.examScore !== '') {
                    const cs50 = Math.round((Number(se.classScore) / 100) * 50 * 10) / 10;
                    const es50 = Math.round((Number(se.examScore) / 100) * 50 * 10) / 10;
                    const tot = se.totalScore !== undefined && se.totalScore !== '' ? Number(se.totalScore) : (cs50 + es50);
                    const g = getGradeForDept(tot, isJHS);
                    return { name: subName, cs50, es50, tot, grade: g.grade, remark: g.remark };
                }
                return { name: subName, cs50: '—', es50: '—', tot: '—', grade: '—', remark: 'No scores' };
            });
            const fieldToggles = settings.fieldToggles || {};
            const showPosition = fieldToggles.showPosition !== false;
            let posText = '—';
            if (showPosition) {
                const rankInfo = getAdminStudentClassRank(student.id, r.classId || student.classId || student.class);
                if (rankInfo && rankInfo.formatted) posText = rankInfo.formatted;
            }

            const pdfData = {
                studentName: student.name, className, yr, tm,
                schoolName: settings.schoolName || schoolInf.schoolName || 'School',
                schoolAddress: settings.schoolAddress || settings.address || '',
                headTeacher: htName, classTeacherName: ctName,
                subjects: subjectsForPDF,
                avg, overallGrade: `${overallGrade.grade} (${overallGrade.remark})`,
                teacherRemark: d.teacherRemark || d.teacherRemarks || '',
                headRemark: d.headRemark || '',
                isJHS, jhsAggregate: jhsAggValue,
                showPosition, position: posText
            };
            const pdfBuffer = buildReportPDFBlob(pdfData);
            const safeName = (student.name || 'student').replace(/[^a-z0-9]/gi, '_');
            const folderName = classFilter
                ? (adminState.classes.find(c => c.id === classFilter)?.name || 'class').replace(/\s/g, '_')
                : 'all_classes';
            if (pdfBuffer) {
                zip.file(`${folderName}/${safeName}_report.pdf`, pdfBuffer);
            } else {
                zip.file(`${folderName}/${safeName}_report.html`, `<html><body><h2>${student.name}</h2></body></html>`);
            }
            count++;
        } catch(e) { console.warn('Bulk download error for report:', r.id, e); }
    }

    if (!count) { showToast('No reports could be generated.', 'warning'); return; }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipName = (classFilter
        ? (adminState.classes.find(c => c.id === classFilter)?.name || 'class').replace(/\s/g, '_')
        : 'all_classes') + '_reports.zip';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    closeModal('adminBulkDownloadModal');
    showToast(`Downloaded ${count} report(s) as ZIP successfully!`, 'success');
}

async function printAllClassReports() {
    const classFilter = document.getElementById('bulkDownloadClassSelect')?.value || '';
    let reports = adminState.reports.filter(r => {
        const approved = ['approved','published'].includes(String(r.status || '').toLowerCase());
        const classMatch = !classFilter || r.classId === classFilter;
        return approved && classMatch;
    });
    if (!reports.length) { showToast('No approved reports found for printing.', 'warning'); return; }
    // Build a combined print page
    const pages = [];
    for (const r of reports) {
        const student = adminState.students.find(s => String(s.id) === String(r.studentId));
        if (!student) continue;
        // Use the same viewReport logic to build the card content
        viewReport(r.id);
        const cardEl = document.getElementById('printableReportCard');
        if (cardEl) pages.push(`<div style="page-break-after:always;">${cardEl.outerHTML}</div>`);
    }
    if (!pages.length) { showToast('Could not generate print pages.', 'error'); return; }
    const win = window.open('', '_blank', 'width=900,height=750');
    win.document.write(`<!DOCTYPE html><html><head><title>Class Reports</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>body{margin:0;font-family:Inter,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}@media print{.no-print{display:none;}}</style>
    </head><body>${pages.join('')}<script>window.onload=function(){window.print()};<\/script></body></html>`);
    win.document.close();
    closeModal('adminBulkDownloadModal');
}

// ─── SCHOOL SETTINGS ─────────────────────────────────────────────────────────
function getSchoolInfo() {
    try { return JSON.parse(localStorage.getItem('schoolInfo') || '{}'); } catch (e) { return {}; }
}

function persistSchoolInfoPatch(patch) {
    const info = { ...getSchoolInfo(), ...patch };
    localStorage.setItem('schoolInfo', JSON.stringify(info));
    if (typeof syncSaveCollection === 'function') {
        try { syncSaveCollection('schoolInfo', info); } catch (e) {}
    }
    return info;
}

function assignedClassTeacher(cls) {
    if (!cls) return null;
    return adminState.teachers.find(t => String(t.id) === String(cls.classTeacherId)) || null;
}

function autoHeadteacherName() {
    const ht = adminState.teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive');
    return ht?.name || '';
}

function renderClassTeacherMap() {
    const tbody = document.getElementById('settingsClassTeacherBody');
    if (!tbody) return;
    const rows = (adminState.classes || []).filter(c => c.status !== 'inactive');
    tbody.innerHTML = rows.length ? rows.map(c => {
        const teacher = assignedClassTeacher(c);
        return `<tr>
            <td><strong>${escHtml(c.name)}</strong></td>
            <td>${escHtml(teacher?.name || 'Not assigned')}</td>
            <td>${teacher ? 'Teachers → ' + escHtml(teacher.name) : 'Assign in Classes'}</td>
        </tr>`;
    }).join('') : emptyRow(3, 'No classes yet. Add them under Classes.');
}

function loadSettingsForm() {
    const s = adminState.settings || {};
    const info = getSchoolInfo();
    const fields = ['settingsSchoolName','settingsMotto','settingsAddress','settingsPhone','settingsEmail','settingsReportTitle'];
    const keys   = ['schoolName','motto','address','phone','email','reportTitle'];
    fields.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.value = s[keys[i]] || '';
    });

    const closeEl = document.getElementById('settingsClosingDate');
    const openEl  = document.getElementById('settingsReopeningDate');
    const headEl  = document.getElementById('settingsHeadTeacher');
    if (closeEl) closeEl.value = s.closingDate || info.closingDate || '';
    if (openEl)  openEl.value  = s.reopeningDate || info.reopeningDate || '';
    if (headEl)  headEl.value  = autoHeadteacherName() || s.headTeacher || info.headTeacher || '';

    renderClassTeacherMap();

    if (s.primaryColor)     { document.getElementById('settingsPrimaryColor').value       = s.primaryColor;     document.getElementById('settingsPrimaryColorHex').value       = s.primaryColor; }
    if (s.secondaryColor)   { document.getElementById('settingsSecondaryColor').value     = s.secondaryColor;   document.getElementById('settingsSecondaryColorHex').value     = s.secondaryColor; }
    if (s.headerTextColor)  { document.getElementById('settingsHeaderTextColor').value    = s.headerTextColor;  document.getElementById('settingsHeaderTextColorHex').value    = s.headerTextColor; }

    if (s.schoolLogo) {
        const preview = document.getElementById('settingsLogoPreview');
        if (preview) preview.innerHTML = `<img src="${s.schoolLogo}" style="max-height:60px;">`;
    }
    if (s.signature) {
        const preview = document.getElementById('settingsSignaturePreview');
        if (preview) preview.innerHTML = `<img src="${s.signature}" style="max-height:60px;">`;
    }

    renderFieldToggles();
    renderDepartmentsSetting();
    loadFirebaseForm();
}

function renderFieldToggles() {
    const container = document.getElementById('fieldTogglesGrid');
    if (!container) return;
    const toggles = adminState.settings?.fieldToggles || {};
    container.innerHTML = REPORT_FIELD_TOGGLES.map(ft => `
        <div class="toggle-row">
            <label for="toggle-${ft.key}">${escHtml(ft.label)}</label>
            <label class="toggle-switch">
                <input type="checkbox" id="toggle-${ft.key}" ${toggles[ft.key] !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>`).join('');
}

async function saveAllSettings() {
    const activeYear = adminState.academicYears.find(y => y.isActive);
    const activeTerm = adminState.terms.find(t => t.isActive);
    const settings = {
        schoolName:      document.getElementById('settingsSchoolName')?.value?.trim() || '',
        motto:           document.getElementById('settingsMotto')?.value?.trim() || '',
        address:         document.getElementById('settingsAddress')?.value?.trim() || '',
        phone:           document.getElementById('settingsPhone')?.value?.trim() || '',
        email:           document.getElementById('settingsEmail')?.value?.trim() || '',
        reportTitle:     document.getElementById('settingsReportTitle')?.value?.trim() || '',
        closingDate:     document.getElementById('settingsClosingDate')?.value?.trim() || '',
        reopeningDate:   document.getElementById('settingsReopeningDate')?.value?.trim() || '',
        headTeacher:     document.getElementById('settingsHeadTeacher')?.value?.trim() || autoHeadteacherName(),
        primaryColor:    document.getElementById('settingsPrimaryColor')?.value || '#1a56db',
        secondaryColor:  document.getElementById('settingsSecondaryColor')?.value || '#7e3af2',
        headerTextColor: document.getElementById('settingsHeaderTextColor')?.value || '#ffffff',
        schoolLogo:      adminState.settings?.schoolLogo || null,
        signature:       adminState.settings?.signature  || null,
        fieldToggles:    {}
    };

    REPORT_FIELD_TOGGLES.forEach(ft => {
        settings.fieldToggles[ft.key] = document.getElementById(`toggle-${ft.key}`)?.checked ?? true;
    });

    try {
        await saveSchoolSettings(settings);
        adminState.settings = settings;
        persistSchoolInfoPatch({
            schoolName:    settings.schoolName,
            academicYear:  activeYear?.name || getSchoolInfo().academicYear || '',
            term:          activeTerm ? String(activeTerm.termNumber || '') : (getSchoolInfo().term || ''),
            closingDate:   settings.closingDate,
            reopeningDate: settings.reopeningDate,
            headTeacher:   settings.headTeacher,
            schoolLogo:    settings.schoolLogo
        });
        showToast('Settings saved! Teacher portal will show these on reports.', 'success');
        await logActivity('School Settings Updated', 'Updated report calendar and school information');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function handleSettingsLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        adminState.settings.schoolLogo = e.target.result;
        const preview = document.getElementById('settingsLogoPreview');
        if (preview) preview.innerHTML = `<img src="${e.target.result}" style="max-height:60px;">`;
    };
    reader.readAsDataURL(file);
}

function handleSettingsSignatureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        adminState.settings.signature = e.target.result;
        const preview = document.getElementById('settingsSignaturePreview');
        if (preview) preview.innerHTML = `<img src="${e.target.result}" style="max-height:60px;">`;
    };
    reader.readAsDataURL(file);
}

function syncColorPicker(inputId, value) {
    const el = document.getElementById(inputId);
    if (el && /^#[0-9a-fA-F]{6}$/.test(value)) el.value = value;
}

function rolePillClass(role) {
    const map = {
        'Super Admin': 'approved',
        'Administrator': 'submitted',
        'Headteacher': 'reviewed',
        'Class Teacher': 'pending',
        'Teacher': 'draft'
    };
    return map[role] || '';
}

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
function renderAuditLogs() {
    let localLogs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
    if (!localLogs.length) {
        const initialLog = {
            id: `log_${Date.now()}`,
            user: sessionStorage.getItem('adminEmail') || 'Administrator',
            role: 'Super Admin',
            action: 'Portal Ready',
            details: 'OneReal School Management Dashboard online',
            affectedRecord: '—',
            timestamp: new Date().toISOString(),
            formattedTime: new Date().toLocaleString()
        };
        localLogs = [initialLog];
        localStorage.setItem('auditLogs', JSON.stringify(localLogs));
    }
    adminState.auditLogs = localLogs;

    const search    = (document.getElementById('auditLogSearch')?.value || '').toLowerCase();
    const actionF   =  document.getElementById('auditLogActionFilter')?.value || '';
    const dateFrom  =  document.getElementById('auditLogDateFrom')?.value || '';
    const dateTo    =  document.getElementById('auditLogDateTo')?.value || '';

    let data = adminState.auditLogs;
    if (search)   data = data.filter(l => `${l.user} ${l.action} ${l.details}`.toLowerCase().includes(search));
    if (actionF)  data = data.filter(l => l.action === actionF);
    if (dateFrom) data = data.filter(l => l.timestamp >= dateFrom);
    if (dateTo)   data = data.filter(l => l.timestamp <= dateTo + 'T23:59:59');

    // Populate action filter
    const actions = [...new Set(adminState.auditLogs.map(l => l.action).filter(Boolean))];
    const actionFilter = document.getElementById('auditLogActionFilter');
    if (actionFilter && actionFilter.options.length <= 1) {
        actions.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a; opt.textContent = a;
            actionFilter.appendChild(opt);
        });
    }

    const page  = adminState.auditPage;
    const total = data.length;
    const start = (page - 1) * adminState.auditPerPage;
    const paged = data.slice(start, start + adminState.auditPerPage);

    const tbody = document.getElementById('auditLogsTableBody');
    if (!tbody) return;

    tbody.innerHTML = paged.length ? paged.map(l => `
        <tr>
            <td>${escHtml(l.user || '')}</td>
            <td><span class="status-pill">${escHtml(l.role || '')}</span></td>
            <td>${escHtml(l.action || '')}</td>
            <td>${escHtml(l.details || '')}</td>
            <td>${escHtml(l.affectedRecord || '')}</td>
            <td>${l.formattedTime || ''}</td>
        </tr>`).join('') : emptyRow(6, 'No activity logs found');

    const countEl = document.getElementById('auditLogsCount');
    if (countEl) countEl.textContent = `${total} entries`;

    renderPagination('auditLogsPagination', total, adminState.auditPerPage, page, (p) => {
        adminState.auditPage = p;
        renderAuditLogs();
    });
}

function exportAuditLogs() {
    startFileDownload('/api/export/auditLogs.xlsx');
}

function confirmClearAuditLogs() {
    showConfirm('Clear all local audit logs? This cannot be undone.', () => {
        adminState.auditLogs = [];
        localStorage.removeItem('auditLogs');
        renderAuditLogs();
        showToast('Audit logs cleared.', 'success');
    });
}

// ─── DATA MANAGEMENT ─────────────────────────────────────────────────────────
function renderDataManagement() {
    const container = document.getElementById('dbStatsGrid');
    if (!container) return;
    const stats = [
        { label: 'Students',       value: adminState.students.length },
        { label: 'Teachers',       value: adminState.teachers.length },
        { label: 'Classes',        value: adminState.classes.length },
        { label: 'Subjects',       value: adminState.subjects.length },
        { label: 'Results',        value: adminState.results.length },
        { label: 'Reports',        value: adminState.reports.length },
        { label: 'Audit Logs',     value: adminState.auditLogs.length },
    ];
    container.innerHTML = stats.map(s => `
        <div class="stat-item">
            <div class="stat-item-value">${s.value}</div>
            <div class="stat-item-label">${s.label}</div>
        </div>`).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// DOWNLOADABLE TEMPLATES & DATA EXPORT (DIRECT IMMEDIATE DOWNLOAD)
// ──────────────────────────────────────────────────────────────────────────────
function startFileDownload(url, filename) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); }, 100);
}

function getAvailableClassNames() {
    const list = (adminState.classes || []).map(c => c.name).filter(Boolean);
    if (list.length) return list;
    return ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'JHS 1', 'JHS 2', 'JHS 3', 'Nursery 1', 'KG 1', 'KG 2'];
}

function getAvailableSubjectNames() {
    const list = (adminState.subjects || []).map(s => s.name).filter(Boolean);
    if (list.length) return list;
    return ['Mathematics', 'English Language', 'Integrated Science', 'Social Studies', 'R.M.E', 'Computing', 'Creative Arts', 'French', 'Ghanaian Language', 'Career Technology'];
}

function getAvailableRoles() {
    return ['Teacher', 'Class Teacher', 'Headteacher', 'Administrator', 'Super Admin'];
}

function downloadTemplate(type) {
    if (typeof XLSX === 'undefined') {
        startFileDownload(`/api/templates/${encodeURIComponent(type)}.xlsx`, `${type}_template.xlsx`);
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const classNames = getAvailableClassNames();
        const subjectNames = getAvailableSubjectNames();
        const roleNames = getAvailableRoles();
        const firstClass = classNames[0] || 'Class 1';
        const secondClass = classNames[1] || classNames[0] || 'Class 2';
        const firstSubject = subjectNames[0] || 'Mathematics';
        const secondSubject = subjectNames[1] || subjectNames[0] || 'English Language';

        if (type === 'students') {
            const headers = ['Admission No', 'Full Name', 'Class', 'Gender', 'Date of Birth', 'Parent Name', 'Parent Phone', 'Parent Email', 'Address'];
            const sampleRows = [
                headers,
                ['STU001', 'Kwame Mensah', firstClass, 'Male', '2015-05-12', 'Kofi Mensah', '0241234567', 'kofi@example.com', 'Accra'],
                ['STU002', 'Ama Serwaa', secondClass, 'Female', '2015-08-23', 'Akosua Serwaa', '0249876543', 'akosua@example.com', 'Kumasi']
            ];
            const ws = XLSX.utils.aoa_to_sheet(sampleRows);
            ws['!cols'] = [
                { wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 16 },
                { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 20 }
            ];

            // In-cell dropdowns for Class (Col C) and Gender (Col D)
            ws['!dataValidation'] = [
                {
                    sqref: 'C2:C500',
                    type: 'list',
                    operator: 'equal',
                    formula1: `"${classNames.slice(0, 30).join(',')}"`,
                    showDropDown: true,
                    errorTitle: 'Invalid Class',
                    error: 'Please select a valid class from the dropdown list.',
                    showErrorMessage: true
                },
                {
                    sqref: 'D2:D500',
                    type: 'list',
                    operator: 'equal',
                    formula1: '"Male,Female"',
                    showDropDown: true,
                    errorTitle: 'Invalid Gender',
                    error: 'Please select Male or Female.',
                    showErrorMessage: true
                }
            ];
            XLSX.utils.book_append_sheet(wb, ws, 'Students_Import');

            // Reference sheet: Available Classes
            const classesSheetData = [
                ['Available Classes (Select or copy from this list)', 'Level', 'Status'],
                ...classNames.map(c => {
                    const obj = (adminState.classes || []).find(cls => cls.name === c);
                    return [c, obj?.level || 'Primary', obj?.status || 'Active'];
                })
            ];
            const wsClasses = XLSX.utils.aoa_to_sheet(classesSheetData);
            wsClasses['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 14 }];
            XLSX.utils.book_append_sheet(wb, wsClasses, 'Available_Classes');

            XLSX.writeFile(wb, 'students_import_template.xlsx');
            showToast('Downloaded students_import_template.xlsx with Class dropdown', 'success');
            return;
        }

        if (type === 'teachers') {
            const headers = ['Full Name', 'Email Address', 'Phone Number', 'Role', 'Password', 'Assigned Classes', 'Assigned Subjects'];
            const sampleRows = [
                headers,
                ['John Doe', 'john.doe@school.com', '0241112233', 'Teacher', 'Pass123!', `${firstClass}, ${secondClass}`, `${firstSubject}, ${secondSubject}`],
                ['Jane Smith', 'jane.smith@school.com', '0245556677', 'Class Teacher', 'Pass123!', firstClass, firstSubject]
            ];
            const ws = XLSX.utils.aoa_to_sheet(sampleRows);
            ws['!cols'] = [
                { wch: 22 }, { wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
                { wch: 28 }, { wch: 32 }
            ];

            // In-cell dropdown for Role (Col D)
            ws['!dataValidation'] = [
                {
                    sqref: 'D2:D500',
                    type: 'list',
                    operator: 'equal',
                    formula1: `"${roleNames.join(',')}"`,
                    showDropDown: true,
                    errorTitle: 'Invalid Role',
                    error: 'Please select a valid staff role from the dropdown list.',
                    showErrorMessage: true
                }
            ];
            XLSX.utils.book_append_sheet(wb, ws, 'Teachers_Import');

            // Reference sheet: Available Classes
            const classesSheetData = [
                ['Available Classes', 'Level'],
                ...classNames.map(c => [c, ((adminState.classes || []).find(cls => cls.name === c)?.level) || ''])
            ];
            const wsClasses = XLSX.utils.aoa_to_sheet(classesSheetData);
            wsClasses['!cols'] = [{ wch: 30 }, { wch: 18 }];
            XLSX.utils.book_append_sheet(wb, wsClasses, 'Available_Classes');

            // Reference sheet: Available Subjects
            const subjectsSheetData = [
                ['Available Subjects / Departments', 'Code'],
                ...subjectNames.map(s => [s, ((adminState.subjects || []).find(sub => sub.name === s)?.code) || ''])
            ];
            const wsSubjects = XLSX.utils.aoa_to_sheet(subjectsSheetData);
            wsSubjects['!cols'] = [{ wch: 32 }, { wch: 16 }];
            XLSX.utils.book_append_sheet(wb, wsSubjects, 'Available_Subjects');

            // Reference sheet: Available Roles
            const rolesSheetData = [
                ['Staff Roles', 'Description / Permissions'],
                ['Teacher', 'Subject/Class scores entry & reports'],
                ['Class Teacher', 'Primary class management & conduct remarks'],
                ['Headteacher', 'Administrative oversight & approvals'],
                ['Administrator', 'Full school administration access'],
                ['Super Admin', 'Full system control & cloud access']
            ];
            const wsRoles = XLSX.utils.aoa_to_sheet(rolesSheetData);
            wsRoles['!cols'] = [{ wch: 20 }, { wch: 45 }];
            XLSX.utils.book_append_sheet(wb, wsRoles, 'Available_Roles');

            XLSX.writeFile(wb, 'teachers_import_template.xlsx');
            showToast('Downloaded teachers_import_template.xlsx with Role dropdown and Class/Subject reference sheets', 'success');
            return;
        }

        if (type === 'results') {
            const headers = ['Student Name', 'Class', 'Subject', 'Class Score', 'Exam Score', 'Academic Year', 'Term'];
            const sampleRows = [
                headers,
                ['Kwame Mensah', firstClass, firstSubject, '28', '62', '2025/2026', 'Term 1'],
                ['Ama Serwaa', firstClass, firstSubject, '25', '58', '2025/2026', 'Term 1']
            ];
            const ws = XLSX.utils.aoa_to_sheet(sampleRows);
            ws['!cols'] = [
                { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 },
                { wch: 16 }, { wch: 14 }
            ];
            ws['!dataValidation'] = [
                {
                    sqref: 'B2:B500',
                    type: 'list',
                    operator: 'equal',
                    formula1: `"${classNames.slice(0, 30).join(',')}"`,
                    showDropDown: true
                },
                {
                    sqref: 'C2:C500',
                    type: 'list',
                    operator: 'equal',
                    formula1: `"${subjectNames.slice(0, 30).join(',')}"`,
                    showDropDown: true
                },
                {
                    sqref: 'G2:G500',
                    type: 'list',
                    operator: 'equal',
                    formula1: '"Term 1,Term 2,Term 3"',
                    showDropDown: true
                }
            ];
            XLSX.utils.book_append_sheet(wb, ws, 'Results_Import');

            // Reference sheets
            const wsClasses = XLSX.utils.aoa_to_sheet([['Available Classes'], ...classNames.map(c => [c])]);
            XLSX.utils.book_append_sheet(wb, wsClasses, 'Available_Classes');

            const wsSubjects = XLSX.utils.aoa_to_sheet([['Available Subjects'], ...subjectNames.map(s => [s])]);
            XLSX.utils.book_append_sheet(wb, wsSubjects, 'Available_Subjects');

            XLSX.writeFile(wb, 'results_import_template.xlsx');
            showToast('Downloaded results_import_template.xlsx with Class/Subject dropdowns', 'success');
            return;
        }

        if (type === 'classes') {
            const headers = ['Class Name', 'Academic Level', 'Grading Scale', 'Status'];
            const sampleRows = [
                headers,
                ['Class 1', 'Primary', 'Ghana Primary Scale', 'active'],
                ['JHS 1', 'JHS', 'JHS / BECE Scale', 'active']
            ];
            const ws = XLSX.utils.aoa_to_sheet(sampleRows);
            ws['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 12 }];
            ws['!dataValidation'] = [
                {
                    sqref: 'B2:B500',
                    type: 'list',
                    operator: 'equal',
                    formula1: '"Primary,JHS,Kindergarten,Nursery,SHS"',
                    showDropDown: true
                },
                {
                    sqref: 'D2:D500',
                    type: 'list',
                    operator: 'equal',
                    formula1: '"active,inactive"',
                    showDropDown: true
                }
            ];
            XLSX.utils.book_append_sheet(wb, ws, 'Classes_Import');
            XLSX.writeFile(wb, 'classes_import_template.xlsx');
            showToast('Downloaded classes_import_template.xlsx', 'success');
            return;
        }

        if (type === 'subjects') {
            const headers = ['Subject Name', 'Subject Code', 'Status'];
            const sampleRows = [
                headers,
                ['Mathematics', 'MATH', 'active'],
                ['English Language', 'ENG', 'active'],
                ['Integrated Science', 'SCI', 'active']
            ];
            const ws = XLSX.utils.aoa_to_sheet(sampleRows);
            ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 12 }];
            ws['!dataValidation'] = [
                {
                    sqref: 'C2:C500',
                    type: 'list',
                    operator: 'equal',
                    formula1: '"active,inactive"',
                    showDropDown: true
                }
            ];
            XLSX.utils.book_append_sheet(wb, ws, 'Subjects_Import');
            XLSX.writeFile(wb, 'subjects_import_template.xlsx');
            showToast('Downloaded subjects_import_template.xlsx', 'success');
            return;
        }
    } catch (e) {
        console.warn('XLSX client template generation fallback:', e);
        startFileDownload(`/api/templates/${encodeURIComponent(type)}.xlsx`, `${type}_template.xlsx`);
    }
}

function downloadCsvTemplate(type) {
    const classNames = getAvailableClassNames();
    const subjectNames = getAvailableSubjectNames();
    const firstClass = classNames[0] || 'Class 1';
    const secondClass = classNames[1] || classNames[0] || 'Class 2';
    const firstSubject = subjectNames[0] || 'Mathematics';
    const secondSubject = subjectNames[1] || subjectNames[0] || 'English Language';

    let csvContent = '';
    let filename = `${type}_template.csv`;

    if (type === 'students') {
        filename = 'students_import_template.csv';
        csvContent = 'Admission No,Full Name,Class,Gender,Date of Birth,Parent Name,Parent Phone,Parent Email,Address\n' +
                     `STU001,"Kwame Mensah","${firstClass}","Male","2015-05-12","Kofi Mensah","0241234567","kofi@example.com","Accra"\n` +
                     `STU002,"Ama Serwaa","${secondClass}","Female","2015-08-23","Akosua Serwaa","0249876543","akosua@example.com","Kumasi"\n`;
    } else if (type === 'teachers') {
        filename = 'teachers_import_template.csv';
        csvContent = 'Full Name,Email Address,Phone Number,Role,Password,Assigned Classes,Assigned Subjects\n' +
                     `"John Doe","john.doe@school.com","0241112233","Teacher","Pass123!","${firstClass}, ${secondClass}","${firstSubject}, ${secondSubject}"\n` +
                     `"Jane Smith","jane.smith@school.com","0245556677","Class Teacher","Pass123!","${firstClass}","${firstSubject}"\n`;
    } else if (type === 'classes') {
        filename = 'classes_import_template.csv';
        csvContent = 'Class Name,Academic Level,Grading Scale,Status\n' +
                     '"Class 1","Primary","Ghana Primary Scale","active"\n' +
                     '"JHS 1","JHS","JHS / BECE Scale","active"\n';
    } else if (type === 'subjects') {
        filename = 'subjects_import_template.csv';
        csvContent = 'Subject Name,Subject Code,Status\n' +
                     '"Mathematics","MATH","active"\n' +
                     '"English Language","ENG","active"\n' +
                     '"Integrated Science","SCI","active"\n';
    } else if (type === 'results') {
        filename = 'results_import_template.csv';
        csvContent = 'Student Name,Class,Subject,Class Score,Exam Score,Academic Year,Term\n' +
                     `"Kwame Mensah","${firstClass}","${firstSubject}",28,62,"2025/2026","Term 1"\n` +
                     `"Ama Serwaa","${firstClass}","${firstSubject}",25,58,"2025/2026","Term 1"\n`;
    } else if (type === 'attendance') {
        filename = 'attendance_template.csv';
        csvContent = 'Student ID,Student Name,Class,Date,Status,Notes\n' +
                     `"STU001","Kwame Mensah","${firstClass}","${new Date().toISOString().slice(0,10)}","Present",""\n` +
                     `"STU002","Ama Serwaa","${firstClass}","${new Date().toISOString().slice(0,10)}","Late","Arrived 8:15am"\n`;
    } else if (type === 'gradingScales') {
        filename = 'grading_scales_template.csv';
        csvContent = 'Scale Name,Grade,Min Score,Max Score,Remark,GPA Points\n' +
                     '"Ghana Primary Scale","A",80,100,"Excellent",4.0\n' +
                     '"Ghana Primary Scale","P",70,79,"Proficient",3.0\n' +
                     '"Ghana Primary Scale","AP",60,69,"Approaching Proficiency",2.0\n' +
                     '"Ghana Primary Scale","D",50,59,"Developing",1.0\n' +
                     '"Ghana Primary Scale","B",0,49,"Beginning",0.0\n';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    showToast(`Downloaded ${filename}`, 'success');
}

function renderTemplatesSection() {
    // Refresh dropdown info if needed
}

function exportDataExcel(collection) {
    const data = adminState[collection] || [];
    const filename = `${collection}_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    if (typeof XLSX !== 'undefined' && data.length > 0) {
        try {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, collection.charAt(0).toUpperCase() + collection.slice(1));
            XLSX.writeFile(wb, filename);
            showToast(`Exported ${data.length} records to ${filename}`, 'success');
            return;
        } catch (e) {
            console.warn('XLSX export fallback:', e);
        }
    }
    startFileDownload(`/api/export/${encodeURIComponent(collection)}.xlsx`, filename);
}

function triggerImport(collection) {
    document.getElementById(`import${collection.charAt(0).toUpperCase() + collection.slice(1)}File`)?.click();
}

async function handleImportCSV(event, collection) {
    const file = event.target.files[0];
    if (!file) return;

    adminState.importCollection = collection;

    const text = await file.text();
    let records = [];
    if (window.OneRealFiles && OneRealFiles.parseCsv) {
        records = OneRealFiles.parseCsv(text);
    } else {
        const rows = text.split('\n').filter(r => r.trim());
        if (!rows.length) { showToast('Empty CSV file.', 'error'); return; }
        const headers0 = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));
        records = rows.slice(1).map(row => {
            const values = row.split(',').map(v => v.trim().replace(/"/g, ''));
            const obj = {};
            headers0.forEach((h, i) => { obj[h] = values[i] || ''; });
            return obj;
        });
    }
    if (!records.length) { showToast('Empty CSV file.', 'error'); return; }
    const headers = Object.keys(records[0]);

    adminState.importData = records;
    showImportPreview(headers, records, collection);
    event.target.value = '';
}

function showImportPreview(headers, records, collection) {
    const section = document.getElementById('importPreviewSection');
    const thead   = document.getElementById('importPreviewHead');
    const tbody   = document.getElementById('importPreviewBody');
    const msgEl   = document.getElementById('importValidationMessages');
    const banner  = document.getElementById('importInstructionsBanner');
    const btn     = document.getElementById('confirmImportBtn');
    if (!section || !thead || !tbody) return;

    section.style.display = 'block';

    const reqCols = {
        students: ['name', 'admissionNo', 'class'],
        teachers: ['name', 'email'],
        classes:  ['name'],
        subjects: ['name'],
        results:  ['studentId', 'subjectId', 'totalScore']
    }[collection] || ['name'];

    // Instruction Banner
    if (banner) {
        banner.innerHTML = `
            <strong><i class="fas fa-info-circle"></i> Instructions for ${collection.toUpperCase()} Import:</strong><br>
            • File format: Standard CSV (.csv)<br>
            • Required columns: <code>${reqCols.join(', ')}</code><br>
            • Download the <a href="#" onclick="downloadTemplate('${collection}');return false;" style="color:var(--primary);font-weight:600;">Download ${collection} CSV Template</a> for pre-formatted sample data.
        `;
    }

    // Validation
    const errors = [];
    const warnings = [];

    // Check missing columns
    reqCols.forEach(col => {
        if (!headers.includes(col) && !(collection === 'results' && headers.includes('classScore') && headers.includes('examScore'))) {
            errors.push(`Missing required column header: "${col}"`);
        }
    });

    records.forEach((r, i) => {
        const rowNum = i + 2;
        if (collection === 'students' && !r.name) errors.push(`Row ${rowNum}: Student name missing`);
        if (collection === 'teachers' && (!r.name || !r.email)) errors.push(`Row ${rowNum}: Teacher name or email missing`);

        if (collection === 'results') {
            const cs = parseFloat(r.classScore) || 0;
            const es = parseFloat(r.examScore)  || 0;
            if (cs > 50) warnings.push(`Row ${rowNum}: Class score (${cs}) exceeds recommended 50 max`);
            if (es > 50) warnings.push(`Row ${rowNum}: Exam score (${es}) exceeds recommended 50 max`);
        }
    });

    if (msgEl) {
        let html = '';
        if (errors.length) {
            html += errors.map(e => `<div class="import-validation-error"><i class="fas fa-exclamation-triangle"></i> ${escHtml(e)}</div>`).join('');
        }
        if (warnings.length) {
            html += warnings.map(w => `<div class="import-validation-warning" style="color:var(--warning);font-size:12px;"><i class="fas fa-exclamation-circle"></i> ${escHtml(w)}</div>`).join('');
        }
        if (!errors.length) {
            html += `<div class="import-validation-ok"><i class="fas fa-check-circle"></i> ${records.length} records validated successfully. Ready to import.</div>`;
        }
        msgEl.innerHTML = html;
    }

    if (btn) btn.disabled = errors.length > 0;

    thead.innerHTML = `<tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr>`;
    tbody.innerHTML = records.slice(0, 10).map(r =>
        `<tr>${headers.map(h => `<td>${escHtml(r[h] || '')}</td>`).join('')}</tr>`
    ).join('');
}

async function confirmImport() {
    const collection = adminState.importCollection;
    const data       = adminState.importData;
    if (!collection || !data.length) return;

    try {
        let count = 0;
        for (const record of data) {
            if (collection === 'results' && !record.totalScore && record.classScore && record.examScore) {
                record.totalScore = (parseFloat(record.classScore) || 0) + (parseFloat(record.examScore) || 0);
            }
            await addDocument(collection, record);
            count++;
        }
        showToast(`${count} records imported into ${collection}!`, 'success');
        await logActivity('Data Imported', `Imported ${count} records into ${collection}`);
        await loadAllData();
        cancelImport();
        switchSection(collection);
    } catch (e) {
        showToast(`Import error: ${e.message}`, 'error');
    }
}

function cancelImport() {
    const section = document.getElementById('importPreviewSection');
    if (section) section.style.display = 'none';
    adminState.importCollection = null;
    adminState.importData = [];
}

// ──────────────────────────────────────────────────────────────────────────────
// BACKUP & RESTORATION (WITH PRE-RESTORE SAFETY SNAPSHOT)
// ──────────────────────────────────────────────────────────────────────────────

let pendingRestoreData = null;

function openRestoreBackupModal() {
    if (!isAdmin()) { showToast('Only Administrators can restore database backups.', 'error'); return; }
    pendingRestoreData = null;
    const fileInput = document.getElementById('restoreBackupFile');
    if (fileInput) fileInput.value = '';
    document.getElementById('restorePreviewContainer').style.display = 'none';
    document.getElementById('restoreStatusArea').style.display = 'none';
    document.getElementById('confirmRestoreBtn').disabled = true;
    document.getElementById('restoreBackupModal').style.display = 'flex';
}

async function handleBackupFileSelect(event) {
    const file = event.target.files[0];
    const statusArea = document.getElementById('restoreStatusArea');
    const previewBox = document.getElementById('restorePreviewContainer');
    const summaryEl  = document.getElementById('restorePreviewSummary');
    const btn        = document.getElementById('confirmRestoreBtn');

    if (!file) return;

    try {
        const text = await file.text();
        const json = JSON.parse(text);

        // Validation check for OneReal backup structure
        const requiredCollections = ['students', 'teachers', 'classes', 'subjects'];
        const hasValidCollections = requiredCollections.some(col => Array.isArray(json[col]));

        if (!hasValidCollections && !json.students) {
            throw new Error('Invalid backup file. The JSON does not contain recognized school collections.');
        }

        pendingRestoreData = json;

        if (summaryEl) {
            summaryEl.innerHTML = `
                • Export Date: <strong>${json.exportedAt ? new Date(json.exportedAt).toLocaleString() : 'Unknown'}</strong><br>
                • Students: <strong>${(json.students || []).length}</strong><br>
                • Teachers: <strong>${(json.teachers || []).length}</strong><br>
                • Classes: <strong>${(json.classes || []).length}</strong><br>
                • Subjects: <strong>${(json.subjects || []).length}</strong><br>
                • Results: <strong>${(json.results || []).length}</strong><br>
                • Reports: <strong>${(json.reports || []).length}</strong>
            `;
        }

        if (previewBox) previewBox.style.display = 'block';
        if (statusArea) statusArea.style.display = 'none';
        if (btn) btn.disabled = false;

    } catch (e) {
        if (statusArea) {
            statusArea.style.display = 'block';
            statusArea.innerHTML = `<div class="auth-error"><i class="fas fa-times-circle"></i> ${escHtml(e.message)}</div>`;
        }
        if (btn) btn.disabled = true;
    }
}

async function executeBackupRestore() {
    if (!pendingRestoreData) { showToast('No valid backup file loaded.', 'error'); return; }
    if (!isAdmin()) { showToast('Only Administrators can perform database restoration.', 'error'); return; }

    const btn = document.getElementById('confirmRestoreBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring…'; }

    try {
        // Step 1: Create Automatic Pre-Restore Safety Snapshot
        showToast('Creating safety snapshot of current data…', 'info');
        const currentData = {
            exportedAt: new Date().toISOString(),
            isSafetySnapshot: true,
            students: adminState.students,
            teachers: adminState.teachers,
            classes: adminState.classes,
            subjects: adminState.subjects,
            academicYears: adminState.academicYears,
            terms: adminState.terms,
            results: adminState.results,
            reports: adminState.reports,
            users: adminState.users,
            gradingScales: adminState.gradingScales,
            schoolSettings: adminState.settings
        };
        downloadJSON(currentData, `pre_restore_safety_backup_${new Date().toISOString().split('T')[0]}.json`);

        // Step 2: Overwrite Collections in Local State & Firebase
        const data = pendingRestoreData;

        const collections = ['students', 'teachers', 'classes', 'subjects', 'academicYears', 'terms', 'results', 'reports', 'users', 'gradingScales'];
        if (data.attendanceMarks) {
            localStorage.setItem('attendanceMarks', JSON.stringify(data.attendanceMarks));
        }
        if (data.attendanceSettings) {
            localStorage.setItem('attendanceSettings', JSON.stringify(data.attendanceSettings));
        }

        for (const col of collections) {
            if (Array.isArray(data[col])) {
                adminState[col] = data[col];
                localStorage.setItem(col, JSON.stringify(data[col]));

                if (isFirebaseActive && db) {
                    for (const item of data[col]) {
                        if (item.id || item.uid) {
                            await db.collection(col).doc(item.id || item.uid).set(item, { merge: true });
                        }
                    }
                }
            }
        }

        if (data.schoolSettings) {
            adminState.settings = data.schoolSettings;
            await saveSchoolSettings(data.schoolSettings);
        }

        await logActivity('Database Restored', 'Restored backup file');
        showToast('✅ Database restored successfully!', 'success');
        closeModal('restoreBackupModal');
        await loadAllData();
        loadDashboard();

    } catch (e) {
        showToast(`Restore failed: ${e.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-restore"></i> Restore Data'; }
    }
}

function exportStudentsCSV() { exportCollectionCSV('students'); }

async function exportCollection(name) {
    startFileDownload('/api/export/' + encodeURIComponent(name) + '.json');
    showToast('File is ready. Use Save Excel or Copy table.', 'success');
}

async function exportCollectionCSV(name) {
    const path = name === 'attendance' ? '/api/export/attendance.xlsx' : '/api/export/' + encodeURIComponent(name) + '.xlsx';
    startFileDownload(path);
    showToast('Excel is ready. Use Save Excel or Copy table.', 'success');
}

async function confirmExportAll() {
    showConfirm('Export full database backup? This will include all school data.', async () => {
        await loadAllData();
        const backup = {
            exportedAt:    new Date().toISOString(),
            students:      adminState.students,
            teachers:      adminState.teachers,
            classes:       adminState.classes,
            subjects:      adminState.subjects,
            academicYears: adminState.academicYears,
            terms:         adminState.terms,
            results:       adminState.results,
            reports:       adminState.reports,
            users:         adminState.users,
            gradingScales: adminState.gradingScales,
            auditLogs:     adminState.auditLogs,
            settings:      adminState.settings,
            attendanceMarks: JSON.parse(localStorage.getItem('attendanceMarks') || '{}'),
            attendanceSettings: JSON.parse(localStorage.getItem('attendanceSettings') || '{}'),
            scores: JSON.parse(localStorage.getItem('scores') || '{}'),
            schoolInfo: JSON.parse(localStorage.getItem('schoolInfo') || '{}'),
            schoolSettings: adminState.settings,
            studentReportDetails: JSON.parse(localStorage.getItem('studentReportDetails') || '{}'),
            parentContacts: JSON.parse(localStorage.getItem('parentContacts') || '{}')
        };
        startFileDownload('/api/export/backup');
        showToast('Backup is ready. Use Save file or Copy table.', 'success');
    });
}

function openImportStudentsModal() { triggerImport('students'); }

async function startRealSchoolData() {
    showConfirm('Remove all demo students, teachers, scores, attendance and reports? School name, classes and grading stay. You can then add real staff and learners.', async () => {
        const emptyKeys = {
            students: [], teachers: [], users: [], results: [], reports: [],
            scores: {}, studentReportDetails: {}, parentContacts: {},
            attendanceMarks: {}, attendanceSettings: { defaultDays: {}, studentDays: {}, studentPresentOverride: {} }
        };
        Object.keys(emptyKeys).forEach(k => localStorage.setItem(k, JSON.stringify(emptyKeys[k])));
        localStorage.setItem('onerealSeedVersion', '2026-08-19-live1');
        adminState.students = [];
        adminState.teachers = [];
        adminState.users = [];
        adminState.results = [];
        adminState.reports = [];
        try {
            await fetch('/api/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(emptyKeys)
            });
        } catch (e) {}
        if (typeof isFirebaseConnected === 'function' && isFirebaseConnected() && typeof pushSchoolToFirebase === 'function') {
            try { await pushSchoolToFirebase(); } catch (e) {}
        }
        await loadAllData();
        loadDashboard();
        showToast('Demo data cleared. Add real teachers and students now.', 'success');
        await logActivity('Demo Data Cleared', 'Switched to real users');
        switchSection('teachers');
    }, 'Start with real users');
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────
function handleGlobalSearch(query) {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (!dropdown) return;

    if (!query || query.length < 2) { dropdown.style.display = 'none'; return; }
    const q = query.toLowerCase();

    const results = [
        ...adminState.students.filter(s => s.name?.toLowerCase().includes(q)).slice(0, 5).map(s => ({ type: 'Student', label: s.name, sub: resolveClass(s.classId || s.class), section: 'students', id: s.id })),
        ...adminState.teachers.filter(t => t.name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q)).slice(0, 3).map(t => ({ type: 'Teacher', label: t.name, sub: t.email, section: 'teachers', id: t.id })),
        ...adminState.classes.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 3).map(c => ({ type: 'Class', label: c.name, sub: '', section: 'classes', id: c.id })),
    ];

    if (!results.length) {
        dropdown.innerHTML = '<div style="padding:16px;color:#94a3b8;text-align:center;">No results found</div>';
    } else {
        dropdown.innerHTML = results.map(r => `
            <div class="search-result-item" onclick="handleSearchResultClick('${r.section}', '${r.id}')"
                 style="padding:12px 16px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">
                <span class="status-pill ${rolePillClass(r.type)}" style="font-size:10px;">${r.type}</span>
                <div>
                    <div style="font-weight:600;font-size:13px;">${escHtml(r.label)}</div>
                    <div style="font-size:11.5px;color:#94a3b8;">${escHtml(r.sub)}</div>
                </div>
            </div>`).join('');
    }
    dropdown.style.display = 'block';
}

function handleSearchResultClick(section, id) {
    document.getElementById('searchResultsDropdown').style.display = 'none';
    document.getElementById('globalSearch').value = '';
    switchSection(section);
    if (section === 'students') setTimeout(() => openStudentDrawer(id), 300);
}

document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (dropdown && !dropdown.contains(e.target) && !document.getElementById('globalSearch')?.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

// ─── MODAL & CONFIRM UTILITIES ────────────────────────────────────────────────
function closeModal(id, event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

function showConfirm(message, onConfirm, title = 'Confirm Action') {
    document.getElementById('confirmModalTitle').textContent   = title;
    document.getElementById('confirmModalMessage').textContent = message;
    const actionBtn = document.getElementById('confirmModalAction');
    actionBtn.onclick = () => { closeConfirmModal(); onConfirm(); };
    document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('confirmModal').style.display = 'none';
}


// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const area = document.getElementById('adminNotificationArea');
    if (!area) return;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${escHtml(message)}</span>`;
    area.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
function renderPagination(containerId, total, perPage, currentPage, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= Math.min(totalPages, 8); i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="(${onPageChange})(${i})">${i}</button>`;
    }
    if (totalPages > 8) html += `<button class="page-btn" onclick="(${onPageChange})(${totalPages})">${totalPages}</button>`;
    container.innerHTML = html;
}

// ─── DOWNLOAD HELPERS ─────────────────────────────────────────────────────────
function downloadJSON(data, filename) {
    return downloadFile(JSON.stringify(data, null, 2), filename, 'application/json');
}

function downloadFile(content, filename, mimeType) {
    if (window.OneRealFiles && OneRealFiles.download) {
        return OneRealFiles.download(filename, content, mimeType || 'application/octet-stream');
    }
    window.location.href = '/sheet.html?src=' + encodeURIComponent('/api/export/backup');
}

// ─── RESOLVE HELPERS ──────────────────────────────────────────────────────────
function resolveClass(classId) {
    if (!classId) return '';
    const cls = adminState.classes.find(c => c.id === classId || c.name === classId);
    return cls?.name || classId;
}

function resolveSubject(subjectId) {
    if (!subjectId) return '';
    const sub = adminState.subjects.find(s => s.id === subjectId || s.name === subjectId);
    return sub?.name || subjectId;
}

function emptyRow(cols, message) {
    return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:#94a3b8;">${message}</td></tr>`;
}

function escHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


// ─── ATTENDANCE ──────────────────────────────────────────────────────────────
function bindAdminAttendanceButtons() {
    const p = document.getElementById('adminAttAllPresent');
    const a = document.getElementById('adminAttAllAbsent');
    const c = document.getElementById('adminAttClearDay');
    if (p) p.onclick = function () { adminMarkAll('present'); };
    if (a) a.onclick = function () { adminMarkAll('absent'); };
    if (c) c.onclick = function () { adminMarkAll(''); };
}

function attendanceStudents() {
    const classF = document.getElementById('attFilterClass')?.value || '';
    let list = adminState.students.filter(s => s.status !== 'inactive');
    if (classF) {
        const cls = adminState.classes.find(c => c.id === classF || c.name === classF);
        list = list.filter(s => s.classId === classF || s.class === classF || (cls && (s.class === cls.name || s.classId === cls.id)));
    }
    return list;
}

function adminAttDate() {
    if (typeof Attendance === 'undefined') return '';
    const today = Attendance.todayISO();
    const el = document.getElementById('attFilterDate');
    let date = (el && el.value) || today;
    if (Attendance.isFuture(date)) {
        showToast('You cannot mark a date after today.', 'error');
        date = today;
        if (el) el.value = today;
    }
    if (Attendance.isWeekend(date)) {
        showToast('Weekends are not school days.', 'warning');
        const d = new Date(date + 'T12:00:00');
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        date = iso > today ? today : iso;
        if (el) el.value = date;
    }
    if (el) { el.max = today; el.value = date; }
    return date;
}

function onAdminAttDateChange() {
    adminAttDate();
    renderAttendanceSection();
}

function renderAttendanceSection() {
    if (typeof Attendance === 'undefined') {
        showToast('Attendance module failed to load. Hard-refresh the page.', 'error');
        return;
    }
    Attendance.load();
    populateSelect('attFilterClass', adminState.classes, 'id', 'name', 'All Classes');
    const date = adminAttDate();
    const list = attendanceStudents();
    const sum = Attendance.summaryForClass(list, date);
    const win = Attendance.termWindow();
    const days = Attendance.schoolDaysInTerm();

    const startEl = document.getElementById('attTermStart');
    const endEl = document.getElementById('attTermEnd');
    const daysEl = document.getElementById('attDefaultDays');
    const hint = document.getElementById('attComputedDaysHint');
    if (startEl && document.activeElement !== startEl) startEl.value = win.start || '';
    if (endEl && document.activeElement !== endEl) endEl.value = win.end && win.closed ? win.end : (win.end || '');
    if (daysEl && document.activeElement !== daysEl) daysEl.value = '';
    if (hint) hint.textContent = days ? ('Computed school days (weekdays only): ' + days) : 'Set term start so school days can be counted.';

    const sumEl = document.getElementById('attDailySummary');
    if (sumEl) {
        sumEl.innerHTML = `
            <span class="att-pill">${sum.present} present</span>
            <span class="att-pill">${sum.late} late</span>
            <span class="att-pill">${sum.absent} absent</span>
            <span class="att-pill">${sum.unmarked} unmarked</span>
            <span class="att-pill">${sum.total} students</span>
            <span class="att-pill">On reports: present OUT OF ${days || '—'}</span>`;
    }

    const tbody = document.getElementById('attRegisterBody');
    if (tbody) {
        tbody.innerHTML = list.length ? list.map((s, i) => {
            const m = Attendance.getDay(s.id, date);
            const st = m ? m.status : '';
            return `<tr>
                <td>${i + 1}</td>
                <td><strong>${escHtml(s.name)}</strong></td>
                <td>${escHtml(s.admissionNo || '')}</td>
                <td>${st ? `<span class="status-pill ${st === 'absent' ? 'pending' : 'approved'}">${st}</span>` : '—'}</td>
                <td><div class="att-mark">
                    <button type="button" class="att-btn ${st === 'present' ? 'on-present' : ''}" data-att-id="${s.id}" data-att-status="present">Present</button>
                    <button type="button" class="att-btn ${st === 'late' ? 'on-late' : ''}" data-att-id="${s.id}" data-att-status="late">Late</button>
                    <button type="button" class="att-btn ${st === 'absent' ? 'on-absent' : ''}" data-att-id="${s.id}" data-att-status="absent">Absent</button>
                </div></td>
            </tr>`;
        }).join('') : emptyRow(5, 'No students in this class');
        tbody.querySelectorAll('[data-att-id]').forEach(btn => {
            btn.addEventListener('click', () => adminMarkStudent(btn.getAttribute('data-att-id'), btn.getAttribute('data-att-status')));
        });
    }

    const totals = document.getElementById('attTotalsBody');
    if (totals) {
        totals.innerHTML = list.length ? list.map(s => {
            const present = Attendance.presentCount(s.id);
            const absent = Attendance.absentCount(s.id);
            const total = Attendance.totalDays(s.id);
            const ov = Attendance.hasPresentOverride(s.id);
            return `<tr>
                <td>${escHtml(s.name)}</td>
                <td>${present}</td>
                <td>${absent}</td>
                <td><input type="number" min="0" class="admin-input" style="width:90px;" value="${total || ''}"
                    onchange="adminSetStudentDays('${s.id}', this.value)"></td>
                <td><input type="number" min="0" class="admin-input" style="width:90px;" placeholder="auto"
                    value="${ov ? present : ''}"
                    onchange="adminSetPresentOverride('${s.id}', this.value)"></td>
                <td><strong>${escHtml(Attendance.label(s.id) || '—')}</strong></td>
            </tr>`;
        }).join('') : emptyRow(6, 'No students');
    }
    bindAdminAttendanceButtons();
}

function adminMarkStudent(id, status) {
    if (typeof Attendance === 'undefined') return;
    const date = adminAttDate();
    const current = Attendance.getDay(id, date);
    const next = current && current.status === status ? '' : status;
    const student = adminState.students.find(s => String(s.id) === String(id));
    const res = Attendance.mark(id, date, next, { className: student?.class || '', by: 'admin' });
    if (!res.ok) { showToast(res.error, 'error'); return; }
    renderAttendanceSection();
}

function adminMarkAll(status) {
    if (typeof Attendance === 'undefined') {
        showToast('Attendance module failed to load. Hard-refresh the page.', 'error');
        return;
    }
    const date = adminAttDate();
    const list = attendanceStudents();
    if (!list.length) { showToast('No students to mark. Choose a class with students.', 'warning'); return; }
    const res = Attendance.markMany(list, date, status, { by: 'admin' });
    if (!res.ok) { showToast(res.error, 'error'); return; }
    renderAttendanceSection();
    showToast(status ? `Marked all ${list.length} students ${status}.` : `Cleared ${list.length} marks for this day.`, 'success');
}

function saveAttendanceTermDays() {
    if (typeof Attendance === 'undefined') return;
    const start = document.getElementById('attTermStart')?.value || '';
    const end = document.getElementById('attTermEnd')?.value || '';
    const override = document.getElementById('attDefaultDays')?.value;
    Attendance.setTermRange(start, end);
    if (override !== '' && override != null) Attendance.setDefaultDays(override);
    renderAttendanceSection();
    showToast('Term school days saved. Reports will show days present out of this total.', 'success');
    logActivity('Attendance Days Updated', `Term range ${start}–${end || 'open'}`);
}

function saveAttendanceDefaultDays() { saveAttendanceTermDays(); }

function adminSetStudentDays(id, value) {
    if (typeof Attendance === 'undefined') return;
    Attendance.setStudentDays(id, value === '' ? '' : value);
    renderAttendanceSection();
}

function adminSetPresentOverride(id, value) {
    if (typeof Attendance === 'undefined') return;
    Attendance.setPresentOverride(id, value === '' ? '' : value);
    renderAttendanceSection();
}

function parseFirebaseConfigText(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    const pick = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        const cfg = {
            apiKey: String(obj.apiKey || '').trim(),
            authDomain: String(obj.authDomain || '').trim(),
            projectId: String(obj.projectId || '').trim(),
            storageBucket: String(obj.storageBucket || '').trim(),
            messagingSenderId: String(obj.messagingSenderId || '').trim(),
            appId: String(obj.appId || '').trim(),
            measurementId: String(obj.measurementId || '').trim()
        };
        return cfg.apiKey && cfg.projectId ? cfg : null;
    };

    try {
        const direct = JSON.parse(text);
        const ok = pick(direct);
        if (ok) return ok;
    } catch (e) {}

    let cleaned = text
        .replace(/^\uFEFF/, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/const\s+firebaseConfig\s*=/i, '')
        .replace(/let\s+firebaseConfig\s*=/i, '')
        .replace(/var\s+firebaseConfig\s*=/i, '')
        .replace(/export\s+default\s+/i, '')
        .replace(/;\s*$/m, '')
        .trim();

    const assign = text.match(/firebaseConfig\s*=\s*(\{[\s\S]*?\})\s*;?/i);
    if (assign) cleaned = assign[1];
    else {
        const brace = cleaned.match(/\{[\s\S]*\}/);
        if (brace) cleaned = brace[0];
    }

    cleaned = cleaned
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner.replace(/\\'/g, "'")))
        .replace(/,\s*([}\]])/g, '$1');

    try {
        const parsed = JSON.parse(cleaned);
        const ok = pick(parsed);
        if (ok) return ok;
    } catch (e) {}

    const grab = (key) => {
        const m = text.match(new RegExp(key + '\\s*[:=]\\s*[\'"]([^\'"]+)[\'"]', 'i'));
        return m ? m[1].trim() : '';
    };
    const fallback = pick({
        apiKey: grab('apiKey'),
        authDomain: grab('authDomain'),
        projectId: grab('projectId'),
        storageBucket: grab('storageBucket'),
        messagingSenderId: grab('messagingSenderId'),
        appId: grab('appId'),
        measurementId: grab('measurementId')
    });
    if (fallback) return fallback;
    throw new Error('Could not read the Firebase keys. Paste the whole firebaseConfig box from Firebase (Use a <script> tag), including apiKey and projectId.');
}

function firebaseConfigFromForm() {
    const pasted = (document.getElementById('fbConfigJson')?.value || '').trim();
    if (pasted) {
        const fromPaste = parseFirebaseConfigText(pasted);
        if (fromPaste) {
            const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
            fill('fbApiKey', fromPaste.apiKey);
            fill('fbAuthDomain', fromPaste.authDomain);
            fill('fbProjectId', fromPaste.projectId);
            fill('fbStorageBucket', fromPaste.storageBucket);
            fill('fbMessagingSenderId', fromPaste.messagingSenderId);
            fill('fbAppId', fromPaste.appId);
            return fromPaste;
        }
    }
    return {
        apiKey: document.getElementById('fbApiKey')?.value?.trim() || '',
        authDomain: document.getElementById('fbAuthDomain')?.value?.trim() || '',
        projectId: document.getElementById('fbProjectId')?.value?.trim() || '',
        storageBucket: document.getElementById('fbStorageBucket')?.value?.trim() || '',
        messagingSenderId: document.getElementById('fbMessagingSenderId')?.value?.trim() || '',
        appId: document.getElementById('fbAppId')?.value?.trim() || ''
    };
}

function loadFirebaseForm() {
    const cfg = typeof getStoredFirebaseConfig === 'function' ? getStoredFirebaseConfig() : {};
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('fbApiKey', cfg.apiKey);
    set('fbAuthDomain', cfg.authDomain);
    set('fbProjectId', cfg.projectId);
    set('fbStorageBucket', cfg.storageBucket);
    set('fbMessagingSenderId', cfg.messagingSenderId);
    set('fbAppId', cfg.appId);
    const jsonEl = document.getElementById('fbConfigJson');
    if (jsonEl && cfg.apiKey) jsonEl.value = JSON.stringify(cfg, null, 2);
    refreshFirebaseStatus();
}

function refreshFirebaseStatus() {
    const el = document.getElementById('fbCloudStatus');
    const text = typeof getFirebaseStatusText === 'function' ? getFirebaseStatusText() : 'LOCAL';
    if (el) el.textContent = 'Status: ' + text + (typeof isFirebaseConnected === 'function' && isFirebaseConnected() ? ' — live sync on' : '');
    const roleEl = document.getElementById('sidebarUserRole');
    if (roleEl && text === 'CLOUD') roleEl.textContent = (roleEl.textContent || 'Admin').replace(' · CLOUD', '') + ' · CLOUD';
}

async function connectFirebaseFromSettings() {
    try {
        const cfg = firebaseConfigFromForm();
        if (!cfg.apiKey || !cfg.projectId) {
            showToast('Enter apiKey and projectId, or paste the full firebaseConfig JSON.', 'error');
            return;
        }
        saveFirebaseConfig(cfg);
        const ok = initFirebase(cfg);
        if (!ok) {
            const why = (typeof getLastFirebaseError === 'function' && getLastFirebaseError())
                || (typeof firebase === 'undefined' ? 'Firebase SDK did not load.' : 'Check the keys.');
            showToast('Could not start Firebase. ' + why, 'error');
            refreshFirebaseStatus();
            return;
        }
        refreshFirebaseStatus();
        showToast('Firebase connected! Auto-syncing school data & user accounts to cloud…', 'info');
        await logActivity('Firebase Connected', cfg.projectId);

        // Automatic upload of all school data to cloud (no manual button needed!)
        try {
            if (typeof pushSchoolToFirebase === 'function') {
                await pushSchoolToFirebase();
            }
        } catch (e) {
            console.warn('Auto upload notice:', e);
        }

        // Automatic provisioning of all staff auth accounts (no manual button needed!)
        try {
            if (typeof provisionStaffFromLocal === 'function') {
                await provisionStaffFromLocal();
            }
        } catch (e) {
            console.warn('Auto provision notice:', e);
        }

        refreshFirebaseStatus();
        showToast('Firebase connected! All school data & user accounts auto-synced to cloud.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function uploadSchoolToFirebase() {
    try {
        if (typeof pushSchoolToFirebase !== 'function') throw new Error('Firebase helper missing. Hard-refresh.');
        showToast('Uploading school data to Firestore…', 'info');
        const res = await pushSchoolToFirebase();
        refreshFirebaseStatus();
        showToast('Uploaded ' + res.collections + ' collections to Firebase.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function downloadSchoolFromFirebase() {
    try {
        if (typeof pullSchoolFromFirebase !== 'function') throw new Error('Firebase helper missing.');
        showToast('Pulling school data from Firestore…', 'info');
        const ok = await pullSchoolFromFirebase();
        await loadAllData();
        loadDashboard();
        loadSettingsForm();
        showToast(ok ? 'Cloud data loaded into this browser.' : 'No cloud documents found yet. Upload first.', ok ? 'success' : 'warning');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function provisionFirebaseStaff() {
    try {
        if (typeof provisionStaffFromLocal !== 'function') throw new Error('Firebase helper missing.');
        showToast('Creating Firebase Auth accounts for staff…', 'info');
        const res = await provisionStaffFromLocal();
        showToast('Created ' + res.created.length + ' Auth account(s). Skipped: ' + (res.skipped.length ? res.skipped.join('; ') : 'none'), 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ─── DEVELOPER AUTHENTICATION (PASSWORD GATE: @Slimgee22) ─────────────────────
function openDevPasswordModal() {
    const modal = document.getElementById('devPasswordModal');
    const input = document.getElementById('devPasswordInput');
    const err = document.getElementById('devPasswordError');
    if (input) input.value = '';
    if (err) err.style.display = 'none';
    if (modal) modal.style.display = 'flex';
    setTimeout(() => { if (input) input.focus(); }, 100);
}

function submitDevPassword(e) {
    if (e && e.preventDefault) e.preventDefault();
    const input = document.getElementById('devPasswordInput');
    const err = document.getElementById('devPasswordError');
    const pwd = input?.value || '';
    if (pwd === '@Slimgee22') {
        sessionStorage.setItem('devUnlocked', 'true');
        closeModal('devPasswordModal');
        switchSection('firebase');
        showToast('Developer access granted.', 'success');
    } else {
        if (err) {
            err.textContent = 'Incorrect developer password. Access denied.';
            err.style.display = 'block';
        }
    }
}

function lockDevMode() {
    sessionStorage.removeItem('devUnlocked');
    switchSection('dashboard');
    showToast('Developer access locked.', 'info');
}

function parseConfigJsonInput() {
    try {
        const pasted = (document.getElementById('fbConfigJson')?.value || '').trim();
        if (pasted) {
            const parsed = parseFirebaseConfigText(pasted);
            if (parsed) {
                const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
                set('fbApiKey', parsed.apiKey);
                set('fbAuthDomain', parsed.authDomain);
                set('fbProjectId', parsed.projectId);
                set('fbStorageBucket', parsed.storageBucket);
                set('fbMessagingSenderId', parsed.messagingSenderId);
                set('fbAppId', parsed.appId);
            }
        }
    } catch (e) {}
}

window.addEventListener('storage', (e) => {
    if (['reports', 'scores', 'results', 'students', 'classes', 'subjects', 'schoolSettings'].includes(e.key)) {
        loadAllData({ refreshForms: false }).then(() => {
            const activeSection = document.querySelector('.admin-section.active, .content-section.active');
            if (activeSection) {
                const id = activeSection.id;
                if (id === 'section-reports') renderReportsTable();
                else if (id === 'section-results') renderResultsTable();
                else if (id === 'section-overview') loadDashboard();
            }
        });
    }
});

// ─── One-Click Cloud Backup & Offline Sync Management ─────────────────────────
async function loadBackupSnapshots() {
    const tbody = document.getElementById('backupSnapshotsTbody');
    const countEl = document.getElementById('backup-snapshot-count');
    const pwaStatusEl = document.getElementById('pwa-sync-status');
    const pwaHintEl = document.getElementById('pwa-pending-hint');

    // Update PWA offline status indicator
    if (pwaStatusEl && pwaHintEl) {
        const isOnline = navigator.onLine;
        const pendingCount = (window.OneRealSync && typeof window.OneRealSync.getPendingCount === 'function')
            ? window.OneRealSync.getPendingCount() : 0;

        pwaStatusEl.textContent = isOnline ? 'Ready (Online)' : 'Offline Working Mode';
        pwaStatusEl.style.color = isOnline ? '#10b981' : '#f59e0b';
        pwaHintEl.textContent = `${pendingCount} Offline Action${pendingCount === 1 ? '' : 's'} Pending`;
    }

    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i> Fetching snapshots from cloud storage...</td></tr>`;

    try {
        const res = await fetch('/api/backup/list');
        if (!res.ok) throw new Error('Failed to retrieve backup list');
        const snapshots = await res.json();

        if (countEl) countEl.textContent = snapshots.length;

        if (!snapshots || snapshots.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:28px; color:#64748b;">No snapshots found. Click <strong>"Create Instant Cloud Snapshot"</strong> above to create your first safe backup!</td></tr>`;
            return;
        }

        tbody.innerHTML = snapshots.map(s => {
            const sizeKb = (s.size / 1024).toFixed(1);
            const dateStr = s.created ? new Date(s.created).toLocaleString() : 'N/A';
            const isManual = s.isManual;
            const recordsSummary = `${s.recordsSummary?.students || 0} students, ${s.recordsSummary?.teachers || 0} staff, ${s.recordsSummary?.results || 0} marks`;

            return `
                <tr>
                    <td>
                        <div style="font-weight:600; font-family:monospace; font-size:13px; color:#1e293b;">
                            <i class="fas fa-file-archive" style="color:#3b82f6; margin-right:6px;"></i>${s.filename}
                        </div>
                    </td>
                    <td style="font-size:13px; color:#475569;">${dateStr}</td>
                    <td>
                        <span class="badge ${isManual ? 'badge-verified' : 'badge-pending'}">
                            ${isManual ? 'Manual Instant Snapshot' : 'Daily Automated Export'}
                        </span>
                    </td>
                    <td style="font-size:12.5px; color:#64748b;">${recordsSummary}</td>
                    <td style="font-size:13px; font-weight:600; color:#334155;">${sizeKb} KB</td>
                    <td>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button class="btn-admin btn-ghost btn-sm" onclick="downloadCloudSnapshot('${s.filename}')" title="Download Snapshot file">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn-admin btn-ghost btn-sm" style="color:#059669;" onclick="restoreCloudSnapshot('${s.filename}')" title="Restore database to this point in time">
                                <i class="fas fa-undo"></i> Restore
                            </button>
                            <button class="btn-admin btn-ghost btn-sm" style="color:#ef4444;" onclick="deleteCloudSnapshot('${s.filename}')" title="Delete snapshot">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('Backup load error:', err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#ef4444;"><i class="fas fa-exclamation-circle"></i> Error loading cloud snapshots: ${err.message}</td></tr>`;
    }
}

async function triggerManualCloudSnapshot() {
    try {
        showToast('Initiating cloud backup snapshot...', 'info');
        const res = await fetch('/api/backup/snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Admin Manual Snapshot' })
        });
        if (!res.ok) throw new Error('Snapshot generation failed');
        const data = await res.json();
        showToast('Instant Cloud Snapshot Created Successfully!', 'success');
        await loadBackupSnapshots();
    } catch (e) {
        showToast(`Backup error: ${e.message}`, 'error');
    }
}

function downloadCloudSnapshot(filename) {
    window.location.href = `/api/backup/download?file=${encodeURIComponent(filename)}`;
}

async function restoreCloudSnapshot(filename) {
    if (!confirm(`Are you sure you want to restore the database from snapshot "${filename}"?\n\nThis will safely reset all records to the point in time when this snapshot was created. A safety backup of your current database will be generated automatically before restoring.`)) {
        return;
    }

    try {
        showToast('Restoring database snapshot...', 'info');
        const res = await fetch('/api/backup/restore-snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to restore snapshot');
        }
        showToast('Database Restored Successfully! Reloading records...', 'success');
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    } catch (e) {
        showToast(`Restore error: ${e.message}`, 'error');
    }
}

async function deleteCloudSnapshot(filename) {
    if (!confirm(`Delete snapshot "${filename}" permanently?`)) return;
    try {
        const res = await fetch(`/api/backup/delete?file=${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast('Snapshot deleted.', 'info');
            await loadBackupSnapshots();
        } else {
            showToast('Failed to delete snapshot', 'error');
        }
    } catch (e) {
        showToast(`Delete error: ${e.message}`, 'error');
    }
}

function exportBrowserSnapshot() {
    try {
        const fullData = {
            exportDate: new Date().toISOString(),
            system: 'OneReal School Management System',
            state: adminState
        };
        const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `onereal-local-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Local JSON Backup downloaded.', 'success');
    } catch (e) {
        showToast('Export error: ' + e.message, 'error');
    }
}

async function forceSyncOfflineQueue() {
    if (window.OneRealSync && typeof window.OneRealSync.syncNow === 'function') {
        showToast('Triggering offline mutation sync...', 'info');
        await window.OneRealSync.syncNow();
        await loadBackupSnapshots();
    } else {
        showToast('Offline sync service ready. No pending offline items.', 'info');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN TIMETABLES & EXAMINATION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
let currentAdminTtClass = '';
let currentAdminTtData = null;
let currentAdminConfigPeriods = [];
let adminExamsList = [];

function switchAdminTimetableSubTab(tab) {
    const btnClass = document.getElementById('adminTtSubTabClass');
    const btnExams = document.getElementById('adminTtSubTabExams');
    const btnTeachers = document.getElementById('adminTtSubTabTeachers');

    const viewClass = document.getElementById('adminTtViewClass');
    const viewExams = document.getElementById('adminTtViewExams');
    const viewTeachers = document.getElementById('adminTtViewTeachers');

    if (!btnClass || !viewClass) return;

    [btnClass, btnExams, btnTeachers].forEach(b => {
        if (b) {
            b.classList.remove('btn-primary');
            b.classList.add('btn-ghost');
        }
    });
    [viewClass, viewExams, viewTeachers].forEach(v => {
        if (v) v.style.display = 'none';
    });

    if (tab === 'class') {
        btnClass.classList.add('btn-primary');
        btnClass.classList.remove('btn-ghost');
        viewClass.style.display = 'block';
        loadAdminClassTimetable();
    } else if (tab === 'exams') {
        btnExams.classList.add('btn-primary');
        btnExams.classList.remove('btn-ghost');
        viewExams.style.display = 'block';
        renderAdminExamsTable();
    } else if (tab === 'teachers') {
        btnTeachers.classList.add('btn-primary');
        btnTeachers.classList.remove('btn-ghost');
        viewTeachers.style.display = 'block';
        populateAdminTtTeacherDropdown();
        renderAdminTeacherSchedule();
    }
}

function initAdminTimetablesSection() {
    populateAdminTtClassDropdown();
    loadAdminClassTimetable();
    renderAdminExamsTable();
}

function populateAdminTtClassDropdown() {
    const classSelect = document.getElementById('adminTtClassSelect');
    const examFilter = document.getElementById('adminExamClassFilter');
    const aemClass = document.getElementById('aem-class');

    let classes = (adminState.classes || []).filter(c => !c.isDeleted && c.status !== 'inactive');
    if (!classes.length) {
        const localClasses = safeLocalGet('classes', []);
        classes = (Array.isArray(localClasses) ? localClasses : []).filter(c => !c.isDeleted && c.status !== 'inactive');
    }
    const classOptions = classes.map(c => `<option value="${escHtml(c.name || c.id)}">${escHtml(c.name || c.id)}</option>`).join('');

    if (classSelect) {
        const prev = classSelect.value;
        classSelect.innerHTML = classOptions || '<option value="">No classes configured</option>';
        if (prev && classes.some(c => (c.name || c.id) === prev)) {
            classSelect.value = prev;
        } else if (classes.length > 0) {
            classSelect.value = classes[0].name || classes[0].id;
        }
    }

    if (examFilter) {
        const prev = examFilter.value;
        examFilter.innerHTML = '<option value="">All Classes</option>' + classOptions;
        if (prev) examFilter.value = prev;
    }

    if (aemClass) {
        aemClass.innerHTML = '<option value="">-- Select Class --</option>' + classOptions;
    }
}

function populateAdminTtTeacherDropdown() {
    const teacherSelect = document.getElementById('adminTtTeacherSelect');
    if (!teacherSelect) return;
    let teachers = (adminState.teachers || []).filter(t => !t.isDeleted && t.status !== 'inactive');
    if (!teachers.length) {
        const localTeachers = safeLocalGet('teachers', []);
        teachers = (Array.isArray(localTeachers) ? localTeachers : []).filter(t => !t.isDeleted && t.status !== 'inactive');
    }
    teacherSelect.innerHTML = teachers.length
        ? teachers.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)} (${escHtml(t.role || 'Teacher')})</option>`).join('')
        : '<option value="">No teachers registered</option>';
}

function getDefaultAdminPeriods() {
    return [
        { period: 1, time: '08:00 - 08:45', name: 'Period 1' },
        { period: 2, time: '08:45 - 09:30', name: 'Period 2' },
        { period: 3, time: '09:30 - 10:15', name: 'Period 3' },
        { period: 4, time: '10:15 - 10:45', isBreak: true, name: 'Snack Break' },
        { period: 5, time: '10:45 - 11:30', name: 'Period 4' },
        { period: 6, time: '11:30 - 12:15', name: 'Period 5' },
        { period: 7, time: '12:15 - 01:00', isBreak: true, name: 'Lunch & Rest' },
        { period: 8, time: '01:00 - 01:45', name: 'Period 6' },
        { period: 9, time: '01:45 - 02:30', name: 'Period 7' }
    ];
}

async function loadAdminClassTimetable() {
    const classSelect = document.getElementById('adminTtClassSelect');
    if (!classSelect || !classSelect.value) {
        populateAdminTtClassDropdown();
    }
    let cls = classSelect ? classSelect.value : '';
    if (!cls && classSelect && classSelect.options && classSelect.options.length > 0 && classSelect.options[0].value) {
        cls = classSelect.options[0].value;
        classSelect.value = cls;
    }
    currentAdminTtClass = cls;

    const classObj = (adminState.classes || []).find(c => (c.name || c.id) === cls);
    const teacherLabel = document.getElementById('adminTtClassTeacherLabel');
    if (teacherLabel) {
        if (classObj && (classObj.classTeacherName || classObj.teacher)) {
            teacherLabel.textContent = `· Class Teacher: ${classObj.classTeacherName || classObj.teacher}`;
        } else {
            teacherLabel.textContent = '';
        }
    }

    if (!cls) {
        const container = document.getElementById('adminTtGridContainer');
        if (container) container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);">Please select or create a class first.</div>';
        return;
    }

    try {
        const res = await fetch(`/api/timetables?class=${encodeURIComponent(cls)}`);
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list) && list.length > 0) {
                currentAdminTtData = list[0];
            } else {
                const localList = safeLocalGet('timetables', []);
                const localMatch = Array.isArray(localList) ? localList.find(t => (t.class || '').toLowerCase() === cls.toLowerCase()) : null;
                currentAdminTtData = localMatch || {
                    id: 'tt-' + cls.toLowerCase().replace(/\s+/g, '-'),
                    class: cls,
                    classId: classObj?.id || cls,
                    periods: getDefaultAdminPeriods(),
                    schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
                };
            }
        } else {
            throw new Error('Server request failed');
        }
    } catch (e) {
        const localList = safeLocalGet('timetables', []);
        const localMatch = Array.isArray(localList) ? localList.find(t => (t.class || '').toLowerCase() === cls.toLowerCase()) : null;
        currentAdminTtData = localMatch || {
            id: 'tt-' + cls.toLowerCase().replace(/\s+/g, '-'),
            class: cls,
            classId: classObj?.id || cls,
            periods: getDefaultAdminPeriods(),
            schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }
        };
    }

    if (!currentAdminTtData.schedule) {
        currentAdminTtData.schedule = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
    }
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(day => {
        if (!Array.isArray(currentAdminTtData.schedule[day])) currentAdminTtData.schedule[day] = [];
    });

    renderAdminTimetableGrid();
}

function renderAdminTimetableGrid() {
    const container = document.getElementById('adminTtGridContainer');
    const badge = document.getElementById('adminTtSlotCountBadge');
    const titleEl = document.getElementById('adminTtGridTitle');
    if (!container || !currentAdminTtData) return;

    if (titleEl) titleEl.textContent = `${currentAdminTtData.class || currentAdminTtClass} · Weekly Master Schedule`;

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const periods = currentAdminTtData.periods || getDefaultAdminPeriods();

    let totalSlotsAssigned = 0;
    days.forEach(d => {
        (currentAdminTtData.schedule[d] || []).forEach(slot => {
            if (slot.subject) totalSlotsAssigned++;
        });
    });

    if (badge) badge.textContent = `${totalSlotsAssigned} Slots Assigned`;

    let html = `
        <table class="tt-grid-table">
            <thead>
                <tr>
                    <th class="tt-time-col"><i class="fas fa-clock"></i> Time / Period</th>
                    <th>Monday</th>
                    <th>Tuesday</th>
                    <th>Wednesday</th>
                    <th>Thursday</th>
                    <th>Friday</th>
                </tr>
            </thead>
            <tbody>
    `;

    periods.forEach(p => {
        if (p.isBreak) {
            html += `
                <tr class="tt-break-row">
                    <td class="tt-time-cell"><strong>${escHtml(p.name || 'Break')}</strong><br><span style="font-size:11px;">${escHtml(p.time || '')}</span></td>
                    <td colspan="5" class="tt-break-cell"><i class="fas fa-mug-hot" style="margin-right:6px;"></i> ${escHtml(p.name || 'Break Interval')} (${escHtml(p.time || '')})</td>
                </tr>
            `;
        } else {
            html += `
                <tr>
                    <td class="tt-time-cell">
                        <strong>Period ${p.period}</strong>
                        <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${escHtml(p.time || '')}</div>
                    </td>
            `;

            days.forEach(day => {
                const daySlots = currentAdminTtData.schedule[day] || [];
                const slot = daySlots.find(s => Number(s.period) === Number(p.period));

                if (slot && slot.subject) {
                    html += `
                        <td>
                            <div class="tt-slot-card" onclick="openAdminEditSlotModal('${day}', ${p.period})" title="Click to edit slot">
                                <div>
                                    <div class="tt-subject-badge">${escHtml(slot.subject)}</div>
                                    <div class="tt-teacher-name"><i class="fas fa-user-circle"></i> ${escHtml(slot.teacher || 'Unassigned')}</div>
                                </div>
                                ${slot.room ? `<div class="tt-room-name"><i class="fas fa-map-marker-alt"></i> ${escHtml(slot.room)}</div>` : ''}
                            </div>
                        </td>
                    `;
                } else {
                    html += `
                        <td>
                            <div class="tt-slot-empty" onclick="openAdminEditSlotModal('${day}', ${p.period})" title="Click to assign slot">
                                <span><i class="fas fa-plus" style="margin-right:4px;"></i> Assign</span>
                            </div>
                        </td>
                    `;
                }
            });

            html += `</tr>`;
        }
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function openAdminEditSlotModal(day, period) {
    if (!currentAdminTtData) return;
    const modal = document.getElementById('adminEditSlotModal');
    const dayInput = document.getElementById('aesm-day');
    const periodInput = document.getElementById('aesm-period');
    const targetInfo = document.getElementById('aesm-targetInfo');
    const subjectSelect = document.getElementById('aesm-subject');
    const teacherSelect = document.getElementById('aesm-teacher');
    const roomInput = document.getElementById('aesm-room');

    if (!modal) return;

    dayInput.value = day;
    periodInput.value = period;

    const pObj = (currentAdminTtData.periods || []).find(p => Number(p.period) === Number(period));
    const timeLabel = pObj?.time ? ` (${pObj.time})` : '';
    if (targetInfo) targetInfo.textContent = `${day} · Period ${period}${timeLabel}`;

    // Fill subjects dropdown
    let subjects = (adminState.subjects || []).filter(s => !s.isDeleted && s.status !== 'inactive');
    if (!subjects.length) {
        const localSub = safeLocalGet('subjects', []);
        subjects = (Array.isArray(localSub) ? localSub : []).filter(s => !s.isDeleted && s.status !== 'inactive');
    }
    if (subjectSelect) {
        subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>' +
            subjects.map(s => `<option value="${escHtml(s.name || s.id)}">${escHtml(s.name || s.id)}</option>`).join('');
    }

    // Fill teachers dropdown
    let teachers = (adminState.teachers || []).filter(t => !t.isDeleted && t.status !== 'inactive');
    if (!teachers.length) {
        const localTeach = safeLocalGet('teachers', []);
        teachers = (Array.isArray(localTeach) ? localTeach : []).filter(t => !t.isDeleted && t.status !== 'inactive');
    }
    if (teacherSelect) {
        teacherSelect.innerHTML = '<option value="">-- Select Teacher --</option>' +
            teachers.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)} (${escHtml(t.role || 'Teacher')})</option>`).join('');
    }

    // Find current values
    const daySlots = currentAdminTtData.schedule[day] || [];
    const currentSlot = daySlots.find(s => Number(s.period) === Number(period));

    if (currentSlot) {
        if (subjectSelect) subjectSelect.value = currentSlot.subject || '';
        if (teacherSelect) teacherSelect.value = currentSlot.teacher || '';
        if (roomInput) roomInput.value = currentSlot.room || '';
    } else {
        if (subjectSelect) subjectSelect.value = '';
        if (teacherSelect) teacherSelect.value = '';
        if (roomInput) roomInput.value = '';
    }

    modal.style.display = 'flex';
}

function saveAdminTimetableSlot() {
    if (!currentAdminTtData) return;
    const day = document.getElementById('aesm-day')?.value;
    const period = parseInt(document.getElementById('aesm-period')?.value);
    const subject = document.getElementById('aesm-subject')?.value || '';
    const teacher = document.getElementById('aesm-teacher')?.value || '';
    const room = document.getElementById('aesm-room')?.value || '';

    if (!subject) {
        showToast('Please select a subject for this period.', 'warning');
        return;
    }

    if (!currentAdminTtData.schedule[day]) currentAdminTtData.schedule[day] = [];
    const idx = currentAdminTtData.schedule[day].findIndex(s => Number(s.period) === Number(period));

    const newSlot = { period, subject, teacher, room };
    if (idx >= 0) {
        currentAdminTtData.schedule[day][idx] = newSlot;
    } else {
        currentAdminTtData.schedule[day].push(newSlot);
    }

    closeModal('adminEditSlotModal');
    renderAdminTimetableGrid();
    showToast(`Assigned ${subject} for ${day} Period ${period}. Click 'Save Timetable' to persist.`, 'info');
}

function clearAdminTimetableSlot() {
    if (!currentAdminTtData) return;
    const day = document.getElementById('aesm-day')?.value;
    const period = parseInt(document.getElementById('aesm-period')?.value);

    if (currentAdminTtData.schedule[day]) {
        currentAdminTtData.schedule[day] = currentAdminTtData.schedule[day].filter(s => Number(s.period) !== Number(period));
    }

    closeModal('adminEditSlotModal');
    renderAdminTimetableGrid();
    showToast(`Cleared ${day} Period ${period} slot.`, 'info');
}

async function saveAdminClassTimetable() {
    if (!currentAdminTtData) return showToast('No timetable to save.', 'warning');
    const cls = document.getElementById('adminTtClassSelect')?.value || currentAdminTtData.class;
    if (!cls) return showToast('Please select a class.', 'warning');

    currentAdminTtData.class = cls;
    currentAdminTtData.updatedAt = new Date().toISOString();

    // Cache locally
    try {
        const localList = safeLocalGet('timetables', []) || [];
        const existingIdx = localList.findIndex(t => (t.class || '').toLowerCase() === cls.toLowerCase() || t.id === currentAdminTtData.id);
        if (existingIdx >= 0) {
            localList[existingIdx] = currentAdminTtData;
        } else {
            localList.push(currentAdminTtData);
        }
        localStorage.setItem('timetables', JSON.stringify(localList));
    } catch (e) {}

    try {
        showToast('Saving class timetable to server...', 'info');
        const res = await fetch('/api/timetables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentAdminTtData)
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to save timetable');
        }

        const saved = await res.json();
        currentAdminTtData = saved;
        showToast(`Official timetable for ${cls} saved & published!`, 'success');
        if (typeof logActivity === 'function') {
            await logActivity('Timetable Published', `Admin published weekly timetable for ${cls}`, currentAdminTtData.id);
        }
    } catch (e) {
        showToast(`Timetable saved locally: ${e.message}`, 'info');
    }
}

function openConfigurePeriodsModal() {
    if (!currentAdminTtData) return;
    currentAdminConfigPeriods = JSON.parse(JSON.stringify(currentAdminTtData.periods || getDefaultAdminPeriods()));
    renderAdminConfigurePeriodsModal();
    const modal = document.getElementById('adminConfigurePeriodsModal');
    if (modal) modal.style.display = 'flex';
}

function renderAdminConfigurePeriodsModal() {
    const listEl = document.getElementById('acpm-periodsList');
    if (!listEl) return;

    listEl.innerHTML = currentAdminConfigPeriods.map((p, idx) => `
        <div style="display:flex; align-items:center; gap:8px; background:var(--surface-2); padding:8px 10px; border-radius:6px; border:1px solid var(--border);">
            <div style="width:28px; font-weight:700; font-size:12px; color:var(--text-secondary); text-align:center;">#${idx+1}</div>
            <input type="text" class="admin-input" style="flex:1; padding:6px 10px; font-size:12.5px;" value="${escHtml(p.name || '')}" placeholder="e.g. Period 1, Lunch Break" oninput="currentAdminConfigPeriods[${idx}].name = this.value">
            <input type="text" class="admin-input" style="width:130px; padding:6px 10px; font-size:12.5px;" value="${escHtml(p.time || '')}" placeholder="08:00 - 08:45" oninput="currentAdminConfigPeriods[${idx}].time = this.value">
            <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer; margin:0 4px;">
                <input type="checkbox" ${p.isBreak ? 'checked' : ''} onchange="currentAdminConfigPeriods[${idx}].isBreak = this.checked"> Break?
            </label>
            <button type="button" class="btn-admin btn-ghost btn-sm" style="color:#ef4444; padding:4px 8px;" onclick="currentAdminConfigPeriods.splice(${idx}, 1); renderAdminConfigurePeriodsModal();">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function addAdminConfigPeriodRow() {
    const nextNum = currentAdminConfigPeriods.filter(p => !p.isBreak).length + 1;
    currentAdminConfigPeriods.push({
        period: nextNum,
        name: `Period ${nextNum}`,
        time: '08:00 - 08:45',
        isBreak: false
    });
    renderAdminConfigurePeriodsModal();
}

function saveAdminConfiguredPeriods() {
    if (!currentAdminTtData) return;
    let pNum = 1;
    currentAdminConfigPeriods.forEach(p => {
        if (!p.isBreak) {
            p.period = pNum++;
        }
    });

    currentAdminTtData.periods = currentAdminConfigPeriods;
    closeModal('adminConfigurePeriodsModal');
    renderAdminTimetableGrid();
    showToast('Updated period timeline. Click "Save Timetable" to persist changes.', 'info');
}

function downloadAdminTimetablePDF() {
    const cls = currentAdminTtClass || 'Class';
    const gridEl = document.getElementById('adminTtGridContainer');
    if (!gridEl || !gridEl.querySelector('table')) return showToast('No timetable to print/export.', 'warning');

    const settings = adminState.settings || safeLocalGet('schoolSettings', {}) || {};
    const schoolName = settings.schoolName || 'OneReal Academy';
    const schoolMotto = settings.schoolMotto || 'Excellence in Education';
    const schoolPhone = settings.schoolPhone || '';

    const contentHtml = `<!DOCTYPE html><html><head><title>${cls} Timetable</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
            body { margin: 24px; font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #1e293b; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
            .header h1 { margin: 0 0 4px; font-size: 22px; color: #1e1b4b; text-transform: uppercase; font-weight: 800; }
            .header .motto { margin: 0 0 6px; font-size: 13px; color: #64748b; font-style: italic; }
            .header .doc-title { margin: 0; font-size: 15px; color: #4f46e5; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; }
            th, td { border: 1px solid #cbd5e1; padding: 10px 8px; text-align: center; font-size: 12px; }
            th { background: #4f46e5; color: #ffffff; font-weight: 700; }
            .tt-break-cell { background: #fef3c7; color: #92400e; font-weight: bold; }
            .tt-subject-badge { font-weight: 700; color: #4338ca; }
            .tt-teacher-name { font-size: 11px; color: #64748b; margin-top: 2px; }
            .tt-room-name { font-size: 10.5px; color: #059669; margin-top: 2px; }
            .tt-time-cell { background: #f8fafc; font-size: 11.5px; }
            @media print { body { margin: 0; } }
        </style>
    </head><body>
        <div class="header">
            <h1>${escHtml(schoolName)}</h1>
            <div class="motto">${escHtml(schoolMotto)}${schoolPhone ? ' · Tel: ' + escHtml(schoolPhone) : ''}</div>
            <div class="doc-title">Official Weekly Class Timetable — ${escHtml(cls)}</div>
        </div>
        ${gridEl.innerHTML}
        <div style="margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
            <span>Official Record — School Administration</span>
            <span>Generated: ${new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
        </div>
        <script>window.onload=function(){ window.print(); };<\/script>
    </body></html>`;

    const win = window.open('', '_blank', 'width=950,height=800');
    if (win) {
        win.document.write(contentHtml);
        win.document.close();
    } else {
        // Fallback for iframe restrictions
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        document.body.appendChild(frame);
        frame.contentDocument.write(contentHtml);
        frame.contentDocument.close();
        setTimeout(() => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => frame.remove(), 1000);
        }, 500);
    }
}

function exportAdminTimetableExcel() {
    const cls = currentAdminTtClass || '';
    window.location.href = `/api/export/timetable.xlsx?class=${encodeURIComponent(cls)}`;
}

function printAdminTimetable() {
    downloadAdminTimetablePDF();
}

// ── EXAMINATION SCHEDULES & INVIGILATION ────────────────────────────────────
async function renderAdminExamsTable() {
    const tbody = document.getElementById('adminExamsTableBody');
    const countEl = document.getElementById('adminExamsCount');
    const search = (document.getElementById('adminExamSearch')?.value || '').toLowerCase();
    const classFilter = document.getElementById('adminExamClassFilter')?.value || '';

    if (!tbody) return;

    try {
        const res = await fetch('/api/timetables/exams');
        if (res.ok) {
            adminExamsList = await res.json();
            localStorage.setItem('examTimetables', JSON.stringify(adminExamsList));
        } else {
            throw new Error('Server returned error');
        }
    } catch (e) {
        adminExamsList = safeLocalGet('examTimetables', []) || [];
    }

    let filtered = adminExamsList;
    if (classFilter) filtered = filtered.filter(e => e.class === classFilter);
    if (search) {
        filtered = filtered.filter(e =>
            (e.subject || '').toLowerCase().includes(search) ||
            (e.title || '').toLowerCase().includes(search) ||
            (e.hall || '').toLowerCase().includes(search) ||
            (e.chiefInvigilator || '').toLowerCase().includes(search)
        );
    }

    if (countEl) countEl.textContent = `${filtered.length} examination${filtered.length === 1 ? '' : 's'} scheduled`;

    if (!filtered || filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:36px 20px; color:var(--text-secondary);">
                    <i class="fas fa-clipboard-list" style="font-size:32px; color:var(--border); margin-bottom:10px; display:block;"></i>
                    <div style="font-size:14.5px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">No examinations scheduled yet</div>
                    <div style="font-size:13px; margin-bottom:14px;">Create your first official examination schedule paper for any class.</div>
                    <button type="button" class="btn-admin btn-primary btn-sm" onclick="openAdminAddExamModal()">
                        <i class="fas fa-plus"></i> Schedule New Exam
                    </button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(exam => `
        <tr>
            <td style="font-weight:600; color:var(--primary);">${escHtml(exam.subject || '—')}</td>
            <td><strong style="color:var(--text-primary); font-size:13px;">${escHtml(exam.title || 'Official Exam Paper')}</strong></td>
            <td><span class="badge badge-verified">${escHtml(exam.class || 'All Classes')}</span></td>
            <td>
                <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${exam.examDate ? new Date(exam.examDate).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : '—'}</div>
                <div style="font-size:11.5px; color:var(--text-secondary);">${escHtml(exam.startTime || '')} - ${escHtml(exam.endTime || '')}</div>
            </td>
            <td><i class="fas fa-map-marker-alt" style="color:#059669; margin-right:4px;"></i> ${escHtml(exam.hall || 'Main Hall')}</td>
            <td>
                <div style="font-size:12.5px; font-weight:600;">Chief: ${escHtml(exam.chiefInvigilator || 'TBD')}</div>
                ${exam.assistantInvigilator ? `<div style="font-size:11.5px; color:var(--text-secondary);">Asst: ${escHtml(exam.assistantInvigilator)}</div>` : ''}
            </td>
            <td>
                <span class="badge ${exam.status === 'Completed' ? 'badge-verified' : exam.status === 'In Progress' ? 'badge-pending' : 'badge-verified'}">
                    ${escHtml(exam.status || 'Scheduled')}
                </span>
            </td>
            <td style="text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:6px;">
                    <button type="button" class="btn-admin btn-ghost btn-sm" onclick="openAdminAddExamModal('${exam.id}')" title="Edit Exam Paper">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="btn-admin btn-ghost btn-sm" style="color:#ef4444;" onclick="deleteAdminExam('${exam.id}')" title="Delete Exam Paper">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openAdminAddExamModal(examId) {
    const modal = document.getElementById('adminExamModal');
    const titleEl = document.getElementById('adminExamModalTitle');
    const idInput = document.getElementById('aem-id');
    const classSelect = document.getElementById('aem-class');
    const subjectSelect = document.getElementById('aem-subject');
    const titleInput = document.getElementById('aem-title');
    const dateInput = document.getElementById('aem-date');
    const termSelect = document.getElementById('aem-term');
    const startTimeInput = document.getElementById('aem-startTime');
    const endTimeInput = document.getElementById('aem-endTime');
    const hallInput = document.getElementById('aem-hall');
    const chiefSelect = document.getElementById('aem-chiefInvigilator');
    const asstSelect = document.getElementById('aem-assistantInvigilator');
    const statusSelect = document.getElementById('aem-status');

    if (!modal) return;

    // Populate dropdowns
    populateAdminTtClassDropdown();

    let subjects = (adminState.subjects || []).filter(s => !s.isDeleted && s.status !== 'inactive');
    if (!subjects.length) {
        const localSub = safeLocalGet('subjects', []);
        subjects = (Array.isArray(localSub) ? localSub : []).filter(s => !s.isDeleted && s.status !== 'inactive');
    }
    if (subjectSelect) {
        subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>' +
            subjects.map(s => `<option value="${escHtml(s.name || s.id)}">${escHtml(s.name || s.id)}</option>`).join('');
    }

    let teachers = (adminState.teachers || []).filter(t => !t.isDeleted && t.status !== 'inactive');
    if (!teachers.length) {
        const localTeach = safeLocalGet('teachers', []);
        teachers = (Array.isArray(localTeach) ? localTeach : []).filter(t => !t.isDeleted && t.status !== 'inactive');
    }
    const teacherOpts = '<option value="">-- Select Staff --</option>' +
        teachers.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');

    if (chiefSelect) chiefSelect.innerHTML = teacherOpts;
    if (asstSelect) asstSelect.innerHTML = teacherOpts;

    if (examId) {
        const exam = adminExamsList.find(e => e.id === examId);
        if (!exam) return;
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-edit"></i> Edit Examination Paper';
        idInput.value = exam.id;
        if (classSelect) classSelect.value = exam.class || '';
        if (subjectSelect) subjectSelect.value = exam.subject || '';
        if (titleInput) titleInput.value = exam.title || '';
        if (dateInput) dateInput.value = exam.examDate || '';
        if (termSelect) termSelect.value = exam.term || '1';
        if (startTimeInput) startTimeInput.value = exam.startTime || '09:00';
        if (endTimeInput) endTimeInput.value = exam.endTime || '11:00';
        if (hallInput) hallInput.value = exam.hall || '';
        if (chiefSelect) chiefSelect.value = exam.chiefInvigilator || '';
        if (asstSelect) asstSelect.value = exam.assistantInvigilator || '';
        if (statusSelect) statusSelect.value = exam.status || 'Scheduled';
    } else {
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-clipboard-check"></i> Schedule Examination Paper';
        idInput.value = '';
        if (classSelect) classSelect.value = document.getElementById('adminTtClassSelect')?.value || '';
        if (subjectSelect) subjectSelect.value = '';
        if (titleInput) titleInput.value = '';
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
        if (termSelect) termSelect.value = '1';
        if (startTimeInput) startTimeInput.value = '09:00';
        if (endTimeInput) endTimeInput.value = '11:00';
        if (hallInput) hallInput.value = 'Main Assembly Hall';
        if (chiefSelect) chiefSelect.value = '';
        if (asstSelect) asstSelect.value = '';
        if (statusSelect) statusSelect.value = 'Scheduled';
    }

    modal.style.display = 'flex';
}

async function submitAdminExamForm() {
    const id = document.getElementById('aem-id')?.value;
    const cls = document.getElementById('aem-class')?.value;
    const subject = document.getElementById('aem-subject')?.value;
    const title = document.getElementById('aem-title')?.value;
    const examDate = document.getElementById('aem-date')?.value;
    const term = document.getElementById('aem-term')?.value;
    const startTime = document.getElementById('aem-startTime')?.value;
    const endTime = document.getElementById('aem-endTime')?.value;
    const hall = document.getElementById('aem-hall')?.value;
    const chiefInvigilator = document.getElementById('aem-chiefInvigilator')?.value;
    const assistantInvigilator = document.getElementById('aem-assistantInvigilator')?.value;
    const status = document.getElementById('aem-status')?.value || 'Scheduled';

    if (!cls || !subject || !title || !examDate || !startTime || !endTime || !hall) {
        showToast('Please complete all required examination fields (*).', 'warning');
        return;
    }

    const payload = {
        class: cls,
        subject,
        title,
        examDate,
        term,
        startTime,
        endTime,
        hall,
        chiefInvigilator,
        assistantInvigilator,
        status
    };

    try {
        let res;
        if (id) {
            res = await fetch(`/api/timetables/exams/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/timetables/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to save examination schedule');
        }

        const savedItem = await res.json();
        const localExams = safeLocalGet('examTimetables', []) || [];
        if (id) {
            const idx = localExams.findIndex(e => e.id === id);
            if (idx >= 0) localExams[idx] = savedItem;
            else localExams.push(savedItem);
        } else {
            localExams.push(savedItem);
        }
        localStorage.setItem('examTimetables', JSON.stringify(localExams));

        closeModal('adminExamModal');
        showToast(`Examination schedule for ${subject} (${cls}) saved!`, 'success');
        await renderAdminExamsTable();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function deleteAdminExam(id) {
    if (!confirm('Are you sure you want to delete this scheduled examination paper?')) return;
    try {
        const res = await fetch(`/api/timetables/exams/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error('Failed to delete examination paper');

        const localExams = safeLocalGet('examTimetables', []) || [];
        const updated = localExams.filter(e => e.id !== id);
        localStorage.setItem('examTimetables', JSON.stringify(updated));

        showToast('Examination schedule deleted.', 'info');
        await renderAdminExamsTable();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function downloadAdminExamsPDF() {
    const tableEl = document.getElementById('adminExamsTable');
    if (!tableEl || !adminExamsList.length) return showToast('No examination schedule found to export.', 'warning');

    const settings = adminState.settings || safeLocalGet('schoolSettings', {}) || {};
    const schoolName = settings.schoolName || 'OneReal Academy';
    const schoolMotto = settings.schoolMotto || 'Excellence in Education';
    const schoolPhone = settings.schoolPhone || '';

    const clone = tableEl.cloneNode(true);
    clone.querySelectorAll('th:last-child, td:last-child').forEach(el => el.remove());

    const contentHtml = `<!DOCTYPE html><html><head><title>Master Examination Schedule</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
            body { margin: 24px; font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #1e293b; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
            .header h1 { margin: 0 0 4px; font-size: 22px; color: #1e1b4b; text-transform: uppercase; font-weight: 800; }
            .header .motto { margin: 0 0 6px; font-size: 13px; color: #64748b; font-style: italic; }
            .header .doc-title { margin: 0; font-size: 15px; color: #7c3aed; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 9px 10px; text-align: left; }
            th { background: #1e1b4b; color: #ffffff; font-weight: 700; }
            @media print { body { margin: 0; } }
        </style>
    </head><body>
        <div class="header">
            <h1>${escHtml(schoolName)}</h1>
            <div class="motto">${escHtml(schoolMotto)}${schoolPhone ? ' · Tel: ' + escHtml(schoolPhone) : ''}</div>
            <div class="doc-title">Official Master Examination Timetable &amp; Invigilation Duties</div>
        </div>
        ${clone.outerHTML}
        <div style="margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 10px;">
            <span>Official Document — School Administration</span>
            <span>Generated: ${new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
        </div>
        <script>window.onload=function(){ window.print(); };<\/script>
    </body></html>`;

    const win = window.open('', '_blank', 'width=950,height=800');
    if (win) {
        win.document.write(contentHtml);
        win.document.close();
    } else {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        document.body.appendChild(frame);
        frame.contentDocument.write(contentHtml);
        frame.contentDocument.close();
        setTimeout(() => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => frame.remove(), 1000);
        }, 500);
    }
}

function exportAdminExamsExcel() {
    window.location.href = '/api/export/exams.xlsx';
}

function printAdminExams() {
    downloadAdminExamsPDF();
}

// ── TEACHER SCHEDULES & CLASH DETECTOR ──────────────────────────────────────
async function renderAdminTeacherSchedule() {
    const teacherSelect = document.getElementById('adminTtTeacherSelect');
    const teacherName = teacherSelect ? teacherSelect.value : '';
    const statsRow = document.getElementById('adminTeacherStatsRow');
    const content = document.getElementById('adminTeacherScheduleContent');
    const badge = document.getElementById('adminTtClashBadge');

    if (!content || !teacherName) {
        if (content) content.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary);">Select a teacher to inspect their weekly workload.</div>';
        return;
    }

    try {
        const res = await fetch(`/api/timetables/teacher/${encodeURIComponent(teacherName)}`);
        if (!res.ok) throw new Error('Failed to load teacher schedule');
        const data = await res.json();

        const weekly = data.weeklySchedule || { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
        const clashes = data.clashes || [];
        const invigilation = data.invigilationDuties || [];

        let totalPeriods = 0;
        const classesCovered = new Set();
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
            (weekly[d] || []).forEach(slot => {
                totalPeriods++;
                if (slot.class) classesCovered.add(slot.class);
            });
        });

        // Update badge
        if (badge) {
            if (clashes.length > 0) {
                badge.innerHTML = `<span class="badge badge-danger" style="font-size:12.5px; padding:4px 10px;"><i class="fas fa-exclamation-triangle"></i> ${clashes.length} Schedule Clash Detected!</span>`;
            } else {
                badge.innerHTML = `<span class="badge badge-verified" style="font-size:12.5px; padding:4px 10px;"><i class="fas fa-check-circle"></i> No Schedule Clashes Detected</span>`;
            }
        }

        // Stats row
        if (statsRow) {
            statsRow.innerHTML = `
                <div style="background:var(--surface-2); border:1px solid var(--border); padding:12px 14px; border-radius:8px;">
                    <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; font-weight:700;">Weekly Teaching Load</div>
                    <div style="font-size:20px; font-weight:700; color:var(--primary); margin-top:2px;">${totalPeriods} <span style="font-size:12px; font-weight:500; color:var(--text-secondary);">Periods / Week</span></div>
                </div>
                <div style="background:var(--surface-2); border:1px solid var(--border); padding:12px 14px; border-radius:8px;">
                    <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; font-weight:700;">Classes Covered</div>
                    <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-top:2px;">${classesCovered.size} <span style="font-size:12px; font-weight:500; color:var(--text-secondary);">Classes</span></div>
                </div>
                <div style="background:var(--surface-2); border:1px solid var(--border); padding:12px 14px; border-radius:8px;">
                    <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; font-weight:700;">Invigilations</div>
                    <div style="font-size:20px; font-weight:700; color:#059669; margin-top:2px;">${invigilation.length} <span style="font-size:12px; font-weight:500; color:var(--text-secondary);">Exam Slots</span></div>
                </div>
            `;
        }

        // Clash alerts
        let clashBanner = '';
        if (clashes.length > 0) {
            clashBanner = `
                <div style="background:rgba(220,38,38,0.08); border:1.5px solid rgba(220,38,38,0.3); border-radius:8px; padding:12px 16px; margin-bottom:16px;">
                    <div style="font-weight:700; color:#dc2626; font-size:13.5px; margin-bottom:4px;"><i class="fas fa-exclamation-triangle"></i> Timing Conflict Alert:</div>
                    <ul style="margin:0; padding-left:20px; font-size:13px; color:#b91c1c;">
                        ${clashes.map(c => `<li><strong>${c.day} Period ${c.period}:</strong> Double-assigned to <u>${escHtml(c.classA)} (${escHtml(c.subjectA)})</u> AND <u>${escHtml(c.classB)} (${escHtml(c.subjectB)})</u></li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Weekly breakdown
        let breakdownHtml = `
            ${clashBanner}
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
        `;

        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(day => {
            const slots = weekly[day] || [];
            slots.sort((a, b) => a.period - b.period);
            breakdownHtml += `
                <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:12px;">
                    <div style="font-weight:700; font-size:13px; color:var(--text-primary); margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:4px;">
                        ${day} (${slots.length} period${slots.length === 1 ? '' : 's'})
                    </div>
                    ${slots.length === 0 ? '<div style="font-size:12px; color:var(--text-secondary); font-style:italic;">No teaching periods</div>' : ''}
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${slots.map(s => `
                            <div style="background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 8px; font-size:12px;">
                                <div style="font-weight:700; color:var(--primary);">Period ${s.period} · ${escHtml(s.subject)}</div>
                                <div style="font-size:11px; color:var(--text-secondary); display:flex; justify-content:space-between; margin-top:2px;">
                                    <span>${escHtml(s.class)}</span>
                                    <span>${escHtml(s.room || '')}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        breakdownHtml += `</div>`;

        // Invigilation list
        if (invigilation.length > 0) {
            breakdownHtml += `
                <div style="margin-top:18px;">
                    <h4 style="font-size:14px; margin-bottom:8px; color:var(--text-primary);"><i class="fas fa-user-shield" style="color:#059669;"></i> Assigned Invigilation Duties</h4>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">
                        ${invigilation.map(e => `
                            <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:10px 12px; font-size:12px;">
                                <div style="font-weight:700; color:var(--text-primary); font-size:13px;">${escHtml(e.subject)} · ${escHtml(e.title || 'Exam')}</div>
                                <div style="color:var(--text-secondary); margin-top:2px;">Class: <strong>${escHtml(e.class)}</strong> | Date: <strong>${e.examDate || '—'}</strong> (${escHtml(e.startTime || '')} - ${escHtml(e.endTime || '')})</div>
                                <div style="color:#059669; font-size:11.5px; margin-top:4px;"><i class="fas fa-map-marker-alt"></i> Hall: ${escHtml(e.hall || 'Main Hall')}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        content.innerHTML = breakdownHtml;

    } catch (e) {
        content.innerHTML = `<div style="padding:20px; color:#ef4444;">Error loading teacher schedule: ${e.message}</div>`;
    }
}


