// ============================================================================
// OneReal School Admin Dashboard — admin.js
// ============================================================================

'use strict';

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
    users:         [],
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
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();

    const openLocalAdmin = () => {
        const unlocked = sessionStorage.getItem('adminUnlocked') === 'true';
        if (unlocked) {
            hideAuthOverlay();
            initAdminApp();
        } else {
            showAuthOverlay();
        }
    };

    if (typeof firebase !== 'undefined' && firebase.auth && isFirebaseActive) {
        firebase.auth().onAuthStateChanged(async (user) => {
            if (user) {
                try { await loadUserProfile(user.uid); } catch (e) {}
                const role = getCurrentUserRole();
                if (role && !['Super Admin','Administrator','Headteacher','Guest'].includes(role)) {
                    // Teachers stay out of admin. Guest means no profile yet — allow if locally unlocked.
                    if (['Teacher','Class Teacher'].includes(role)) {
                        showAdminOverlay('You do not have admin access. Contact your system administrator.');
                        return;
                    }
                }
                hideAuthOverlay();
                await initAdminApp();
                return;
            }
            openLocalAdmin();
        });
    } else {
        openLocalAdmin();
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

async function handleAdminLogin() {
    const email    = document.getElementById('adminEmail')?.value?.trim() || '';
    const password = document.getElementById('adminPassword')?.value || '';
    const errorEl  = document.getElementById('adminAuthError');
    const btn      = document.getElementById('adminLoginBtn');

    if (errorEl) errorEl.style.display = 'none';

    const localAdminOk = password === 'admin123' || password === 'admin';

    async function enterLocalAdmin() {
        sessionStorage.setItem('adminUnlocked', 'true');
        sessionStorage.setItem('adminEmail', email || 'admin@school.com');
        hideAuthOverlay();
        await initAdminApp();
    }

    // School local passcode always works, even after Firebase is connected.
    if (localAdminOk) {
        await enterLocalAdmin();
        return;
    }

    if (!email || !password) {
        if (errorEl) { errorEl.textContent = 'Please enter email and password. Local admin password is admin123.'; errorEl.style.display = 'block'; }
        return;
    }

    const btnText   = btn?.querySelector('.btn-text');
    const btnLoader = btn?.querySelector('.btn-loader');
    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'inline-flex';
    if (btn) btn.disabled = true;

    try {
        if (isFirebaseActive && typeof loginFirebaseUser === 'function') {
            await loginFirebaseUser(email, password);
            return;
        }
        if (errorEl) { errorEl.textContent = 'Use password admin123, or create a Firebase account first.'; errorEl.style.display = 'block'; }
    } catch (e) {
        const code = e.code || '';
        if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
            if (errorEl) {
                errorEl.textContent = 'That email is not in Firebase yet. Use password admin123 to open Admin, then click Create Auth accounts.';
                errorEl.style.display = 'block';
            }
            return;
        }
        const msg = code === 'auth/invalid-email' ? 'Invalid email address.' :
                    code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.' :
                    `Login failed: ${e.message}`;
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    } finally {
        if (btnText) btnText.style.display = 'inline-flex';
        if (btnLoader) btnLoader.style.display = 'none';
        if (btn) btn.disabled = false;
    }
}

async function handleAdminLogout() {
    await logoutFirebaseUser();
    sessionStorage.removeItem('adminUnlocked');
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

async function loadAllData(opts = {}) {
    const refreshForms = opts.refreshForms !== false;
    try {
        const [students, teachers, classes, subjects, academicYears,
               terms, results, reports, users, gradingScales] = await Promise.all([
            safeGetCollection('students'),
            safeGetCollection('teachers'),
            safeGetCollection('classes'),
            safeGetCollection('subjects'),
            safeGetCollection('academicYears'),
            safeGetCollection('terms'),
            safeGetCollection('results'),
            safeGetCollection('reports'),
            safeGetCollection('users'),
            safeGetCollection('gradingScales'),
        ]);

        adminState.students      = students;
        adminState.teachers      = teachers;
        adminState.classes       = classes;
        adminState.subjects      = subjects;
        adminState.academicYears = academicYears;
        adminState.terms         = terms;
        adminState.results       = results;
        adminState.reports       = reports;
        adminState.users         = users;
        adminState.gradingScales = gradingScales;
        adminState.auditLogs     = JSON.parse(localStorage.getItem('auditLogs') || '[]');

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
        if (isFirebaseActive) {
            return await getCollection(name);
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
        'settings':'School Settings','users':'Users & Roles',
        'attendance':'Attendance',
        'audit-logs':'Activity Logs','data-management':'Data Management'
    };
    const bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = `<span>${labels[sectionId] || sectionId}</span>`;

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
        case 'users':          renderUsersTable(); break;
        case 'audit-logs':     renderAuditLogs(); break;
        case 'data-management':renderDataManagement(); break;
        case 'attendance':     renderAttendanceSection(); break;
        case 'settings':       loadSettingsForm(); break;
    }

    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop')?.classList.remove('show');
    document.body.classList.remove('nav-open');
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
        sidebar.classList.toggle('collapsed');
    }
}

function updateNavBadges() {
    const studBadge = document.getElementById('nav-badge-students');
    if (studBadge) studBadge.textContent = adminState.students.length;

    const pendingResults = adminState.results.filter(r => r.status === 'Submitted').length;
    const pendingReports = adminState.reports.filter(r => !['approved','published'].includes(String(r.status||'').toLowerCase())).length;
    const resBadge = document.getElementById('nav-badge-results');
    if (resBadge) {
        resBadge.textContent = pendingResults;
        resBadge.style.display = pendingResults > 0 ? 'inline-flex' : 'none';
    }

    const notifCount = document.getElementById('notificationCount');
    if (notifCount) {
        const total = pendingResults + pendingReports;
        notifCount.textContent = total;
        notifCount.style.display = total > 0 ? 'flex' : 'none';
    }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard() {
    const activeYear = adminState.academicYears.find(y => y.isActive);
    const activeTerm = adminState.terms.find(t => t.isActive);
    const pendingResults = adminState.results.filter(r => r.status === 'Submitted').length;

    setKPI('kpi-students', adminState.students.filter(s => s.status !== 'inactive').length);
    setKPI('kpi-teachers', adminState.teachers.filter(t => t.status !== 'inactive').length);
    setKPI('kpi-classes',  adminState.classes.filter(c => c.status !== 'inactive').length);
    setKPI('kpi-subjects', adminState.subjects.filter(s => s.status !== 'inactive').length);
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

    // Class form — teacher options
    populateSelect('cm-classTeacher', adminState.teachers, 'id', 'name', 'None');

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

    let data = adminState.students;
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
    if (countEl) countEl.textContent = `${total} students`;

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
        if (id) {
            await updateDocument('students', id, data);
            const idx = adminState.students.findIndex(s => s.id === id);
            if (idx >= 0) adminState.students[idx] = { ...adminState.students[idx], ...data };
            showToast('Student updated!', 'success');
            await logActivity('Student Updated', `Updated student ${name}`, id);
        } else {
            const newDoc = await addDocument('students', data);
            adminState.students.push(newDoc);
            showToast('Student added!', 'success');
            await logActivity('Student Added', `Added student ${name}`, newDoc.id);
        }
        closeModal('studentModal');
        renderStudentsTable();
        updateNavBadges();
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

    let data = adminState.teachers;
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
            <td>${(t.assignedClasses || []).map(c => resolveClass(c)).join(', ') || '—'}</td>
            <td>${(t.assignedSubjects || []).map(s => resolveSubject(s)).join(', ') || '—'}</td>
            <td><span class="status-pill ${t.status || 'active'}">${t.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" title="Edit Teacher" onclick="openTeacherModal('${t.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn" title="Send Password Reset Email" onclick="sendTeacherPasswordReset('${t.email}')"><i class="fas fa-key"></i></button>
                    <button class="action-btn ${t.status === 'inactive' ? 'success' : 'warning'}" title="${t.status === 'inactive' ? 'Activate Account' : 'Deactivate Account'}" onclick="toggleTeacherStatus('${t.id}')">
                        <i class="fas ${t.status === 'inactive' ? 'fa-user-check' : 'fa-user-slash'}"></i>
                    </button>
                    <button class="action-btn delete" title="Delete Teacher" onclick="confirmDeleteTeacher('${t.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`).join('') : emptyRow(8, 'No teachers found');

    const countEl = document.getElementById('teachersCount');
    if (countEl) countEl.textContent = `${data.length} teachers`;
}

function openTeacherModal(id = null) {
    adminState.editingTeacher = id;
    const modal = document.getElementById('teacherModal');
    const title = document.getElementById('teacherModalTitle');
    if (!modal) return;

    ['tm-name','tm-email','tm-phone','tm-password'].forEach(fId => {
        const el = document.getElementById(fId);
        if (el) el.value = '';
    });
    document.getElementById('tm-id').value = '';
    document.getElementById('tm-role').value = 'Teacher';
    document.getElementById('tm-status').value = 'active';

    renderCheckboxes('tm-classes-checkboxes',  adminState.classes,  'id', 'name');
    renderCheckboxes('tm-subjects-checkboxes', adminState.subjects, 'id', 'name');

    const pwSection = document.getElementById('tm-password-section');

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
            if (pwSection) pwSection.style.display = 'none';
            renderCheckboxes('tm-classes-checkboxes',  adminState.classes,  'id', 'name', t.assignedClasses  || []);
            renderCheckboxes('tm-subjects-checkboxes', adminState.subjects, 'id', 'name', t.assignedSubjects || []);
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Add Teacher';
        if (pwSection) pwSection.style.display = 'block';
    }

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
    const assignedClasses  = getCheckedValues('tm-classes-checkboxes');
    const assignedSubjects = getCheckedValues('tm-subjects-checkboxes');

    if (!name || !email) { showToast('Name and email are required.', 'error'); return; }

    const teacherData = { name, email, phone, role, status, assignedClasses, assignedSubjects };

    try {
        if (!id) {
            // Create Firebase Auth user for teacher
            if (isFirebaseActive && password) {
                const creds = await registerFirebaseUser(email, password, name, role);
                teacherData.userId = creds.user.uid;
            }
            const newDoc = await addDocument('teachers', teacherData);
            adminState.teachers.push(newDoc);
            showToast('Teacher added!', 'success');
            await logActivity('Teacher Added', `Added teacher ${name}`, newDoc.id);
        } else {
            await updateDocument('teachers', id, teacherData);
            // Update the user profile too
            const t = adminState.teachers.find(t => t.id === id);
            if (t?.userId && isFirebaseActive) {
                await updateDocument('users', t.userId, { displayName: name, role, assignedClasses, assignedSubjects, status });
            }
            const idx = adminState.teachers.findIndex(t => t.id === id);
            if (idx >= 0) adminState.teachers[idx] = { ...adminState.teachers[idx], ...teacherData };
            showToast('Teacher updated!', 'success');
            await logActivity('Teacher Updated', `Updated teacher ${name}`, id);
        }
        const teacherId = id || adminState.teachers.find(t => t.email === email)?.id;
        if (teacherId) {
            adminState.classes.forEach(c => {
                if (String(c.classTeacherId) === String(teacherId)) c.classTeacherName = name;
            });
            for (const c of adminState.classes.filter(c => String(c.classTeacherId) === String(teacherId))) {
                try { await updateDocument('classes', c.id, { classTeacherName: name }); } catch (e) {}
            }
            localStorage.setItem('classes', JSON.stringify(adminState.classes));
        }
        if (role === 'Headteacher' && status !== 'inactive') {
            const settings = { ...(adminState.settings || {}), headTeacher: name };
            adminState.settings = settings;
            try { await saveSchoolSettings(settings); } catch (e) {}
            persistSchoolInfoPatch({ headTeacher: name });
        }
        closeModal('teacherModal');
        renderTeachersTable();
        renderClassesTable();
        renderClassTeacherMap();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function sendTeacherPasswordReset(email) {
    if (!email) { showToast('No email associated with this teacher.', 'error'); return; }
    try {
        await resetPassword(email);
        showToast(`Password reset link sent to ${email}`, 'success');
        await logActivity('Teacher Password Reset Sent', `Sent password reset to ${email}`);
    } catch (e) {
        showToast(`Error sending password reset: ${e.message}`, 'error');
    }
}

async function toggleTeacherStatus(id) {
    const t = adminState.teachers.find(t => t.id === id);
    if (!t) return;
    const newStatus = t.status === 'inactive' ? 'active' : 'inactive';
    await updateDocument('teachers', id, { status: newStatus });
    t.status = newStatus;
    renderTeachersTable();
    showToast(`Teacher ${newStatus}.`, 'success');
    await logActivity('Teacher Status Changed', `Set teacher ${t.name} to ${newStatus}`, id);
}

async function confirmDeleteTeacher(id) {
    const t = adminState.teachers.find(t => t.id === id);
    showConfirm(`Delete teacher "${t?.name}"?`, async () => {
        await deleteDocument('teachers', id);
        adminState.teachers = adminState.teachers.filter(t => t.id !== id);
        renderTeachersTable();
        showToast('Teacher deleted.', 'success');
        await logActivity('Teacher Deleted', `Deleted teacher ${t?.name}`, id);
    });
}

// ─── CLASSES ─────────────────────────────────────────────────────────────────
function renderClassesTable() {
    const tbody = document.getElementById('classesTableBody');
    if (!tbody) return;
    tbody.innerHTML = adminState.classes.length ? adminState.classes.map((c, i) => {
        const teacher  = adminState.teachers.find(t => t.id === c.classTeacherId);
        const students = adminState.students.filter(s => s.classId === c.id || s.class === c.name).length;
        const level    = c.level || (c.name.toLowerCase().includes('jhs') ? 'JHS' : 'Primary');
        const scaleName= c.gradingScaleId ? (c.gradingScaleId.includes('bece') ? 'BECE Scale' : c.gradingScaleId.includes('letter') ? 'Standard Letter' : 'Ghana Primary') : (level === 'JHS' ? 'BECE Scale (Default)' : 'Ghana Primary (Default)');

        return `<tr>
            <td>${i + 1}</td>
            <td><strong>${escHtml(c.name)}</strong></td>
            <td><span class="status-pill ${level === 'JHS' ? 'published' : 'active'}">${escHtml(level)}</span></td>
            <td>${escHtml(scaleName)}</td>
            <td>${escHtml(teacher?.name || '—')}</td>
            <td>${students}</td>
            <td><span class="status-pill ${c.status || 'active'}">${c.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" onclick="openClassModal('${c.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteClass('${c.id}')"><i class="fas fa-trash"></i></button>
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
    const gsEl = document.getElementById('cm-gradingScale');
    if (gsEl) gsEl.value = '';
    document.getElementById('cm-status').value = 'active';
    populateSelect('cm-classTeacher', adminState.teachers, 'id', 'name', 'None');

    if (id) {
        const c = adminState.classes.find(c => c.id === id);
        if (c) {
            document.getElementById('classModalTitle').innerHTML = '<i class="fas fa-school"></i> Edit Class';
            document.getElementById('cm-id').value            = c.id;
            document.getElementById('cm-name').value          = c.name || '';
            document.getElementById('cm-level').value         = c.level || 'Primary';
            if (gsEl) gsEl.value                               = c.gradingScaleId || '';
            document.getElementById('cm-classTeacher').value  = c.classTeacherId || '';
            document.getElementById('cm-status').value        = c.status || 'active';
        }
    } else {
        document.getElementById('classModalTitle').innerHTML = '<i class="fas fa-school"></i> Add Class';
    }
    modal.style.display = 'flex';
}

async function saveClass() {
    const id            = document.getElementById('cm-id')?.value || null;
    const name          = document.getElementById('cm-name')?.value?.trim() || '';
    const level         = document.getElementById('cm-level')?.value || 'Primary';
    const gradingScaleId= document.getElementById('cm-gradingScale')?.value || '';
    const classTeacherId= document.getElementById('cm-classTeacher')?.value || '';
    const status        = document.getElementById('cm-status')?.value || 'active';

    if (!name) { showToast('Class name is required.', 'error'); return; }

    const teacher = adminState.teachers.find(t => String(t.id) === String(classTeacherId));
    const data = { name, level, gradingScaleId, classTeacherId, classTeacherName: teacher?.name || '', status };
    try {
        if (id) {
            await updateDocument('classes', id, data);
            const idx = adminState.classes.findIndex(c => c.id === id);
            if (idx >= 0) adminState.classes[idx] = { ...adminState.classes[idx], ...data };
            showToast('Class updated!', 'success');
            await logActivity('Class Updated', `Updated ${name}` + (teacher ? ` — class teacher ${teacher.name}` : ''), id);
        } else {
            const newDoc = await addDocument('classes', data);
            adminState.classes.push(newDoc);
            showToast('Class added!', 'success');
            await logActivity('Class Added', `Created class ${name}`, newDoc.id);
        }
        if (teacher && id) {
            const assigned = new Set(teacher.assignedClasses || []);
            assigned.add(id);
            teacher.assignedClasses = Array.from(assigned);
            try { await updateDocument('teachers', teacher.id, { assignedClasses: teacher.assignedClasses }); } catch (e) {}
        }
        closeModal('classModal');
        renderClassesTable();
        renderClassTeacherMap();
        populateAllDropdowns();
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
    renderCheckboxes('subm-classes-checkboxes', adminState.classes, 'id', 'name');

    if (id) {
        const s = adminState.subjects.find(s => s.id === id);
        if (s) {
            document.getElementById('subjectModalTitle').innerHTML = '<i class="fas fa-book-open"></i> Edit Subject';
            document.getElementById('subm-id').value     = s.id;
            document.getElementById('subm-code').value   = s.code || '';
            document.getElementById('subm-name').value   = s.name || '';
            document.getElementById('subm-status').value = s.status || 'active';
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
    const classIds = getCheckedValues('subm-classes-checkboxes');

    if (!name) { showToast('Subject name is required.', 'error'); return; }

    const data = { code, name, status, classIds };
    try {
        if (id) {
            await updateDocument('subjects', id, data);
            const idx = adminState.subjects.findIndex(s => s.id === id);
            if (idx >= 0) adminState.subjects[idx] = { ...adminState.subjects[idx], ...data };
            showToast('Subject updated!', 'success');
        } else {
            const newDoc = await addDocument('subjects', data);
            adminState.subjects.push(newDoc);
            showToast('Subject added!', 'success');
            await logActivity('Subject Added', `Created subject ${name}`, newDoc.id);
        }
        closeModal('subjectModal');
        renderSubjectsTable();
        populateAllDropdowns();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function confirmDeleteSubject(id) {
    const s = adminState.subjects.find(s => s.id === id);
    showConfirm(`Delete subject "${s?.name}"?`, async () => {
        await deleteDocument('subjects', id);
        adminState.subjects = adminState.subjects.filter(s => s.id !== id);
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
            // Deactivate all other years
            for (const y of adminState.academicYears) {
                if (y.isActive) await updateDocument('academicYears', y.id, { isActive: false });
            }
            adminState.academicYears.forEach(y => { y.isActive = false; });
            // Deactivate all other terms
            for (const t of adminState.terms) {
                if (t.isActive) await updateDocument('terms', t.id, { isActive: false });
            }
            adminState.terms.forEach(t => { t.isActive = false; });
        }

        const yearDoc = await addDocument('academicYears', { name, isActive: setActive, isArchived: false });
        adminState.academicYears.push(yearDoc);

        // Create terms
        for (let i = 0; i < termNames.length; i++) {
            const isFirstTerm = i === 0 && setActive;
            const termDoc = await addDocument('terms', {
                name:      termNames[i],
                yearId:    yearDoc.id,
                termNumber: i + 1,
                isActive:  isFirstTerm,
                isClosed:  false
            });
            adminState.terms.push(termDoc);
        }

        showToast(`Academic year "${name}" created!`, 'success');
        await logActivity('Academic Year Created', `Created year ${name}`, yearDoc.id);
        closeModal('academicYearModal');
        renderAcademicYears();
        populateAllDropdowns();
        setKPI('kpi-year', setActive ? name : document.getElementById('kpi-year')?.textContent);
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function setActiveYear(id) {
    for (const y of adminState.academicYears) {
        if (y.isActive) await updateDocument('academicYears', y.id, { isActive: false });
    }
    await updateDocument('academicYears', id, { isActive: true });
    adminState.academicYears.forEach(y => { y.isActive = y.id === id; });
    const year = adminState.academicYears.find(y => y.id === id);
    persistSchoolInfoPatch({ academicYear: year?.name || '' });
    renderAcademicYears();
    showToast('Active academic year updated!', 'success');
    await logActivity('Active Year Set', `Set academic year active`, id);
    loadDashboard();
}

async function setActiveTerm(termId, yearId) {
    for (const t of adminState.terms) {
        if (t.isActive) await updateDocument('terms', t.id, { isActive: false });
    }
    await updateDocument('terms', termId, { isActive: true });
    adminState.terms.forEach(t => { t.isActive = t.id === termId; });
    renderAcademicYears();
    showToast('Active term updated!', 'success');
    await logActivity('Active Term Set', `Set active term`, termId);
    loadDashboard();
}

async function closeTerm(termId) {
    showConfirm('Close this term? School days on reports will be weekdays only (weekends excluded). Results for the term will lock.', async () => {
        const today = (typeof Attendance !== 'undefined' && Attendance.todayISO()) || new Date().toISOString().slice(0, 10);
        await updateDocument('terms', termId, { isActive: false, isClosed: true, endDate: today });
        const t = adminState.terms.find(t => t.id === termId);
        if (t) { t.isActive = false; t.isClosed = true; t.endDate = today; }
        let days = 0;
        if (typeof Attendance !== 'undefined') {
            days = Attendance.finalizeClosedTerm(today);
        }
        renderAcademicYears();
        showToast(days ? `Term closed. Report attendance is now days present out of ${days} school days (weekends excluded).` : 'Term closed.', 'success');
        await logActivity('Term Closed', `Closed term — ${days} weekday school days`, termId);
    });
}

async function confirmDeleteYear(id) {
    const y = adminState.academicYears.find(y => y.id === id);
    showConfirm(`Delete academic year "${y?.name}"? All associated terms will also be deleted.`, async () => {
        await deleteDocument('academicYears', id);
        adminState.academicYears = adminState.academicYears.filter(y => y.id !== id);
        const termIds = adminState.terms.filter(t => t.yearId === id).map(t => t.id);
        for (const tid of termIds) await deleteDocument('terms', tid);
        adminState.terms = adminState.terms.filter(t => t.yearId !== id);
        renderAcademicYears();
        showToast('Academic year deleted.', 'success');
    });
}

// ─── GRADING SYSTEM ───────────────────────────────────────────────────────────
function renderGradingScales() {
    const container = document.getElementById('gradingScalesContainer');
    if (!container) return;

    if (!adminState.gradingScales.length) {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-star-half-alt"></i><p>No grading scales configured. Create one to get started.</p></div>';
        return;
    }

    container.innerHTML = adminState.gradingScales.map(scale => `
        <div class="scale-card ${scale.isActive ? 'active-scale' : ''}">
            <div class="scale-card-header">
                <div class="scale-name">${escHtml(scale.name)}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                    ${scale.isActive ? '<span class="scale-active-badge">Active</span>' : `<button class="btn-admin btn-primary btn-sm" onclick="setActiveGradingScale('${scale.id}')">Set Active</button>`}
                    <button class="action-btn" onclick="openGradingScaleModal('${scale.id}')"><i class="fas fa-edit"></i></button>
                    <button class="action-btn delete" onclick="confirmDeleteGradingScale('${scale.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <table class="scale-table">
                <thead><tr><th>Min</th><th>Max</th><th>Grade</th><th>Remark</th><th>Description</th></tr></thead>
                <tbody>
                    ${(scale.items || []).map(item => `<tr>
                        <td>${item.min}</td><td>${item.max}</td>
                        <td><strong>${escHtml(item.grade)}</strong></td>
                        <td>${escHtml(item.remark)}</td>
                        <td>${escHtml(item.description || '')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`).join('');
}

function openGradingScaleModal(id = null) {
    adminState.editingGrading = id;
    document.getElementById('gs-id').value = '';
    document.getElementById('gs-name').value = '';
    document.getElementById('gs-isActive').checked = false;

    const defaultRows = [
        { min: 80, max: 100, grade: 'A',  remark: 'ADVANCE', description: '' },
        { min: 68, max: 79,  grade: 'P',  remark: 'PROFICIENCY', description: '' },
        { min: 54, max: 67,  grade: 'AP', remark: 'APPROACHING PROFICIENCY', description: '' },
        { min: 40, max: 53,  grade: 'D',  remark: 'DEVELOPING', description: '' },
        { min: 0,  max: 39,  grade: 'B',  remark: 'BEGINNER', description: '' },
    ];

    let rows = defaultRows;
    if (id) {
        const scale = adminState.gradingScales.find(s => s.id === id);
        if (scale) {
            document.getElementById('gs-id').value = scale.id;
            document.getElementById('gs-name').value = scale.name || '';
            document.getElementById('gs-isActive').checked = scale.isActive || false;
            rows = scale.items || defaultRows;
        }
    }

    renderGradeRows(rows);
    document.getElementById('gradingScaleModal').style.display = 'flex';
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
    const id       = document.getElementById('gs-id')?.value || null;
    const name     = document.getElementById('gs-name')?.value?.trim() || '';
    const isActive = document.getElementById('gs-isActive')?.checked || false;

    if (!name) { showToast('Grading scale name is required.', 'error'); return; }

    const rows = Array.from(document.querySelectorAll('.grade-row')).map(row => ({
        min:         parseFloat(row.querySelector('.grade-min')?.value) || 0,
        max:         parseFloat(row.querySelector('.grade-max')?.value) || 0,
        grade:       row.querySelector('.grade-grade')?.value?.trim() || '',
        remark:      row.querySelector('.grade-remark')?.value?.trim() || '',
        description: row.querySelector('.grade-description')?.value?.trim() || '',
    })).filter(r => r.grade);

    try {
        if (isActive) {
            for (const s of adminState.gradingScales) {
                if (s.isActive) await updateDocument('gradingScales', s.id, { isActive: false });
            }
            adminState.gradingScales.forEach(s => { s.isActive = false; });
        }

        const data = { name, isActive, items: rows };
        if (id) {
            await updateDocument('gradingScales', id, data);
            const idx = adminState.gradingScales.findIndex(s => s.id === id);
            if (idx >= 0) adminState.gradingScales[idx] = { ...adminState.gradingScales[idx], ...data };
            showToast('Grading scale updated!', 'success');
        } else {
            const newDoc = await addDocument('gradingScales', data);
            adminState.gradingScales.push(newDoc);
            showToast('Grading scale created!', 'success');
            await logActivity('Grading Scale Created', `Created scale ${name}`, newDoc.id);
        }

        if (isActive) {
            localStorage.setItem('activeGradingScale', JSON.stringify(rows));
        }

        closeModal('gradingScaleModal');
        renderGradingScales();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function setActiveGradingScale(id) {
    for (const s of adminState.gradingScales) {
        await updateDocument('gradingScales', s.id, { isActive: s.id === id });
        s.isActive = s.id === id;
    }
    const active = adminState.gradingScales.find(s => s.id === id);
    if (active) localStorage.setItem('activeGradingScale', JSON.stringify(active.items || []));
    renderGradingScales();
    showToast('Grading scale activated!', 'success');
}

async function confirmDeleteGradingScale(id) {
    const s = adminState.gradingScales.find(s => s.id === id);
    showConfirm(`Delete grading scale "${s?.name}"?`, async () => {
        await deleteDocument('gradingScales', id);
        adminState.gradingScales = adminState.gradingScales.filter(s => s.id !== id);
        renderGradingScales();
        showToast('Grading scale deleted.', 'success');
    });
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function renderResultsTable() {
    const yearF    = document.getElementById('resultsFilterYear')?.value   || '';
    const termF    = document.getElementById('resultsFilterTerm')?.value   || '';
    const classF   = document.getElementById('resultsFilterClass')?.value  || '';
    const statusF  = document.getElementById('resultsFilterStatus')?.value || '';
    const search   = (document.getElementById('resultsFilterSearch')?.value || '').toLowerCase();

    let data = adminState.results;
    if (yearF)   data = data.filter(r => r.academicYearId === yearF);
    if (termF)   data = data.filter(r => r.termId === termF);
    if (classF)  data = data.filter(r => r.classId === classF);
    if (statusF) data = data.filter(r => r.status === statusF);
    if (search)  data = data.filter(r => {
        const s = adminState.students.find(s => s.id === r.studentId);
        return (s?.name || '').toLowerCase().includes(search);
    });

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
        return `<tr>
            <td><input type="checkbox" class="result-checkbox" value="${r.id}" onchange="handleResultCheckbox()"></td>
            <td>${escHtml(student?.name || r.studentName || r.studentId || '—')}</td>
            <td>${escHtml(resolveClass(r.classId))}</td>
            <td>${escHtml(r.subjectId || '—')}</td>
            <td>${r.classScore ?? '—'}</td>
            <td>${r.examScore ?? '—'}</td>
            <td><strong>${r.totalScore ?? '—'}</strong></td>
            <td>${r.grade ?? '—'}</td>
            <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
            <td><span class="lock-badge ${locked}"><i class="fas fa-${locked === 'locked' ? 'lock' : 'lock-open'}"></i></span></td>
            <td>
                <div class="action-btns">
                    ${status === 'Submitted' && isHeadteacher() ? `<button class="action-btn success" title="Approve" onclick="approveResult('${r.id}')"><i class="fas fa-check"></i></button>` : ''}
                    ${r.locked && isAdmin() ? `<button class="action-btn warning" title="Unlock" onclick="unlockResult('${r.id}')"><i class="fas fa-unlock"></i></button>` : ''}
                    ${isAdmin() ? `<button class="action-btn delete" onclick="confirmDeleteResult('${r.id}')"><i class="fas fa-trash"></i></button>` : ''}
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
    const checked = document.querySelectorAll('.result-checkbox:checked').length;
    const bulkBar = document.getElementById('resultsBulkActions');
    const countEl = document.getElementById('selectedResultsCount');
    if (bulkBar) bulkBar.style.display = checked > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = `${checked} selected`;
}

function toggleSelectAllResults(cb) {
    document.querySelectorAll('.result-checkbox').forEach(c => { c.checked = cb.checked; });
    handleResultCheckbox();
}

function getSelectedResultIds() {
    return Array.from(document.querySelectorAll('.result-checkbox:checked')).map(c => c.value);
}

async function approveResult(id) {
    try {
        await approveResults([id], 'Approved');
        const r = adminState.results.find(r => r.id === id);
        if (r) { r.status = 'Approved'; r.locked = true; }
        renderResultsTable();
        showToast('Result approved and locked.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function unlockResult(id) {
    try {
        await unlockResults([id]);
        const r = adminState.results.find(r => r.id === id);
        if (r) { r.status = 'Reviewed'; r.locked = false; }
        renderResultsTable();
        showToast('Result unlocked for editing.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function bulkApproveResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return;
    showConfirm(`Approve ${ids.length} selected results?`, async () => {
        await approveResults(ids, 'Approved');
        ids.forEach(id => {
            const r = adminState.results.find(r => r.id === id);
            if (r) { r.status = 'Approved'; r.locked = true; }
        });
        renderResultsTable();
        showToast(`${ids.length} results approved.`, 'success');
    });
}

async function bulkUnlockResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return;
    showConfirm(`Unlock ${ids.length} results for editing?`, async () => {
        await unlockResults(ids);
        ids.forEach(id => {
            const r = adminState.results.find(r => r.id === id);
            if (r) { r.status = 'Reviewed'; r.locked = false; }
        });
        renderResultsTable();
        showToast(`${ids.length} results unlocked.`, 'success');
    });
}

async function bulkPublishResults() {
    const ids = getSelectedResultIds();
    if (!ids.length) return;
    showConfirm(`Publish ${ids.length} results?`, async () => {
        await approveResults(ids, 'Published');
        ids.forEach(id => {
            const r = adminState.results.find(r => r.id === id);
            if (r) { r.status = 'Published'; r.locked = true; }
        });
        renderResultsTable();
        showToast(`${ids.length} results published.`, 'success');
    });
}

async function confirmDeleteResult(id) {
    showConfirm('Delete this result?', async () => {
        await deleteDocument('results', id);
        adminState.results = adminState.results.filter(r => r.id !== id);
        renderResultsTable();
        showToast('Result deleted.', 'success');
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
    }).join('') : emptyRow(8, 'No reports found');

    const countEl = document.getElementById('reportsCount');
    if (countEl) countEl.textContent = `${data.length} reports`;
}

function persistReports() {
    localStorage.setItem('reports', JSON.stringify(adminState.reports));
}

async function approveReport(id) {
    const r = adminState.reports.find(x => String(x.id) === String(id));
    if (!r) { showToast('Report not found.', 'error'); return; }
    r.status = 'Approved';
    r.approvedAt = new Date().toISOString();
    persistReports();
    try { await updateDocument('reports', r.id, { status: 'Approved', approvedAt: r.approvedAt }); } catch (e) {}
    renderReportsTable();
    updateNavBadges();
    showToast(`Approved ${r.studentName || 'report'} — teachers can now download it.`, 'success');
    await logActivity('Report Approved', `Approved report for ${r.studentName || r.studentId}`, r.id);
}

async function revokeReportApproval(id) {
    const r = adminState.reports.find(x => String(x.id) === String(id));
    if (!r) return;
    r.status = 'Pending';
    persistReports();
    try { await updateDocument('reports', r.id, { status: 'Pending' }); } catch (e) {}
    renderReportsTable();
    updateNavBadges();
    showToast('Approval revoked. Download is locked again.', 'warning');
}

async function approveAllPendingReports() {
    const pending = adminState.reports.filter(r => !['approved','published'].includes(String(r.status||'').toLowerCase()));
    if (!pending.length) { showToast('No pending reports to approve.', 'info'); return; }
    showConfirm(`Approve ${pending.length} pending report(s) for download?`, async () => {
        const now = new Date().toISOString();
        pending.forEach(r => { r.status = 'Approved'; r.approvedAt = now; });
        persistReports();
        renderReportsTable();
        updateNavBadges();
        showToast(`${pending.length} reports approved. Teachers can download them now.`, 'success');
        await logActivity('Reports Approved', `Bulk-approved ${pending.length} reports`);
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

async function generateReports() {
    const type      = document.getElementById('gr-type')?.value || 'class';
    const classId   = document.getElementById('gr-class')?.value || '';
    const studentId = document.getElementById('gr-student')?.value || '';
    const yearId    = document.getElementById('gr-year')?.value || '';
    const termId    = document.getElementById('gr-term')?.value || '';

    let studentsToProcess = [];
    if (type === 'individual') studentsToProcess = adminState.students.filter(s => s.id === studentId);
    else if (type === 'class')  studentsToProcess = adminState.students.filter(s => s.classId === classId || s.class === resolveClass(classId));
    else                         studentsToProcess = adminState.students;

    if (!studentsToProcess.length) { showToast('No students to process.', 'warning'); return; }

    try {
        const newReports = [];
        for (const s of studentsToProcess) {
            const existing = adminState.reports.find(r => r.studentId === s.id && r.termId === termId);
            if (!existing) {
                const rptDoc = await addDocument('reports', {
                    studentId:     s.id,
                    classId:       s.classId || classId,
                    academicYearId: yearId,
                    termId,
                    status:        'Generated',
                    generatedAt:   new Date().toISOString(),
                    generatedBy:   getCurrentUserProfile()?.uid || 'admin'
                });
                newReports.push(rptDoc);
                adminState.reports.push(rptDoc);
            }
        }
        showToast(`${newReports.length} reports generated!`, 'success');
        await logActivity('Reports Generated', `Generated ${newReports.length} reports for term ${termId}`);
        closeModal('generateReportModal');
        renderReportsTable();
        loadDashboard();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function viewReport(id) {
    window.open(`/report.html?reportId=${id}`, '_blank');
}

async function confirmDeleteReport(id) {
    showConfirm('Delete this report record?', async () => {
        await deleteDocument('reports', id);
        adminState.reports = adminState.reports.filter(r => r.id !== id);
        renderReportsTable();
        showToast('Report deleted.', 'success');
    });
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

// ─── USERS & ROLES ────────────────────────────────────────────────────────────
function renderUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    const users = adminState.users;
    tbody.innerHTML = users.length ? users.map((u, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escHtml(u.displayName || u.name || '—')}</td>
            <td>${escHtml(u.email || '—')}</td>
            <td><span class="status-pill ${rolePillClass(u.role)}">${escHtml(u.role || '—')}</span></td>
            <td>${(u.assignedClasses || []).map(c => resolveClass(c)).join(', ') || '—'}</td>
            <td>${(u.assignedSubjects || []).map(s => resolveSubject(s)).join(', ') || '—'}</td>
            <td><span class="status-pill ${u.status || 'active'}">${u.status || 'active'}</span></td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" title="Change Role" onclick="changeUserRole('${u.uid}')"><i class="fas fa-user-tag"></i></button>
                    <button class="action-btn ${u.status === 'inactive' ? 'success' : 'warning'}" onclick="toggleUserStatus('${u.uid}')">
                        <i class="fas ${u.status === 'inactive' ? 'fa-user-check' : 'fa-user-slash'}"></i>
                    </button>
                </div>
            </td>
        </tr>`).join('') : emptyRow(8, 'No users found');

    const countEl = document.getElementById('usersCount');
    if (countEl) countEl.textContent = `${users.length} users`;
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

function openCreateUserModal() {
    ['cu-name','cu-email','cu-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('cu-role').value = 'Teacher';
    document.getElementById('cu-error').style.display = 'none';
    document.getElementById('createUserModal').style.display = 'flex';
}

async function createUserAccount() {
    const name     = document.getElementById('cu-name')?.value?.trim() || '';
    const email    = document.getElementById('cu-email')?.value?.trim() || '';
    const password = document.getElementById('cu-password')?.value || '';
    const role     = document.getElementById('cu-role')?.value || 'Teacher';
    const errorEl  = document.getElementById('cu-error');

    if (!name || !email || !password) {
        if (errorEl) { errorEl.textContent = 'All fields are required.'; errorEl.style.display = 'block'; }
        return;
    }
    if (password.length < 6) {
        if (errorEl) { errorEl.textContent = 'Password must be at least 6 characters.'; errorEl.style.display = 'block'; }
        return;
    }

    try {
        const creds = await registerFirebaseUser(email, password, name, role);
        adminState.users.push({
            uid: creds.user.uid, email, displayName: name, role, status: 'active',
            assignedClasses: [], assignedSubjects: []
        });
        closeModal('createUserModal');
        renderUsersTable();
        showToast('User account created!', 'success');
    } catch (e) {
        const msg = e.code === 'auth/email-already-in-use' ? 'This email is already registered.' : e.message;
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    }
}

async function changeUserRole(uid) {
    const u = adminState.users.find(u => u.uid === uid);
    if (!u) return;
    const roles = ['Super Admin','Administrator','Headteacher','Class Teacher','Teacher'];
    const newRole = prompt(`Current role: ${u.role}\nEnter new role (${roles.join(', ')}):`);
    if (!newRole || !roles.includes(newRole)) { showToast('Invalid role.', 'error'); return; }
    await updateDocument('users', uid, { role: newRole });
    u.role = newRole;
    renderUsersTable();
    showToast(`Role updated to ${newRole}.`, 'success');
    await logActivity('User Role Changed', `Changed role for ${u.email} to ${newRole}`, uid);
}

async function toggleUserStatus(uid) {
    const u = adminState.users.find(u => u.uid === uid);
    if (!u) return;
    const newStatus = u.status === 'inactive' ? 'active' : 'inactive';
    await updateDocument('users', uid, { status: newStatus });
    u.status = newStatus;
    renderUsersTable();
    showToast(`User ${newStatus}.`, 'success');
}

// ─── AUDIT LOGS ───────────────────────────────────────────────────────────────
function renderAuditLogs() {
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
        { label: 'Users',          value: adminState.users.length },
        { label: 'Audit Logs',     value: adminState.auditLogs.length },
    ];
    container.innerHTML = stats.map(s => `
        <div class="stat-item">
            <div class="stat-item-value">${s.value}</div>
            <div class="stat-item-label">${s.label}</div>
        </div>`).join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// DOWNLOADABLE CSV TEMPLATES
// ──────────────────────────────────────────────────────────────────────────────
function startFileDownload(url) {
    if (!url) return;
    window.location.href = '/open?src=' + encodeURIComponent(url);
}

function downloadTemplate(type) {
    startFileDownload('/api/templates/' + encodeURIComponent(type) + '.xlsx');
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

function toggleNotificationsPanel() {
    showToast('Notification panel coming soon.', 'info');
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
        showToast('Firebase connected. Upload school data next.', 'success');
        await logActivity('Firebase Connected', cfg.projectId);
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
