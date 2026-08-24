'use strict';

// Fallback only — subjects are created by the admin and synced to this portal.
const LEGACY_SUBJECTS = [
    'English Language', 'Mathematics', 'Science', 'RME', 'History',
    'Creative Arts', 'Computing', 'French', 'Asante Twi', 'Career Technology'
];

const DEFAULT_GRADES = [
    { min: 80, max: 100, grade: 'A', remark: 'ADVANCE' },
    { min: 68, max: 79, grade: 'P', remark: 'PROFICIENCY' },
    { min: 54, max: 67, grade: 'AP', remark: 'APPROACHING PROFICIENCY' },
    { min: 40, max: 53, grade: 'D', remark: 'DEVELOPING' },
    { min: 0, max: 39, grade: 'B', remark: 'BEGINNER' }
];

let students = [];
let scores = {};
let schoolInfo = {};
let schoolSettings = {};
let parentContacts = {};
let studentReportDetails = {};
let reports = [];
let currentClass = '';
let currentTab = 'students';
let currentSubject = '';
let saveTimer = null;

function gradeScale(className = '') {
    const allScales = loadJSON('gradingScales', []);
    const clsName = String(className || currentClass || '').toLowerCase();
    const jhsKeywords = ['basic 7','basic 8','basic 9','jhs 1','jhs 2','jhs 3','jhs'];
    const isJHS = jhsKeywords.some(k => clsName.includes(k));
    const targetDept = isJHS ? 'JHS' : (clsName.includes('kg') || clsName.includes('nursery') || clsName.includes('kindergarten') ? 'Kindergarten' : 'Primary');

    if (Array.isArray(allScales) && allScales.length) {
        // 1. Look for active scale specifically for this department
        const activeDeptScale = allScales.find(s => s.isActive && (s.department === targetDept || (targetDept === 'JHS' && (s.name||'').toLowerCase().includes('jhs')) || (targetDept === 'Primary' && (s.name||'').toLowerCase().includes('primary'))));
        if (activeDeptScale && (activeDeptScale.ranges || activeDeptScale.items)) {
            return activeDeptScale.ranges || activeDeptScale.items;
        }
        // 2. Look for any active scale configured for 'All'
        const allDeptScale = allScales.find(s => s.isActive && s.department === 'All');
        if (allDeptScale && (allDeptScale.ranges || allDeptScale.items)) {
            return allDeptScale.ranges || allDeptScale.items;
        }
        // 3. Any active scale
        const anyActive = allScales.find(s => s.isActive);
        if (anyActive && (anyActive.ranges || anyActive.items)) {
            return anyActive.ranges || anyActive.items;
        }
    }

    if (isJHS) {
        return [
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
    }
    return DEFAULT_GRADES;
}

function getGrade(score, className = '') {
    const scale = gradeScale(className);
    const t = Math.max(0, Math.min(100, Number(score) || 0));
    return scale.find(g => t >= g.min && t <= g.max) || scale[scale.length - 1] || { grade: '—', remark: '—' };
}

function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
}
function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof syncSaveCollection === 'function') syncSaveCollection(key, value);
}
function loadAll() {
    students = loadJSON('students', []);
    scores = loadJSON('scores', {});
    schoolInfo = loadJSON('schoolInfo', {
        academicYear: '2025/2026', term: '1', closingDate: '', reopeningDate: '',
        classTeacher: '', headTeacher: '', schoolLogo: null, numberOnRollByClass: {}
    });
    schoolSettings = loadJSON('schoolSettings', {});
    parentContacts = loadJSON('parentContacts', {});
    studentReportDetails = loadJSON('studentReportDetails', {});
    reports = loadJSON('reports', []);
    applyAdminCalendar();
    if (typeof Attendance !== 'undefined') Attendance.load();
}
function persistStudents() { saveJSON('students', students); }
function persistScores() { saveJSON('scores', scores); }
function persistInfo() { saveJSON('schoolInfo', schoolInfo); }
function persistReports() { saveJSON('reports', reports); }
function persistDetails() { saveJSON('studentReportDetails', studentReportDetails); }
function persistParents() { saveJSON('parentContacts', parentContacts); }

function schoolName() {
    return schoolSettings.schoolName || 'The Living Spring School';
}

// ── Admin-managed subjects ──────────────────────────────────────────────────
// Subjects are created in the Admin Dashboard and assigned to classes and
// teachers there. This portal reads them from the synced `subjects`
// collection instead of a hardcoded list.
function adminSubjects() {
    const docs = loadJSON('subjects', []);
    if (!Array.isArray(docs)) return [];
    return docs.filter(d => d && d.name && String(d.status || 'active').toLowerCase() !== 'inactive');
}

function classIdForName(name) {
    const classes = loadJSON('classes', []);
    const c = classes.find(c => c.name === name || String(c.id) === String(name));
    return c ? c.id : name;
}

function currentTeacherRecord() {
    const email = (sessionStorage.getItem('teacherEmail') || '').toLowerCase();
    if (!email) return null;
    const teachers = loadJSON('teachers', []);
    const users = loadJSON('users', []);
    const userProfile = (typeof getCurrentUserProfile === 'function') ? getCurrentUserProfile() : null;

    const t = teachers.find(t => (t.email || '').toLowerCase() === email);
    const u = users.find(u => (u.email || '').toLowerCase() === email);

    const assignedClasses = (Array.isArray(t?.assignedClasses) && t.assignedClasses.length)
        ? t.assignedClasses
        : (Array.isArray(u?.assignedClasses) && u.assignedClasses.length ? u.assignedClasses : (userProfile?.assignedClasses || []));

    const assignedSubjects = (Array.isArray(t?.assignedSubjects) && t.assignedSubjects.length)
        ? t.assignedSubjects
        : (Array.isArray(u?.assignedSubjects) && u.assignedSubjects.length ? u.assignedSubjects : (userProfile?.assignedSubjects || []));

    return {
        id: t?.id || u?.uid || u?.id || 'teacher',
        userId: t?.userId || u?.uid || null,
        name: t?.name || u?.displayName || u?.name || sessionStorage.getItem('teacherName') || email,
        email: email,
        role: t?.role || u?.role || userProfile?.role || 'Teacher',
        status: t?.status || u?.status || 'active',
        assignedClasses: assignedClasses,
        assignedSubjects: assignedSubjects
    };
}

// ── Class access control ────────────────────────────────────────────────────
// A teacher only sees classes the admin assigned to them. Admin-role accounts
// (Administrator / Headteacher / Super Admin) keep access to every class.
const ADMIN_LEVEL_ROLES = ['super admin', 'administrator', 'headteacher', 'head teacher', 'admin'];

function teacherAllowedClasses() {
    const all = classList();
    const rec = currentTeacherRecord();
    if (!rec) return [];
    const role = String(rec.role || '').toLowerCase();
    if (ADMIN_LEVEL_ROLES.includes(role)) return all;

    const classes = loadJSON('classes', []);
    const assignedRefs = Array.isArray(rec.assignedClasses) ? rec.assignedClasses.map(String) : [];
    const names = [];

    classes.forEach(c => {
        if (c.status === 'inactive') return;
        const cId = String(c.id);
        const cName = String(c.name || '');

        const isClassTeacher = String(c.classTeacherId) === String(rec.id) || (rec.userId && String(c.classTeacherId) === String(rec.userId));
        const isAssignedTeacher = Array.isArray(c.assignedTeacherIds) && (
            c.assignedTeacherIds.includes(rec.id) ||
            c.assignedTeacherIds.includes(String(rec.id)) ||
            (rec.userId && c.assignedTeacherIds.includes(rec.userId))
        );
        const inAssignedClasses = assignedRefs.includes(cId) || assignedRefs.includes(cName);

        if (isClassTeacher || isAssignedTeacher || inAssignedClasses) {
            if (cName && all.includes(cName) && !names.includes(cName)) {
                names.push(cName);
            }
        }
    });

    assignedRefs.forEach(ref => {
        if (all.includes(ref) && !names.includes(ref)) {
            names.push(ref);
        }
    });

    return names;
}
// ─────────────────────────────────────────────────────────────────────────────

function subjectAssignedToTeacher(doc, teacher) {
    const assigned = Array.isArray(teacher?.assignedSubjects) ? teacher.assignedSubjects.map(String) : [];
    if (!assigned.length) return true;
    const docId = String(doc.id || '');
    const docName = String(doc.name || '');
    const docCode = String(doc.code || '');
    return assigned.includes(docId) || assigned.includes(docName) || assigned.includes(docCode);
}

function subjectAssignedToClass(doc, className) {
    const ids = Array.isArray(doc.classIds) ? doc.classIds.map(String) : [];
    if (!ids.length) return true; // no classes ticked → treated as offered everywhere
    const cid = String(classIdForName(className) || '');
    const cName = String(className || '');
    return ids.includes(cid) || ids.includes(cName);
}

function allClassSubjects(className) {
    const docs = adminSubjects();
    const allDocs = docs.length ? docs : LEGACY_SUBJECTS.map(name => ({ id: name, name }));
    const forClass = allDocs.filter(d => subjectAssignedToClass(d, className || currentClass));
    if (forClass.length > 0) return forClass.map(d => d.name);
    return allDocs.map(d => d.name);
}

// Subjects for the class currently open, filtered by the teacher's assignment.
function classSubjects() {
    const docs = adminSubjects();
    const allDocs = docs.length ? docs : LEGACY_SUBJECTS.map(name => ({ id: name, name }));
    const forClass = allDocs.filter(d => subjectAssignedToClass(d, currentClass));
    const teacher = currentTeacherRecord();
    const role = String(teacher?.role || '').toLowerCase();

    // Admin-level roles see all class subjects
    if (ADMIN_LEVEL_ROLES.includes(role)) {
        return forClass.map(d => d.name);
    }

    const assigned = Array.isArray(teacher?.assignedSubjects) ? teacher.assignedSubjects : [];
    if (assigned.length > 0) {
        const forTeacher = forClass.filter(d => subjectAssignedToTeacher(d, teacher));
        return forTeacher.map(d => d.name);
    }

    return forClass.map(d => d.name);
}
// ─────────────────────────────────────────────────────────────────────────────
function classList() {
    const fromAdmin = loadJSON('classes', []);
    if (fromAdmin.length) return fromAdmin.filter(c => c.status !== 'inactive').map(c => c.name);
    return ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6'];
}
function classRecord(name) {
    return loadJSON('classes', []).find(c => c.name === name || c.id === name) || null;
}
function teacherById(id) {
    if (!id) return null;
    return loadJSON('teachers', []).find(t => String(t.id) === String(id)) || null;
}
function classTeacherName(className) {
    const cls = classRecord(className || currentClass);
    const assigned = teacherById(cls?.classTeacherId);
    if (assigned?.name) return assigned.name;
    if (cls?.classTeacherName) return cls.classTeacherName;
    const teachers = loadJSON('teachers', []);
    const fallback = teachers.find(t =>
        t.status !== 'inactive' &&
        (t.assignedClasses || []).some(id => id === cls?.id || id === (className || currentClass))
    );
    return fallback?.name || '';
}
function headTeacherName() {
    const teachers = loadJSON('teachers', []);
    const ht = teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive');
    return ht?.name || schoolSettings.headTeacher || schoolInfo.headTeacher || '';
}
function schoolLogoSrc() {
    return schoolSettings.schoolLogo || schoolInfo.schoolLogo || null;
}
function applyAdminCalendar() {
    const years = loadJSON('academicYears', []);
    const terms = loadJSON('terms', []);
    const y = years.find(x => x.isActive) || loadJSON('activeAcademicYear', null);
    const t = terms.find(x => x.isActive) || loadJSON('activeTerm', null);
    if (y?.name) schoolInfo.academicYear = y.name;
    if (t) schoolInfo.term = String(t.termNumber || schoolInfo.term || '1');
    if (schoolSettings.closingDate) schoolInfo.closingDate = schoolSettings.closingDate;
    if (schoolSettings.reopeningDate) schoolInfo.reopeningDate = schoolSettings.reopeningDate;
    if (schoolSettings.headTeacher) schoolInfo.headTeacher = schoolSettings.headTeacher;
}
function termHeading() {
    const terms = loadJSON('terms', []);
    const t = terms.find(x => x.isActive) || loadJSON('activeTerm', null);
    if (t?.name) return t.name;
    return 'Term ' + (schoolInfo.term || '1');
}
function classStudents() {
    const rec = classRecord(currentClass);
    return students.filter(s =>
        s.class === currentClass ||
        (rec && (s.classId === rec.id || s.class === rec.id || s.class === rec.name))
    );
}
function toast(msg, type) {
    const area = document.getElementById('toastArea');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'ok');
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fifty(n) {
    if (n === '' || n == null || isNaN(Number(n))) return '';
    return Math.round((Number(n) / 100) * 50 * 10) / 10;
}
function totalScore(cs, es) {
    const a = fifty(cs);
    const b = fifty(es);
    if (a === '' || b === '') return '';
    return Math.round((Number(a) + Number(b)) * 10) / 10;
}
function scoreKey(studentId) { return String(studentId); }
function getScoreEntry(subject, studentId) {
    const bag = scores[subject] || {};
    const id = scoreKey(studentId);
    return bag[id] || bag[studentId] || bag[Number(studentId)] || { classScore: '', examScore: '', totalScore: '' };
}
function putScoreEntry(subject, studentId, data) {
    if (!scores[subject]) scores[subject] = {};
    scores[subject][scoreKey(studentId)] = data;
}
function getDepartmentForClass(className) {
    const cls = classRecord(className || currentClass);
    if (cls?.department) return cls.department;
    const name = String(className || currentClass || '').toLowerCase();
    if (['basic 7', 'basic 8', 'basic 9', 'jhs 1', 'jhs 2', 'jhs 3', 'jhs'].some(k => name.includes(k))) return 'JHS';
    if (['creche', 'nursery', 'kg', 'kindergarten'].some(k => name.includes(k))) return 'Kindergarten';
    if (['basic 1', 'basic 2', 'basic 3', 'class 1', 'class 2', 'class 3'].some(k => name.includes(k))) return 'Lower Primary';
    if (['basic 4', 'basic 5', 'basic 6', 'class 4', 'class 5', 'class 6'].some(k => name.includes(k))) return 'Upper Primary';
    return 'Primary';
}

const JHS_STANINE_SCALE = [
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

function getGrade(total, classNameOrDept) {
    const dept = classNameOrDept || getDepartmentForClass(currentClass);
    const deptLower = String(dept).toLowerCase();
    const isJHS = ['jhs', 'basic 7', 'basic 8', 'basic 9', 'jhs 1', 'jhs 2', 'jhs 3'].some(k => deptLower.includes(k));
    
    // Check if admin configured a grading scale specifically for this department
    const scales = loadJSON('gradingScales', []);
    const deptScale = scales.find(s => s.department && s.department.toLowerCase() === deptLower && (s.ranges || s.items));
    if (deptScale) {
        const ranges = deptScale.ranges || deptScale.items;
        const t = Math.max(0, Math.min(100, Number(total) || 0));
        return ranges.find(g => t >= g.min && t <= g.max) || ranges[ranges.length - 1];
    }
    
    if (isJHS) {
        const t = Math.max(0, Math.min(100, Number(total) || 0));
        return JHS_STANINE_SCALE.find(g => t >= g.min && t <= g.max) || JHS_STANINE_SCALE[JHS_STANINE_SCALE.length - 1];
    }

    if (typeof getGradeForScore === 'function') return getGradeForScore(total);
    const scale = gradeScale();
    const t = Math.max(0, Math.min(100, Number(total) || 0));
    return scale.find(g => t >= g.min && t <= g.max) || scale[scale.length - 1];
}

function approvalKey(id) {
    return String(id) + '|' + (schoolInfo.academicYear || '') + '|' + (schoolInfo.term || '');
}

function reportRecord(id) {
    const stuId = String(id);
    const rList = loadJSON('reports', []);
    return rList.find(r => 
        String(r.studentId) === stuId || 
        (r.student && String(r.student.id) === stuId) ||
        (r.approvalKey && String(r.approvalKey).split('|')[0] === stuId)
    ) || null;
}

function isApproved(id) {
    const rec = reportRecord(id);
    if (!rec) return false;
    const st = String(rec.status || '').toLowerCase();
    return st === 'approved' || st === 'published';
}

function upsertPending(list) {
    const currentReports = loadJSON('reports', []);
    list.forEach(stu => {
        const sid = String(stu.id);
        const existing = currentReports.find(r => 
            String(r.studentId) === sid || 
            (r.student && String(r.student.id) === sid) ||
            (r.approvalKey && String(r.approvalKey).split('|')[0] === sid)
        );
        if (existing) {
            if (!['approved', 'published'].includes(String(existing.status).toLowerCase())) {
                existing.status = 'Pending';
                existing.generatedAt = new Date().toISOString();
                existing.studentName = stu.name;
                existing.classId = stu.class;
            }
        } else {
            const key = approvalKey(stu.id);
            currentReports.push({
                id: 'rpt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                approvalKey: key,
                studentId: sid,
                studentName: stu.name,
                classId: stu.class,
                academicYearId: schoolInfo.academicYear || '',
                termId: schoolInfo.term || '',
                status: 'Pending',
                generatedAt: new Date().toISOString(),
                generatedBy: sessionStorage.getItem('teacherEmail') || 'teacher'
            });
        }
    });
    reports = currentReports;
    persistReports();
}

function togglePw(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.innerHTML = input.type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
}

function setTeacherLoginLoading(on) {
    const btn = document.getElementById('teacherLoginBtn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on
        ? '<i class="fas fa-spinner fa-spin"></i> Signing in…'
        : '<i class="fas fa-sign-in-alt"></i> Sign In';
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), ms); })
    ]).finally(() => clearTimeout(timer));
}

async function teacherLogin() {
    const email = document.getElementById('teacherLoginEmail').value.trim();
    const password = document.getElementById('teacherLoginPassword').value;
    const err = document.getElementById('teacherAuthError');
    err.style.display = 'none';
    if (!email || !password) {
        err.textContent = 'Enter email and password.';
        err.style.display = 'block';
        return;
    }
    if (typeof initFirebase === 'function') initFirebase();
    setTeacherLoginLoading(true);

    // Strict access: only accounts created by the administrator can log in.
    const teachers = loadJSON('teachers', []);
    const users = loadJSON('users', []);
    const t = teachers.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
    const u = users.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
    if (!t && !u) {
        err.textContent = 'No account found for this email. Accounts are created by the school administrator.';
        err.style.display = 'block';
        setTeacherLoginLoading(false);
        return;
    }
    if (t?.status === 'inactive' || u?.status === 'inactive' || t?.status === 'deleted' || u?.status === 'deleted' || t?.isDeleted || u?.isDeleted) {
        err.textContent = 'This account has been deactivated / deleted by the administrator.';
        err.style.display = 'block';
        setTeacherLoginLoading(false);
        return;
    }

    let ok = false;
    if (typeof isFirebaseActive !== 'undefined' && isFirebaseActive && typeof loginFirebaseUser === 'function') {
        try {
            const creds = await withTimeout(loginFirebaseUser(email, password), 10000, 'Sign-in');
            sessionStorage.setItem('teacherName', getCurrentUserProfile()?.displayName || creds.user.email);
            ok = true;
        } catch (e) {
            /* fall through to the stored password check */
        }
    }
    const stored = u?.password || t?.password || '';
    if (!ok && stored && password === stored) ok = true;
    if (!ok) {
        err.textContent = 'Incorrect email or password. Use the credentials the administrator created for you.';
        err.style.display = 'block';
        setTeacherLoginLoading(false);
        return;
    }

    sessionStorage.setItem('teacherUnlocked', 'true');
    sessionStorage.setItem('teacherEmail', email);
    if (!sessionStorage.getItem('teacherName')) {
        sessionStorage.setItem('teacherName', u?.displayName || t?.name || email.split('@')[0]);
    }
    await openApp();
}

function teacherLogout() {
    sessionStorage.removeItem('teacherUnlocked');
    sessionStorage.removeItem('teacherEmail');
    sessionStorage.removeItem('teacherName');
    if (typeof logoutFirebaseUser === 'function') logoutFirebaseUser().catch(() => {});
    document.getElementById('app').style.display = 'none';
    document.getElementById('teacherAuthOverlay').style.display = 'flex';
}

async function openApp() {
    loadAll();
    // Show the app immediately with local data. Cloud sync keeps running in
    // the background instead of holding the sign-in screen hostage.
    document.getElementById('teacherAuthOverlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('teacherChip').textContent = sessionStorage.getItem('teacherName') || 'Teacher';
    document.getElementById('schoolNameLabel').textContent = schoolName();
    document.getElementById('termLabel').textContent = (schoolInfo.academicYear || '') + ' · ' + termHeading();
    fillHeaderClasses();
    const saved = sessionStorage.getItem('teacherClass');
    const allowed = teacherAllowedClasses();
    if (saved && allowed.includes(saved)) enterClass(saved);
    else showHub();
    setTeacherLoginLoading(false);

    const refreshFromSync = () => {
        loadAll();
        fillHeaderClasses();
        document.getElementById('schoolNameLabel').textContent = schoolName();
        document.getElementById('termLabel').textContent = (schoolInfo.academicYear || '') + ' · ' + termHeading();
        updateSidebarState();
        if (currentSubject && !classSubjects().includes(currentSubject)) currentSubject = '';
        if (currentClass) openTab(currentTab);
        else renderHub();
    };

    // Cloud (Firebase) and local-server sync run in the background.
    const syncJobs = [];
    if (typeof pullSchoolFromFirebase === 'function') {
        syncJobs.push(pullSchoolFromFirebase().catch(() => false));
    }
    syncJobs.push(hydrateSchoolFromServer());
    Promise.all(syncJobs).then(results => {
        if (results.some(Boolean)) refreshFromSync();
    }).catch(() => {});

    if (typeof startSchoolRealtime === 'function') {
        startSchoolRealtime(function () {
            loadAll();
            fillHeaderClasses();
            updateSidebarState();
            if (currentSubject && !classSubjects().includes(currentSubject)) currentSubject = '';
            if (currentClass) openTab(currentTab);
            else renderHub();
        });
    }
    if (typeof Attendance !== 'undefined' && Attendance.hydrateFromServer) Attendance.hydrateFromServer().catch(() => {});
}

// Pull admin-managed data (subjects, classes, teachers, students, settings, reports)
// from the local server so portals stay in sync even without Firebase.
function hydrateSchoolFromServer() {
    if (typeof isFirebaseConnected === 'function' && isFirebaseConnected()) return Promise.resolve(false);
    return fetch('/api/db').then(function (res) { return res.ok ? res.json() : null; }).then(function (db) {
        if (!db) return false;
        let changed = false;
        ['classes', 'subjects', 'teachers', 'students', 'schoolSettings', 'schoolInfo', 'reports', 'academicYears', 'terms', 'gradingScales'].forEach(function (k) {
            const remote = db[k];
            if (remote == null) return;
            try {
                const localRaw = localStorage.getItem(k);
                const local = localRaw ? JSON.parse(localRaw) : null;
                // Never wipe local data with an empty server collection.
                if (Array.isArray(remote) && !remote.length && Array.isArray(local) && local.length) return;
                const remoteStr = JSON.stringify(remote);
                if (localRaw !== remoteStr) { localStorage.setItem(k, remoteStr); changed = true; }
            } catch (e) {}
        });
        return changed;
    }).catch(function () { return false; });
}

function fillHeaderClasses() {
    const sel = document.getElementById('headerClassSelect');
    sel.innerHTML = teacherAllowedClasses().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (currentClass) sel.value = currentClass;
}

function showHub() {
    currentClass = '';
    sessionStorage.removeItem('teacherClass');
    document.getElementById('view-hub').classList.add('active');
    document.getElementById('view-class').classList.remove('active');
    document.getElementById('classSwitcherWrap').style.display = 'none';
    updateSidebarState();
    closeSidebar();
    renderHub();
}

function renderHub() {
    const grid = document.getElementById('classHubGrid');
    const allowed = teacherAllowedClasses();
    if (!allowed.length) {
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">
            No classes are assigned to your account yet.<br>
            Ask the administrator to assign classes to you (Teachers → edit your account → Classes).
        </div>`;
        return;
    }
    grid.innerHTML = allowed.map(name => {
        const n = students.filter(s => s.class === name).length;
        const teacher = classTeacherName(name);
        return `<button class="hub-card" onclick="enterClass('${esc(name)}')">
            <h3>${esc(name)}</h3>
            <div class="count">${n}</div>
            <p>${n} student${n === 1 ? '' : 's'}</p>
            <p class="muted">${teacher ? 'Class teacher: ' + esc(teacher) : 'No class teacher assigned'}</p>
        </button>`;
    }).join('');
}

function switchClass(name) { enterClass(name); }

function enterClass(name, tab) {
    if (!teacherAllowedClasses().includes(name)) {
        toast('You are not assigned to that class.', 'bad');
        showHub();
        return;
    }
    currentClass = name;
    sessionStorage.setItem('teacherClass', name);
    if (currentSubject && !classSubjects().includes(currentSubject)) currentSubject = '';
    document.getElementById('view-hub').classList.remove('active');
    document.getElementById('view-class').classList.add('active');
    document.getElementById('classSwitcherWrap').style.display = 'flex';
    fillHeaderClasses();
    updateSidebarState();
    openTab(tab || currentTab || 'students');
}

function updateSidebarState() {
    const classLabel = document.getElementById('sidebarClassLabel');
    if (classLabel) classLabel.textContent = currentClass || 'All classes';
    const title = document.getElementById('topbarTitle');
    if (title) title.textContent = currentClass ? currentClass : 'Your classes';
    document.querySelectorAll('.side-link[data-tab]').forEach(b => {
        b.classList.toggle('active', !!currentClass && b.dataset.tab === currentTab);
    });
    const hub = document.getElementById('hubLink');
    if (hub) hub.classList.toggle('active', !currentClass);
}

function toggleSidebar() {
    const layout = document.getElementById('appLayout');
    if (layout) layout.classList.toggle('sidebar-open');
}

function closeSidebar() {
    const layout = document.getElementById('appLayout');
    if (layout) layout.classList.remove('sidebar-open');
}

function openTab(tab) {
    if (!currentClass) {
        // Sidebar sections stay reachable from the hub — open the last class.
        const allowed = teacherAllowedClasses();
        const saved = sessionStorage.getItem('teacherClass');
        const target = (saved && allowed.includes(saved)) ? saved : allowed[0];
        if (!target) { toast('No classes are assigned to your account.', 'bad'); return; }
        enterClass(target, tab);
        return;
    }
    currentTab = tab;
    document.querySelectorAll('.nav-pill, .side-link[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
    updateSidebarState();
    closeSidebar();
    renderStats();
    if (tab === 'students') renderStudents();
    if (tab === 'scores') renderScores();
    if (tab === 'broadsheet') renderBroadsheet();
    if (tab === 'reports') renderReports();
    if (tab === 'performance') renderPerformance();
    if (tab === 'attendance') renderAttendance();
    if (tab === 'whatsapp') renderWhatsApp();
    if (tab === 'info') renderInfo();
}

function renderStats() {
    const list = classStudents();
    const subs = classSubjects();
    const scored = list.filter(s => subs.some(sub => {
        const e = getScoreEntry(sub, s.id);
        return e.totalScore !== '';
    })).length;
    const approved = list.filter(s => isApproved(s.id)).length;
    document.getElementById('classStats').innerHTML = `
        <div class="stat"><b>${list.length}</b><span>Students</span></div>
        <div class="stat"><b>${scored}</b><span>With scores</span></div>
        <div class="stat"><b>${approved}</b><span>Approved reports</span></div>
        <div class="stat"><b>${list.length - approved}</b><span>Awaiting admin</span></div>`;
}

function renderStudents() {
    const list = classStudents();
    document.getElementById('tab-students').innerHTML = `
        <div class="card">
            <div class="row">
                <div class="field"><label>Student name</label><input id="newStudentName" placeholder="Full name"></div>
                <button class="btn btn-primary" onclick="addStudent()"><i class="fas fa-plus"></i> Add to ${esc(currentClass)}</button>
            </div>
            <input class="field" style="margin-bottom:10px;width:100%;padding:9px 10px;border:1.5px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);" id="studentFilter" placeholder="Search students…" oninput="renderStudents()" autocomplete="off" value="">
            <div class="list">
                ${list.filter(s => {
                    const q = (document.getElementById('studentFilter')?.value || '').toLowerCase();
                    return !q || s.name.toLowerCase().includes(q);
                }).map(s => `
                    <div class="list-item">
                        <div><strong>${esc(s.name)}</strong><div class="muted">${esc(s.admissionNo || '')} · ${esc(s.class)}</div></div>
                        <div class="actions">
                            <button class="btn btn-ghost btn-sm" onclick="editStudent('${s.id}')">Edit</button>
                            <button class="btn btn-ghost btn-sm danger" onclick="deleteStudent('${s.id}')">Delete</button>
                        </div>
                    </div>`).join('') || '<div class="empty">No students in this class yet.</div>'}
            </div>
        </div>`;
}

function addStudent() {
    const name = document.getElementById('newStudentName').value.trim();
    if (!name) return toast('Enter a student name.', 'bad');
    students.push({ id: Date.now(), name, class: currentClass, status: 'active' });
    persistStudents();
    toast('Student added.', 'ok');
    renderStudents();
    renderStats();
}

function editStudent(id) {
    const s = students.find(x => x.id === id);
    if (!s) return;
    openModal(`<h3>Edit student</h3>
        <div class="field"><label>Name</label><input id="editName" value="${esc(s.name)}"></div>
        <div class="field" style="margin-top:10px;"><label>Move to class</label>
            <select id="editClass">${teacherAllowedClasses().map(c => `<option ${c === s.class ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="actions" style="margin-top:14px;">
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveStudentEdit(${id})">Save</button>
        </div>`);
}

function saveStudentEdit(id) {
    const s = students.find(x => x.id === id);
    if (!s) return;
    s.name = document.getElementById('editName').value.trim() || s.name;
    s.class = document.getElementById('editClass').value;
    persistStudents();
    closeModal();
    toast('Student updated.', 'ok');
    renderStudents();
}

function deleteStudent(id) {
    if (!confirm('Delete this student and their scores?')) return;
    students = students.filter(s => s.id !== id);
    new Set([...Object.keys(scores || {}), ...classSubjects()]).forEach(sub => {
        if (!scores[sub]) return;
        delete scores[sub][id];
        delete scores[sub][String(id)];
    });
    delete studentReportDetails[id];
    delete parentContacts[id];
    persistStudents(); persistScores(); persistDetails(); persistParents();
    toast('Student deleted.', 'ok');
    renderStudents();
}

function scoredCount(subject) {
    return classStudents().filter(s => {
        const e = getScoreEntry(subject, s.id);
        return e.classScore !== '' && e.examScore !== '';
    }).length;
}

// Piecewise assessment mode state
// Piecewise assessment mode state
let piecewiseMode = false;
let caCount = parseInt(localStorage.getItem('teacherCaCount') || '4') || 4;

function changeCaCount(count) {
    caCount = Math.max(1, Math.min(5, parseInt(count) || 4));
    localStorage.setItem('teacherCaCount', String(caCount));
    drawScoreSheet();
}

function renderScores() {
    const subs = classSubjects();
    if (subs.length && (!currentSubject || !subs.includes(currentSubject))) {
        currentSubject = subs[0];
    } else if (!subs.length) {
        currentSubject = '';
    }

    const dept = getDepartmentForClass(currentClass);
    const isJHS = ['jhs', 'basic 7', 'basic 8', 'basic 9', 'jhs 1', 'jhs 2', 'jhs 3'].some(k => dept.toLowerCase().includes(k));

    document.getElementById('tab-scores').innerHTML = `
        <div class="card">
            <p class="hint"><strong>How to enter marks:</strong> Type class and exam scores <em>out of 100</em>. Each is converted to 50% and added for a total out of 100. Autosaves. Department: <strong>${esc(dept)}</strong> ${isJHS ? '<span style="color:#6366f1;font-weight:700;">(Stanine 1–9 Grading)</span>' : '<span style="color:#059669;font-weight:700;">(Standard Grading)</span>'}.</p>
            <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px;background:var(--card-alt, #f8fafc);padding:10px 14px;border-radius:8px;border:1px solid var(--line, #e2e8f0);">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;">
                    <input type="checkbox" id="piecewiseToggle" ${piecewiseMode ? 'checked' : ''} onchange="togglePiecewiseMode(this.checked)" style="width:16px;height:16px;">
                    <span>Piecewise Assessment Mode (Continuous Assessments)</span>
                </label>
                ${piecewiseMode ? `
                <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
                    <label for="caCountSelect" style="font-weight:600;color:var(--text, #334155);">Number of CA Sections:</label>
                    <select id="caCountSelect" onchange="changeCaCount(this.value)" style="padding:4px 10px;border-radius:6px;border:1px solid #cbd5e1;font-weight:600;background:#fff;cursor:pointer;">
                        <option value="1" ${caCount === 1 ? 'selected' : ''}>1 (CA 1)</option>
                        <option value="2" ${caCount === 2 ? 'selected' : ''}>2 (CA 1, CA 2)</option>
                        <option value="3" ${caCount === 3 ? 'selected' : ''}>3 (CA 1, CA 2, CA 3)</option>
                        <option value="4" ${caCount === 4 ? 'selected' : ''}>4 (CA 1, CA 2, CA 3, CA 4)</option>
                        <option value="5" ${caCount === 5 ? 'selected' : ''}>5 (CA 1, CA 2, CA 3, CA 4, CA 5)</option>
                    </select>
                </div>` : ''}
            </div>
            ${subs.length ? `<div class="subject-grid">
                ${subs.map(sub => `<button class="subject-chip ${currentSubject === sub ? 'active' : ''}" onclick="openSubject('${sub.replace(/'/g, "\\'")}')">
                    <strong>${esc(sub)}</strong>
                    <small>${scoredCount(sub)} / ${classStudents().length} entered</small>
                </button>`).join('')}
            </div>` : `<div class="empty" style="text-align:center;padding:24px 12px;">
                <i class="fas fa-lock" style="font-size:28px;opacity:0.6;margin-bottom:8px;display:block;"></i>
                <strong>No subjects assigned to you for ${esc(currentClass)}</strong><br>
                <span class="muted">Ask the school administrator in the Admin Portal to assign subjects to your teacher profile.</span>
            </div>`}
            ${subs.length ? `<div style="margin-top:14px;">
                <input type="file" id="marksFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="importMarks(event)">
                <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('marksFile').click()"><i class="fas fa-file-excel"></i> Import spreadsheet</button>
                <a class="btn btn-ghost btn-sm" id="downloadTemplateBtn" href="/open?src=/api/templates/marks.xlsx"><i class="fas fa-file-excel"></i> Excel template</a>
            </div>
            <div id="scoreSheet" style="margin-top:16px;"></div>` : ''}
        </div>`;
    const tpl = document.getElementById('downloadTemplateBtn');
    if (tpl && subs.length) {
        const cls = currentClass || '';
        const subject = currentSubject || subs[0] || 'Mathematics';
        const name = (cls || 'class').replace(/\s/g, '_') + '_' + subject.replace(/\s/g, '_') + '_marks_template.csv';
        tpl.href = '/open?src=' + encodeURIComponent('/api/templates/marks.xlsx?class=' + encodeURIComponent(cls) + '&subject=' + encodeURIComponent(subject));
        tpl.setAttribute('download', name.replace(/\.csv$/i, '.xlsx'));
    }
    if (currentSubject) drawScoreSheet();
}

function togglePiecewiseMode(on) {
    piecewiseMode = !!on;
    renderScores();
}

function openSubject(sub) {
    currentSubject = sub;
    renderScores();
}

function getCaValue(assessments, index) {
    if (!assessments) return '';
    const direct = assessments['ca' + index];
    if (direct !== undefined && direct !== null) return direct;
    // Backward compatibility for test1, test2, project, homework
    const legacyMap = { 1: 'test1', 2: 'test2', 3: 'project', 4: 'homework' };
    const legKey = legacyMap[index];
    if (legKey && assessments[legKey] !== undefined) return assessments[legKey];
    return '';
}

function drawScoreSheet() {
    const wrap = document.getElementById('scoreSheet');
    if (!wrap) return;
    const list = classStudents();
    const dept = getDepartmentForClass(currentClass);

    if (piecewiseMode) {
        const caHeaders = Array.from({ length: caCount }, (_, i) => `<th>CA ${i + 1}</th>`).join('');
        wrap.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 6px;">
                <h3 style="margin:0;">${esc(currentSubject)}</h3>
                <span style="font-size:12px;color:var(--text-muted,#64748b);">Department: <strong>${esc(dept)}</strong></span>
            </div>
            <p class="hint" style="margin:0 0 10px;">Enter scores for each CA section. All CA entries sum up to <strong>Class Assessment /100</strong> (max 100%), converted to <strong>Class 50%</strong> + <strong>Exam 50%</strong> = <strong>Total 100%</strong>.</p>
            <div class="table-wrap"><table class="score-table">
                <thead><tr>
                    <th>Student</th>
                    ${caHeaders}
                    <th>Class /100</th>
                    <th>Class 50%</th>
                    <th>Exam /100</th>
                    <th>Exam 50%</th>
                    <th>Total /100</th>
                    <th>Grade (${esc(dept)})</th>
                </tr></thead>
                <tbody>
                    ${list.map(s => {
                        const e = getScoreEntry(currentSubject, s.id);
                        const a = e.assessments || {};
                        const cs50 = fifty(e.classScore);
                        const es50 = fifty(e.examScore);
                        const ready = e.classScore !== '' && e.examScore !== '';
                        const tot = ready ? totalScore(e.classScore, e.examScore) : '';
                        const g = ready ? getGrade(tot, currentClass) : null;
                        const sid = esc(scoreKey(s.id));
                        const caInputs = Array.from({ length: caCount }, (_, idx) => {
                            const i = idx + 1;
                            const val = getCaValue(a, i);
                            return `<td><input type="number" min="0" max="100" step="0.1" placeholder="CA ${i}" value="${val}" oninput="autosavePiece('${sid}','ca${i}',this)"></td>`;
                        }).join('');

                        return `<tr data-sid="${sid}">
                            <td style="min-width:120px;"><strong>${esc(s.name)}</strong></td>
                            ${caInputs}
                            <td class="cs-calc muted"><strong>${e.classScore !== '' ? e.classScore : '—'}</strong></td>
                            <td class="cs50 muted">${cs50 === '' ? '—' : cs50}</td>
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.examScore}" oninput="autosaveScore('${sid}','examScore',this)"></td>
                            <td class="es50 muted">${es50 === '' ? '—' : es50}</td>
                            <td class="tot"><strong>${tot === '' ? '—' : tot}</strong></td>
                            <td class="grd">${g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>`;
    } else {
        wrap.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 10px;">
                <h3 style="margin:0;">${esc(currentSubject)}</h3>
                <span style="font-size:12px;color:var(--text-muted,#64748b);">Department: <strong>${esc(dept)}</strong></span>
            </div>
            <div class="table-wrap"><table class="score-table">
                <thead><tr>
                    <th>Student</th>
                    <th>Class /100</th>
                    <th>Class 50%</th>
                    <th>Exam /100</th>
                    <th>Exam 50%</th>
                    <th>Total /100</th>
                    <th>Grade (${esc(dept)})</th>
                </tr></thead>
                <tbody>
                    ${list.map(s => {
                        const e = getScoreEntry(currentSubject, s.id);
                        const cs50 = fifty(e.classScore);
                        const es50 = fifty(e.examScore);
                        const ready = e.classScore !== '' && e.examScore !== '';
                        const tot = ready ? totalScore(e.classScore, e.examScore) : '';
                        const g = ready ? getGrade(tot, currentClass) : null;
                        return `<tr data-sid="${esc(scoreKey(s.id))}">
                            <td><strong>${esc(s.name)}</strong></td>
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.classScore}" oninput="autosaveScore('${esc(scoreKey(s.id))}','classScore',this)"></td>
                            <td class="cs50 muted">${cs50 === '' ? '—' : cs50}</td>
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.examScore}" oninput="autosaveScore('${esc(scoreKey(s.id))}','examScore',this)"></td>
                            <td class="es50 muted">${es50 === '' ? '—' : es50}</td>
                            <td class="tot"><strong>${tot === '' ? '—' : tot}</strong></td>
                            <td class="grd">${g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>`;
    }
}

function refreshScoreRow(studentId) {
    const tr = document.querySelector(`tr[data-sid="${scoreKey(studentId)}"]`);
    const row = getScoreEntry(currentSubject, studentId);
    if (!tr) return;
    const cs50 = fifty(row.classScore);
    const es50 = fifty(row.examScore);
    const ready = row.classScore !== '' && row.examScore !== '';
    const tot = ready ? totalScore(row.classScore, row.examScore) : '';
    const g = ready ? getGrade(tot, currentClass) : null;
    const csCalcCell = tr.querySelector('.cs-calc');
    const csCell = tr.querySelector('.cs50');
    const esCell = tr.querySelector('.es50');
    const totCell = tr.querySelector('.tot');
    const grdCell = tr.querySelector('.grd');
    if (csCalcCell) csCalcCell.innerHTML = `<strong>${row.classScore !== '' ? row.classScore : '—'}</strong>`;
    if (csCell) csCell.textContent = cs50 === '' ? '—' : cs50;
    if (esCell) esCell.textContent = es50 === '' ? '—' : es50;
    if (totCell) totCell.innerHTML = `<strong>${tot === '' ? '—' : tot}</strong>`;
    if (grdCell) grdCell.innerHTML = g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—';
}

// Piecewise: autosave an individual assessment part and recalculate class score as sum (max 100)
function autosavePiece(studentId, part, inputEl) {
    if (!currentSubject) return;
    const row = Object.assign({ classScore: '', examScore: '', totalScore: '', assessments: {} }, getScoreEntry(currentSubject, studentId));
    if (!row.assessments) row.assessments = {};
    const val = clampPartMark(inputEl.value, inputEl);
    row.assessments[part] = val;

    // Calculate class score as sum of active CA components
    let sum = 0;
    let hasAny = false;
    for (let i = 1; i <= caCount; i++) {
        const v = getCaValue(row.assessments, i);
        if (v !== '' && v != null && !isNaN(Number(v))) {
            sum += Number(v);
            hasAny = true;
        }
    }

    if (hasAny) {
        if (sum > 100) {
            toast(`Class assessment sum is ${sum.toFixed(1)}% (capped at 100%).`, 'bad');
            row.classScore = 100;
        } else {
            row.classScore = Math.round(sum * 10) / 10;
        }
    } else {
        row.classScore = '';
    }

    // Recalculate totals
    if (row.classScore !== '' && row.examScore !== '') {
        row.classScore50 = fifty(row.classScore);
        row.examScore50 = fifty(row.examScore);
        row.totalScore = totalScore(row.classScore, row.examScore);
        const g = getGrade(row.totalScore, currentClass);
        row.grade = g.grade;
        row.remark = g.remark;
    } else {
        row.classScore50 = fifty(row.classScore);
        row.examScore50 = fifty(row.examScore);
        row.totalScore = '';
        row.grade = '';
        row.remark = '';
    }
    putScoreEntry(currentSubject, studentId, row);
    refreshScoreRow(studentId);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        persistScores();
        syncScoresToResults();
        renderStats();
    }, 280);
}

// Sync scores to the shared results collection so admin can see them
function syncScoresToResults() {
    try {
        const existingResults = JSON.parse(localStorage.getItem('results') || '[]');
        const classes = JSON.parse(localStorage.getItem('classes') || '[]');
        const classRec = classes.find(c => c.name === currentClass || c.id === currentClass);
        const classId = classRec ? classRec.id : currentClass;
        const subs = allClassSubjects(currentClass);
        const studs = classStudents();
        const years = JSON.parse(localStorage.getItem('academicYears') || '[]');
        const terms = JSON.parse(localStorage.getItem('terms') || '[]');
        const activeYear = years.find(y => y.isActive);
        const activeTerm = terms.find(t => t.isActive);
        const results = JSON.parse(JSON.stringify(existingResults)); // clone

        studs.forEach(stu => {
            subs.forEach(sub => {
                const e = getScoreEntry(sub, stu.id);
                if (!e || (e.classScore === '' && e.examScore === '')) return;
                const existing = results.find(r =>
                    String(r.studentId) === String(stu.id) &&
                    (r.subjectId === sub || r.subjectName === sub) &&
                    r.classId === classId
                );
                const entry = {
                    studentId: String(stu.id),
                    studentName: stu.name,
                    classId,
                    subjectId: sub,
                    subjectName: sub,
                    classScore: e.classScore,
                    examScore: e.examScore,
                    totalScore: e.totalScore,
                    grade: e.grade,
                    remark: e.remark,
                    status: 'Submitted',
                    academicYearId: activeYear?.id || schoolInfo.academicYear || '',
                    termId: activeTerm?.id || schoolInfo.term || '',
                    updatedAt: new Date().toISOString()
                };
                if (existing) {
                    Object.assign(existing, entry);
                } else {
                    entry.id = 'res_' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
                    entry.locked = false;
                    results.push(entry);
                }
            });
        });

        localStorage.setItem('results', JSON.stringify(results));
        if (typeof syncSaveCollection === 'function') {
            syncSaveCollection('results', results).catch(() => {});
        }
    } catch(e) { console.warn('syncScoresToResults error:', e); }
}

function clampPartMark(raw, inputEl) {
    if (raw === '' || raw == null) return '';
    const num = Number(raw);
    if (isNaN(num)) {
        if (inputEl) inputEl.value = '';
        return '';
    }
    if (num < 0) {
        if (inputEl) inputEl.value = '0';
        toast('Minimum for this part is 0.', 'bad');
        return 0;
    }
    if (num > 100) {
        if (inputEl) inputEl.value = '100';
        toast('Maximum for this part is 100.', 'bad');
        return 100;
    }
    return num;
}

function autosaveScore(studentId, field, inputEl) {
    if (!currentSubject) return;
    const value = typeof inputEl === 'object' && inputEl ? inputEl.value : inputEl;
    const row = Object.assign({ classScore: '', examScore: '', totalScore: '', assessments: {} }, getScoreEntry(currentSubject, studentId));
    const num = clampPartMark(value, typeof inputEl === 'object' ? inputEl : null);
    row[field] = num;
    if (row.classScore !== '' && row.examScore !== '') {
        row.classScore50 = fifty(row.classScore);
        row.examScore50 = fifty(row.examScore);
        row.totalScore = totalScore(row.classScore, row.examScore);
        const g = getGrade(row.totalScore, currentClass);
        row.grade = g.grade;
        row.remark = g.remark;
    } else {
        row.classScore50 = fifty(row.classScore);
        row.examScore50 = fifty(row.examScore);
        row.totalScore = '';
        row.grade = '';
        row.remark = '';
    }
    putScoreEntry(currentSubject, studentId, row);
    refreshScoreRow(studentId);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        persistScores();
        syncScoresToResults();
        renderStats();
    }, 280);
}

function marksTemplateRows() {
    const list = classStudents();
    const subject = currentSubject || classSubjects()[0] || 'Mathematics';
    return (list.length ? list : [
        { name: 'Ama Mensah (SAMPLE)', class: currentClass || 'Class 6' },
        { name: 'Kofi Asante (SAMPLE)', class: currentClass || 'Class 6' },
        { name: 'Type student name here', class: currentClass || 'Class 6' }
    ]).map((s, i) => ({
        'Student Name': s.name,
        'Class': s.class || currentClass || 'Class 6',
        'Subject': subject,
        'Class Score (out of 100)': String(s.name || '').startsWith('Type') ? '' : 80,
        'Exam Score (out of 100)': String(s.name || '').startsWith('Type') ? '' : 90
    }));
}

function downloadBlobFile(content, filename, mime) {
    try {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename || 'download.pdf';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 3000);
        return true;
    } catch (err) {
        console.error('downloadBlobFile error:', err);
        return false;
    }
}

function downloadMarksTemplate() {
    const cls = currentClass || '';
    const subject = currentSubject || classSubjects()[0] || 'Mathematics';
    const url = '/api/templates/marks.xlsx?class=' + encodeURIComponent(cls) + '&subject=' + encodeURIComponent(subject);
    window.location.href = '/open?src=' + encodeURIComponent(url);
}

function parseCsvText(text) {
    if (window.OneRealFiles && OneRealFiles.parseCsv) return OneRealFiles.parseCsv(text);
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
    });
}

function applyImportedMarkRows(rows) {
    let n = 0;
    (rows || []).forEach(row => {
        const name = row['Student Name'] || row.Name;
        const subject = row.Subject || currentSubject;
        const cls = row.Class || currentClass;
        if (!name || !subject) return;
        let stu = students.find(s => s.name.toLowerCase() === String(name).toLowerCase() && s.class === cls);
        if (!stu) {
            stu = { id: Date.now() + Math.floor(Math.random() * 99), name, class: cls, status: 'active' };
            students.push(stu);
        }
        let cs = Number(row['Class Score (out of 100)'] ?? row['Class Score'] ?? row.ClassScore ?? 0);
        let es = Number(row['Exam Score (out of 100)'] ?? row['Exam Score'] ?? row.ExamScore ?? 0);
        if (isNaN(cs)) cs = 0;
        if (isNaN(es)) es = 0;
        if (cs > 100) cs = 100;
        if (cs < 0) cs = 0;
        if (es > 100) es = 100;
        if (es < 0) es = 0;
        const tot = totalScore(cs, es);
        const g = getGrade(tot);
        putScoreEntry(subject, stu.id, {
            classScore: cs, examScore: es,
            classScore50: fifty(cs), examScore50: fifty(es),
            totalScore: tot, grade: g.grade, remark: g.remark
        });
        n++;
    });
    persistStudents(); persistScores();
    toast('Imported ' + n + ' mark rows.', 'ok');
    renderScores();
}

function importMarks(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const fname = (file.name || '').toLowerCase();
    const reader = new FileReader();
    if (fname.endsWith('.csv')) {
        reader.onload = e => applyImportedMarkRows(parseCsvText(e.target.result));
        reader.readAsText(file);
    } else if (typeof XLSX !== 'undefined') {
        reader.onload = e => {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            applyImportedMarkRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
        };
        reader.readAsArrayBuffer(file);
    } else {
        toast('Import the CSV template, or wait for Excel support to load.', 'bad');
    }
    ev.target.value = '';
}

function studentPerf(id) {
    const items = [];
    allClassSubjects(currentClass).forEach(sub => {
        const e = getScoreEntry(sub, id);
        if (e && e.classScore !== '' && e.examScore !== '') {
            const tot = totalScore(e.classScore, e.examScore);
            const g = getGrade(tot, currentClass);
            items.push({ subject: sub, total: tot, grade: g.grade, remark: g.remark, cs: fifty(e.classScore), es: fifty(e.examScore) });
        }
    });
    if (!items.length) return null;
    const avg = items.reduce((a, b) => a + b.total, 0) / items.length;
    const og = getGrade(avg, currentClass);
    return { items, avg, grade: og.grade, remark: og.remark };
}

function renderBroadsheet() {
    const subs = allClassSubjects(currentClass);
    const list = classStudents().map(s => {
        const p = studentPerf(s.id);
        const map = {};
        subs.forEach(sub => {
            const e = getScoreEntry(sub, s.id);
            map[sub] = e && e.totalScore !== '' ? Number(e.totalScore) : null;
        });
        const sum = Object.values(map).reduce((a, b) => a + (b || 0), 0);
        return { s, map, sum, avg: p ? p.avg : 0 };
    }).sort((a, b) => b.sum - a.sum);
    list.forEach((row, i) => { row.rank = i + 1; });
    document.getElementById('tab-broadsheet').innerHTML = `
        <div class="card">
            <div class="actions" style="margin-bottom:10px;">
                <a class="btn btn-ghost btn-sm" id="exportBroadsheetBtn" href="/open?src=/api/export/broadsheet.xlsx"><i class="fas fa-file-excel"></i> Export Excel</a>
            </div>
            <div class="table-wrap"><table class="broadsheet">
                <thead><tr><th>Pos</th><th>Student</th>${subs.map(s => `<th>${esc(s.split(' ')[0])}</th>`).join('')}<th>Total</th><th>Avg</th></tr></thead>
                <tbody>
                    ${list.map(r => `<tr>
                        <td><span class="badge ${r.rank < 4 ? 'rank' + r.rank : ''}">${r.rank}</span></td>
                        <td class="name">${esc(r.s.name)}</td>
                        ${subs.map(sub => `<td>${r.map[sub] == null ? '—' : r.map[sub]}</td>`).join('')}
                        <td><strong>${r.sum.toFixed(0)}</strong></td>
                        <td>${r.avg ? r.avg.toFixed(1) : '—'}</td>
                    </tr>`).join('') || '<tr><td colspan="20">No students</td></tr>'}
                </tbody>
            </table></div>
        </div>`;
    const xb = document.getElementById('exportBroadsheetBtn');
    if (xb) xb.href = '/open?src=' + encodeURIComponent('/api/export/broadsheet.xlsx?class=' + encodeURIComponent(currentClass || ''));
}

function exportBroadsheet() {
    const url = '/api/export/broadsheet.xlsx?class=' + encodeURIComponent(currentClass || '');
    window.location.href = '/open?src=' + encodeURIComponent(url);
}

function renderReports() {
    loadAll();
    const list = classStudents();
    const approved = list.filter(s => isApproved(s.id)).length;
    document.getElementById('tab-reports').innerHTML = `
        <div class="card">
            <p class="hint">Preview anytime. Download individual reports or download class reports as a ZIP.</p>
            <div class="actions">
                <button class="btn btn-primary" onclick="generateClassReports()"><i class="fas fa-magic"></i> Refresh class reports</button>
                <button class="btn btn-ok" onclick="bulkDownload()"><i class="fas fa-file-archive"></i> Download class ZIP</button>
            </div>
            <div class="report-grid" style="margin-top:14px;">
                ${list.map(s => {
                    const p = studentPerf(s.id);
                    const rec = reportRecord(s.id);
                    const ok = isApproved(s.id);
                    let badgeHtml = '';
                    if (!rec) {
                        badgeHtml = '<span class="badge" style="background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1;"><i class="fas fa-file"></i> Not Generated</span>';
                    } else if (ok) {
                        badgeHtml = '<span class="badge ok"><i class="fas fa-check-circle"></i> Approved</span>';
                    } else {
                        badgeHtml = '<span class="badge wait"><i class="fas fa-clock"></i> Pending Approval</span>';
                    }
                    return `<div class="report-card">
                        <h4>${esc(s.name)}</h4>
                        <div class="muted">${p ? p.avg.toFixed(1) + '% · ' + p.grade : 'No complete scores'}</div>
                        <div style="margin-top:8px;">${badgeHtml}</div>
                        <div class="actions">
                            <button class="btn btn-ghost btn-sm" onclick="openRemarks('${s.id}')">Remarks</button>
                            <button class="btn btn-ghost btn-sm" onclick="previewReport('${s.id}')"><i class="fas fa-eye"></i> Preview</button>
                            <button class="btn btn-ok btn-sm" onclick="downloadReport('${s.id}')" ${ok ? '' : 'title="Admin approval required for official download"'}><i class="fas fa-download"></i> Download</button>
                        </div>
                    </div>`;
                }).join('') || '<div class="empty">Add students first.</div>'}
            </div>
        </div>`;
}

function generateClassReports() {
    const list = classStudents();
    if (!list.length) return toast('No students in this class.', 'bad');
    upsertPending(list);
    toast(list.length + ' reports queued. Admin must approve before download.', 'ok');
    renderReports();
    renderStats();
}

function calculateNextClass(currentClassName) {
    const raw = String(currentClassName || '').trim();
    if (!raw) return '';

    // 1. Check if next class exists in the admin classes collection
    const allClasses = loadJSON('classes', []).filter(c => c.status !== 'inactive');
    if (allClasses.length > 1) {
        const curIdx = allClasses.findIndex(c => c.name.toLowerCase() === raw.toLowerCase() || c.id === raw);
        if (curIdx >= 0 && curIdx + 1 < allClasses.length) {
            return allClasses[curIdx + 1].name;
        }
    }

    const lower = raw.toLowerCase();
    if (lower === 'creche' || lower === 'crèche' || lower === 'daycare') return 'Nursery 1';
    if (lower === 'nursery 1') return 'Nursery 2';
    if (lower === 'nursery 2' || lower === 'nursery') return 'KG 1';
    if (lower === 'kg 1' || lower === 'kindergarten 1') return 'KG 2';
    if (lower === 'kg 2' || lower === 'kindergarten 2' || lower === 'kg') return 'Basic 1';
    if (lower === 'basic 6' || lower === 'class 6' || lower === 'primary 6') return 'Basic 7';
    if (lower === 'jhs 1') return 'JHS 2';
    if (lower === 'jhs 2') return 'JHS 3';
    if (lower === 'jhs 3' || lower === 'basic 9') return 'SHS 1';

    // Regex numeric progression: "Basic 1" -> "Basic 2", "Class 3" -> "Class 4", "Grade 5" -> "Grade 6"
    const m = raw.match(/^(.*?)(\d+)(.*)$/);
    if (m) {
        const prefix = m[1];
        const num = parseInt(m[2], 10);
        const suffix = m[3];
        return `${prefix}${num + 1}${suffix}`;
    }

    return raw;
}

function onPromotionChange(id) {
    const s = students.find(x => String(x.id) === String(id));
    const promoEl = document.getElementById('rmPromo');
    const targetEl = document.getElementById('rmTarget');
    if (!promoEl || !targetEl) return;

    const status = promoEl.value;
    const currentCls = s?.class || currentClass || '';

    if (status === 'Promoted') {
        targetEl.value = calculateNextClass(currentCls);
    } else if (status === 'Repeated') {
        targetEl.value = currentCls;
    } else {
        targetEl.value = '';
    }
}

function openRemarks(id) {
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return;
    const d = studentReportDetails[id] || studentReportDetails[String(id)] || {};
    const attText = (typeof Attendance !== 'undefined' && Attendance.label(id)) || d.attendance || '—';
    const sid = String(id).replace(/'/g, "\\'");
    openModal(`<h3>Remarks — ${esc(s.name)}</h3>
        <div class="field"><label>Attendance</label><div class="readonly-box">${esc(attText)}</div>
            <p class="hint">Taken from the Attendance register. Only admin can change the "OUT OF" school days.</p></div>
        <div class="row">
            <div class="field"><label>Promotion</label>
                <select id="rmPromo" onchange="onPromotionChange('${sid}')">
                    <option value="">—</option>
                    <option ${d.promotionStatus === 'Promoted' ? 'selected' : ''}>Promoted</option>
                    <option ${d.promotionStatus === 'Repeated' ? 'selected' : ''}>Repeated</option>
                </select>
            </div>
            <div class="field"><label>To / in</label><input id="rmTarget" value="${esc(d.promotionTarget || '')}" placeholder="e.g. Basic 7"></div>
        </div>
        <div class="field"><label>Conduct</label><input id="rmConduct" value="${esc(d.conduct || '')}"></div>
        <div class="field"><label>Interest</label><input id="rmInterest" value="${esc(d.interest || '')}"></div>
        <div class="field"><label>Teacher remarks</label><textarea id="rmTeach" rows="3">${esc(d.teacherRemarks || '')}</textarea></div>
        <div class="actions">
            <button class="btn btn-ghost btn-sm" onclick="smartRemarks('${sid}')">Smart remarks</button>
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveRemarks('${sid}')">Save</button>
        </div>`);
}

function smartRemarks(id) {
    const p = studentPerf(String(id));
    if (!p) {
        toast('No scores entered yet. Enter scores first to generate smart remarks.', 'bad');
        return;
    }
    const s = students.find(x => String(x.id) === String(id));
    const currentCls = s?.class || currentClass || '';
    const avg = p.avg;
    const best = p.items.slice().sort((a, b) => b.total - a.total)[0];
    const weak = p.items.slice().sort((a, b) => a.total - b.total)[0];
    let teacher;
    if (avg >= 80) teacher = `An outstanding student who excels across subjects${best ? ', especially ' + best.subject : ''}. Keep up the excellent work!`;
    else if (avg >= 68) teacher = `Very good performance${best ? ' with notable strength in ' + best.subject : ''}. Continue to work diligently.`;
    else if (avg >= 54) teacher = `Satisfactory work overall. Extra attention and practice needed${weak ? ' in ' + weak.subject : ''} for further improvement.`;
    else if (avg >= 40) teacher = `Requires additional support, particularly${weak ? ' in ' + weak.subject : ''}. Regular study and teacher guidance are recommended.`;
    else teacher = `Needs significant improvement. Please seek extra tuition and parental support to build core concepts.`;
    
    const rmTeach = document.getElementById('rmTeach');
    const rmConduct = document.getElementById('rmConduct');
    const rmInterest = document.getElementById('rmInterest');
    const rmPromo = document.getElementById('rmPromo');
    const rmTarget = document.getElementById('rmTarget');

    if (rmTeach) rmTeach.value = teacher;
    if (rmConduct) rmConduct.value = avg >= 70 ? 'Very well behaved and courteous' : avg >= 50 ? 'Generally well-behaved and cooperative' : 'Needs to improve conduct and participation';
    if (rmInterest) rmInterest.value = best ? best.subject : 'Shows interest in class activities';
    
    if (rmPromo && rmTarget) {
        if (avg >= 45) {
            rmPromo.value = 'Promoted';
            rmTarget.value = calculateNextClass(currentCls);
        } else {
            rmPromo.value = 'Repeated';
            rmTarget.value = currentCls;
        }
    }
}

function saveRemarks(id) {
    const sid = String(id);
    studentReportDetails[sid] = {
        attendance: (typeof Attendance !== 'undefined' && Attendance.label(id)) || (studentReportDetails[sid] || studentReportDetails[id] || {}).attendance || '',
        promotionStatus: document.getElementById('rmPromo').value,
        promotionTarget: document.getElementById('rmTarget').value.trim(),
        conduct: document.getElementById('rmConduct').value.trim(),
        interest: document.getElementById('rmInterest').value.trim(),
        teacherRemarks: document.getElementById('rmTeach').value.trim()
    };
    // Keep numeric key as well for legacy compatibility
    if (!isNaN(Number(id))) studentReportDetails[Number(id)] = studentReportDetails[sid];
    persistDetails();
    closeModal();
    toast('Remarks saved.', 'ok');
}

// ── Unified report HTML generator (same layout across Admin / Teacher / Student) ──
function buildUnifiedReportHTML(id) {
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return '';
    const d = studentReportDetails[id] || studentReportDetails[String(id)] || {};
    const className = s.class || currentClass || 'Class';
    const subs = allClassSubjects(className);
    const logo = schoolLogoSrc();
    const settings = schoolSettings || {};
    const logoEl = logo
        ? `<img src="${logo}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo" crossorigin="anonymous">`
        : `<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>`;

    const scale = typeof gradeScale === 'function' ? gradeScale(className) : DEFAULT_GRADES;
    const jhsKeywords = ['basic 7','basic 8','basic 9','jhs 1','jhs 2','jhs 3','jhs'];
    const isJHS = jhsKeywords.some(k => String(className).toLowerCase().includes(k));

    function getEffectiveGrade(tot) {
        return getGrade(tot, className);
    }

    let totalScoreSum = 0, scoredCount = 0;
    const subjectRows = [];
    const jhsSubjectResults = [];

    (subs || []).forEach(sub => {
        const e = getScoreEntry(sub, id);
        if (e && e.classScore !== '' && e.examScore !== '') {
            const cs50 = fifty(e.classScore);
            const es50 = fifty(e.examScore);
            const tot = e.totalScore !== undefined && e.totalScore !== '' ? Number(e.totalScore) : (Number(cs50) + Number(es50));
            const g = getEffectiveGrade(tot);
            totalScoreSum += tot; scoredCount++;
            jhsSubjectResults.push({ sub, tot, grade: Number(g.grade) || 0 });
            subjectRows.push(`<tr>
                <td style="text-align:left;font-weight:600;padding:8px 10px;border:1px solid #cbd5e1;">${esc(sub)}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${cs50}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${es50}</td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;"><strong>${tot}</strong></td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:rgba(79,70,229,.1);color:#4338ca;">${g.grade}</span></td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${g.remark}</td>
            </tr>`);
        } else {
            jhsSubjectResults.push({ sub, tot: null, grade: 99 });
            subjectRows.push(`<tr>
                <td style="text-align:left;color:#94a3b8;padding:8px 10px;border:1px solid #cbd5e1;">${esc(sub)}</td>
                <td colspan="5" style="padding:8px 10px;border:1px solid #cbd5e1;color:#94a3b8;font-style:italic;">No scores entered</td>
            </tr>`);
        }
    });

    const avg = scoredCount > 0 ? totalScoreSum / scoredCount : 0;
    const overallGrade = getEffectiveGrade(avg);
    const yr = schoolInfo.academicYear || '';
    const tm = termHeading();

    // JHS Aggregate: 4 core subjects + 2 best electives
    let jhsAggregateHTML = '';
    if (isJHS) {
        const allSubjects = loadJSON('subjects', []);
        const adminCoreNames = new Set(
            allSubjects.filter(s => s.isCore).map(s => String(s.name || '').toLowerCase())
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
        const totalAgg = allAgg.reduce((s, r) => s + (Number(r.grade) || 0), 0);
        const aggSubjects = allAgg.map(r => `${esc(r.sub)}: Grade ${r.grade}`).join(' | ');
        const coreLabel = useFallback ? 'Core (keyword match)' : `Core (${coreResults.length}/4)`;
        jhsAggregateHTML = `
        <div style="background:#1e1b4b;color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">JHS TOTAL AGGREGATE</div>
            <div style="font-size:22px;font-weight:800;letter-spacing:-1px;">${totalAgg} <span style="font-size:13px;font-weight:400;opacity:0.75;"></span></div>
            <div style="font-size:11px;margin-top:4px;opacity:0.85;">${aggSubjects || 'No graded subjects yet'}</div>
            <div style="font-size:10.5px;margin-top:4px;opacity:0.65;">${coreLabel} + Best ${bestTwo.length} Elective(s)</div>
            ${allAgg.length < 6 ? '<div style="font-size:11px;margin-top:4px;color:#fbbf24;">⚠ Not all 6 aggregate subjects have scores</div>' : ''}
        </div>`;
    }

    return `
    <div id="printableReportCard" style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',Arial,sans-serif;max-width:800px;margin:0 auto;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #4f46e5;padding-bottom:14px;margin-bottom:18px;">
            ${logoEl}
            <div style="text-align:center;flex:1;padding:0 12px;">
                <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;letter-spacing:-0.5px;">${esc(settings.schoolName || schoolName())}</h2>
                <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${esc(settings.address || '')}</p>
                <p style="font-size:11.5px;color:#4f46e5;font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${esc(settings.motto || 'Drink deep or taste not the spring of knowledge')}&rdquo;</em></p>
                <div style="display:inline-block;background:#4f46e5;color:#fff;font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:0.5px;">
                    END OF ${esc(String(tm).toUpperCase())} REPORT SHEET
                </div>
            </div>
            ${logoEl}
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;background:#f8fafc;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;border:1px solid #e2e8f0;">
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">NAME OF LEARNER</span><strong>${esc(s.name)}</strong></div>
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">CLASS</span><strong>${esc(className)}</strong></div>
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">ACADEMIC YEAR</span><strong>${esc(yr)}</strong></div>
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">TERM</span><strong>${esc(tm)}</strong></div>
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">DATE OF VACATION</span><strong>${esc(schoolInfo.closingDate || '—')}</strong></div>
            <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">RE-OPENING DATE</span><strong>${esc(schoolInfo.reopeningDate || '—')}</strong></div>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;text-align:center;">
            <thead>
                <tr style="background:#4f46e5;color:#fff;">
                    <th style="padding:8px 10px;text-align:left;border:1px solid #4338ca;">SUBJECT</th>
                    <th style="padding:8px 10px;border:1px solid #4338ca;">CLASS 50%</th>
                    <th style="padding:8px 10px;border:1px solid #4338ca;">EXAM 50%</th>
                    <th style="padding:8px 10px;border:1px solid #4338ca;">TOTAL 100%</th>
                    <th style="padding:8px 10px;border:1px solid #4338ca;">GRADE</th>
                    <th style="padding:8px 10px;border:1px solid #4338ca;">REMARKS</th>
                </tr>
            </thead>
            <tbody>${subjectRows.join('') || '<tr><td colspan="6" style="padding:16px;color:#94a3b8;">No subjects assigned</td></tr>'}</tbody>
        </table>

        ${jhsAggregateHTML}

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;background:#eef2ff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;border:1px solid #c7d2fe;">
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">OVERALL GRADE</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount ? overallGrade.grade + ' (' + overallGrade.remark + ')' : '—'}</strong></div>
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount} / ${subs.length}</strong></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:12.5px;">
            <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Attendance:</span> ${esc(attendanceLabel(id, d))}</div>
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Conduct:</span> ${esc(d.conduct || '—')}</div>
                <div><span style="color:#64748b;font-weight:600;">Interest:</span> ${esc(d.interest || '—')}</div>
            </div>
            <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Promoted to / In:</span> ${esc(d.promotionTarget || (d.promotionStatus || '—'))}</div>
                <div><span style="color:#64748b;font-weight:600;">Teacher's Remarks:</span> <em>${esc(d.teacherRemarks || '—')}</em></div>
            </div>
        </div>

        <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569;">
            <div><strong>Class Teacher:</strong> ${esc(classTeacherName(className) || '—')}</div>
            <div><strong>Headteacher:</strong> ${esc(headTeacherName() || '—')}</div>
        </div>
    </div>`;
}

function reportHTML(id) {
    return buildUnifiedReportHTML(id);
}

let currentPreviewReportStudentId = null;

function previewReport(id) {
    loadAll();
    currentPreviewReportStudentId = String(id);
    const html = buildUnifiedReportHTML(id);
    if (!html) {
        toast('Could not find student data for preview.', 'bad');
        return;
    }
    const body = document.getElementById('previewBody');
    if (body) body.innerHTML = html;
    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.zIndex = '99999';
    }
}

function closePreview() {
    const modal = document.getElementById('previewModal');
    if (modal) modal.style.display = 'none';
}

function printTeacherPreview() {
    const card = document.getElementById('printableReportCard') || document.getElementById('previewBody');
    if (!card) return toast('No report loaded to print.', 'bad');
    const win = window.open('', '_blank', 'width=900,height=750');
    if (!win) {
        toast('Pop-up blocked. Please allow pop-ups for printing.', 'bad');
        return;
    }
    win.document.write(`<!DOCTYPE html><html><head><title>Student Report Sheet</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>body{margin:20px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table th,table td{border:1px solid #cbd5e1;}</style>
    </head><body>${card.outerHTML || card.innerHTML}<script>window.onload=function(){window.print();};<\/script></body></html>`);
    win.document.close();
}

function downloadPreviewReport() {
    if (currentPreviewReportStudentId) {
        downloadReport(currentPreviewReportStudentId);
    } else {
        toast('No preview selected.', 'bad');
    }
}

function generatePdfBlob(id) {
    return new Promise(async (resolve, reject) => {
        let container = null;
        try {
            const s = students.find(x => String(x.id) === String(id));
            if (!s) return reject(new Error('Student record not found in active class'));

            const reportMarkup = buildUnifiedReportHTML(id);
            if (!reportMarkup) return reject(new Error('No report content could be generated'));

            const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;

            // 1. Primary path: html2canvas + jsPDF with a 2.0-second timeout guard
            if (typeof html2canvas !== 'undefined' && jsPDFConstructor) {
                try {
                    container = document.createElement('div');
                    container.id = 'tempPdfRenderContainer';
                    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;z-index:-9999;';
                    container.innerHTML = reportMarkup;
                    document.body.appendChild(container);

                    await new Promise(r => setTimeout(r, 40));

                    const targetEl = container.querySelector('#printableReportCard') || container.firstElementChild || container;
                    const canvasPromise = html2canvas(targetEl, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff'
                    });
                    const canvas = await Promise.race([
                        canvasPromise,
                        new Promise((_, rej) => setTimeout(() => rej(new Error('html2canvas timeout')), 2000))
                    ]);
                    if (container && container.parentNode) document.body.removeChild(container);
                    container = null;

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
                    resolve(doc.output('blob'));
                    return;
                } catch (canvasErr) {
                    console.warn('html2canvas render fallback:', canvasErr);
                } finally {
                    if (container && container.parentNode) {
                        document.body.removeChild(container);
                        container = null;
                    }
                }
            }

            // 2. Secondary fallback: structured jsPDF document
            if (jsPDFConstructor) {
                const doc = new jsPDFConstructor('p', 'pt', 'a4');
                const W = doc.internal.pageSize.getWidth();
                const margin = 40;
                let y = 48;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(79, 70, 229);
                doc.text((schoolSettings.schoolName || schoolName()).toUpperCase(), W / 2, y, { align: 'center' }); y += 16;
                doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
                doc.text(schoolSettings.address || '', W / 2, y, { align: 'center' }); y += 14;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
                doc.text('END OF ' + termHeading().toUpperCase() + ' REPORT SHEET', W / 2, y, { align: 'center' }); y += 22;
                doc.setFontSize(10); doc.setFont('helvetica', 'normal');
                doc.text('Name: ' + (s.name || ''), margin, y);
                doc.text('Class: ' + (s.class || currentClass) + '   Term ' + (schoolInfo.term || ''), W / 2, y); y += 14;
                doc.text('Year: ' + (schoolInfo.academicYear || ''), margin, y);
                doc.text('Number on Roll: ' + classStudents().length, W / 2, y); y += 18;

                const d = studentReportDetails[id] || studentReportDetails[String(id)] || {};
                const p = studentPerf(id);
                const cols = [140, 65, 65, 55, 50, 140];
                const heads = ['SUBJECT', 'CLASS 50%', 'EXAM 50%', 'TOTAL', 'GRADE', 'REMARK'];
                doc.setFillColor(79, 70, 229); doc.rect(margin, y, cols.reduce((a, b) => a + b, 0), 18, 'F');
                doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
                let x = margin;
                heads.forEach((h, i) => { doc.text(h, x + 4, y + 12); x += cols[i]; });
                y += 18; doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20);
                const subs = allClassSubjects(s.class || currentClass);
                subs.forEach((sub, ri) => {
                    const e = getScoreEntry(sub, id);
                    let vals = [sub, '—', '—', '—', '—', 'No scores'];
                    if (e && e.classScore !== '' && e.examScore !== '') {
                        const tot = totalScore(e.classScore, e.examScore);
                        const g = getGrade(tot, s.class || currentClass);
                        vals = [sub, String(fifty(e.classScore)), String(fifty(e.examScore)), String(tot), g.grade, g.remark];
                    }
                    if (ri % 2) { doc.setFillColor(248, 250, 252); doc.rect(margin, y, cols.reduce((a, b) => a + b, 0), 16, 'F'); }
                    x = margin;
                    vals.forEach((v, i) => { doc.text(String(v).slice(0, 24), x + 4, y + 12); x += cols[i]; });
                    y += 16;
                });
                y += 14;
                if (p) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Average: ' + p.avg.toFixed(1) + '%   Overall: ' + p.grade + ' ' + p.remark, margin, y); y += 16;
                }
                doc.setFont('helvetica', 'normal');
                doc.text('Attendance: ' + ((typeof Attendance !== 'undefined' && Attendance.label(id)) || d.attendance || '—'), margin, y); y += 14;
                if (d.promotionStatus) { doc.text(d.promotionStatus + ' to/in: ' + (d.promotionTarget || ''), margin, y); y += 14; }
                doc.text('Conduct: ' + (d.conduct || '—'), margin, y); y += 14;
                doc.text('Interest: ' + (d.interest || '—'), margin, y); y += 14;
                const rem = doc.splitTextToSize('Teacher: ' + (d.teacherRemarks || '—'), W - margin * 2);
                doc.text(rem, margin, y); y += rem.length * 12 + 16;
                doc.text('Class teacher: ' + (classTeacherName(s.class) || '_______________'), margin, y);
                doc.text('Headteacher: ' + (headTeacherName() || '_______________'), W / 2, y);
                resolve(doc.output('blob'));
                return;
            }

            // 3. Fallback: Standalone HTML Document Blob
            const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${s.name || 'Report'}</title><style>body{margin:20px;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5e1;padding:6px;}</style></head><body>${reportMarkup}</body></html>`;
            resolve(new Blob([fullHtml], { type: 'text/html' }));
        } catch (err) {
            if (container && container.parentNode) document.body.removeChild(container);
            reject(err);
        }
    });
}

async function downloadReport(id) {
    loadAll();
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return toast('Student record not found.', 'bad');
    if (window.OneRealFiles) OneRealFiles.arm();
    toast('Generating PDF...', 'ok');
    try {
        const blob = await generatePdfBlob(id);
        const isHtml = blob.type === 'text/html';
        const name = (String(s.name || 'student').replace(/[^a-z0-9]/gi, '_')) + (isHtml ? '_report.html' : '_report.pdf');
        await downloadBlobFile(blob, name, isHtml ? 'text/html' : 'application/pdf');
        toast('Report downloaded.', 'ok');
    } catch (e) {
        console.warn('Direct PDF export encountered an issue, opening print sheet:', e);
        previewReport(id);
        setTimeout(() => { printTeacherPreview(); }, 350);
    }
}

async function bulkDownload() {
    const list = classStudents();
    if (!list.length) return toast('No students in this class.', 'bad');
    if (window.OneRealFiles) OneRealFiles.arm();
    if (typeof JSZip === 'undefined') return toast('ZIP library missing.', 'bad');
    toast('Preparing class reports ZIP...', 'ok');
    const zip = new JSZip();
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        try {
            toast(`Building report ${i + 1} of ${list.length}...`, 'ok');
            const blob = await generatePdfBlob(s.id);
            const isHtml = blob.type === 'text/html';
            const fname = (String(s.name || 'student').replace(/[^a-z0-9]/gi, '_')) + (isHtml ? '_report.html' : '_report.pdf');
            zip.file(fname, blob);
            count++;
        } catch (e) {
            console.warn('Skipping student PDF in bulk:', s.id, e);
            // Fallback to HTML string in zip
            try {
                const markup = buildUnifiedReportHTML(s.id);
                if (markup) {
                    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${s.name}</title></head><body>${markup}</body></html>`;
                    const fname = (String(s.name || 'student').replace(/[^a-z0-9]/gi, '_')) + '_report.html';
                    zip.file(fname, fullHtml);
                    count++;
                }
            } catch (err2) {}
        }
    }
    if (!count) return toast('No reports could be built.', 'bad');
    toast('Compiling ZIP archive...', 'ok');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const name = (currentClass || 'class').replace(/\s/g, '_') + '_reports.zip';
    await downloadBlobFile(zipBlob, name, 'application/zip');
    toast(`Downloaded ${count} report(s) in ZIP successfully!`, 'ok');
}

function renderPerformance() {
    const rows = classStudents().map(s => {
        const p = studentPerf(s.id);
        return { s, avg: p ? p.avg : 0, grade: p ? p.grade : '—', remark: p ? p.remark : 'No scores' };
    }).sort((a, b) => b.avg - a.avg);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const withScores = rows.filter(r => r.avg);
    const classAvg = withScores.length ? (withScores.reduce((a, b) => a + b.avg, 0) / withScores.length) : 0;
    document.getElementById('tab-performance').innerHTML = `
        <div class="card">
            <div class="stats-row">
                <div class="stat"><b>${withScores.length}</b><span>Ranked</span></div>
                <div class="stat"><b>${classAvg.toFixed(1)}%</b><span>Class average</span></div>
            </div>
            <div class="actions" style="margin-bottom:10px;">
                <a class="btn btn-ghost btn-sm" id="exportPerformanceBtn" href="/open?src=/api/export/performance.xlsx"><i class="fas fa-file-excel"></i> Export Excel</a>
            </div>
            <div class="table-wrap"><table class="score-table">
                <thead><tr><th>Rank</th><th>Student</th><th>Average</th><th>Grade</th><th>Level</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${r.rank}</td><td>${esc(r.s.name)}</td>
                    <td>${r.avg ? r.avg.toFixed(1) + '%' : '—'}</td>
                    <td>${esc(r.grade)}</td><td>${esc(r.remark)}</td>
                </tr>`).join('')}</tbody>
            </table></div>
        </div>`;
    const xp = document.getElementById('exportPerformanceBtn');
    if (xp) xp.href = '/open?src=' + encodeURIComponent('/api/export/performance.xlsx?class=' + encodeURIComponent(currentClass || ''));
}

function exportPerformance() {
    const rows = classStudents().map(s => {
        const p = studentPerf(s.id);
        return {
            Student: s.name,
            Class: s.class || currentClass,
            Average: p ? Number(p.avg.toFixed(1)) : '',
            Grade: p ? p.grade : '',
            Level: p ? p.remark : 'No scores'
        };
    });
    const csv = window.OneRealFiles ? OneRealFiles.toCsv(rows) : JSON.stringify(rows);
    const name = (currentClass || 'class').replace(/\s/g, '_') + '_performance.csv';
    downloadBlobFile(csv, name, 'text/csv;charset=utf-8');
    toast('Spreadsheet is ready. Use Save Excel or Copy table.', 'ok');
}

function renderWhatsApp() {
    document.getElementById('tab-whatsapp').innerHTML = `
        <div class="card">
            <p class="hint">Sharing is only allowed after admin approval. Use country code, e.g. +233…</p>
            <div class="list">
                ${classStudents().map(s => {
                    const p = parentContacts[s.id] || {};
                    const ok = isApproved(s.id);
                    return `<div class="list-item">
                        <div>
                            <strong>${esc(s.name)}</strong>
                            <div class="muted">${esc(p.name || 'No parent saved')} · ${esc(p.phone || '')}</div>
                            <span class="badge ${ok ? 'ok' : 'wait'}">${ok ? 'Approved' : 'Locked'}</span>
                        </div>
                        <div class="actions">
                            <button class="btn btn-ghost btn-sm" onclick="editParent('${s.id}')">Parent</button>
                            <button class="btn btn-wa btn-sm" ${ok && p.phone ? '' : 'disabled'} onclick="sendWa('${s.id}')">Send</button>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function editParent(id) {
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return;
    const p = parentContacts[id] || parentContacts[String(id)] || {};
    openModal(`<h3>Parent — ${esc(s.name)}</h3>
        <div class="field"><label>Name</label><input id="pName" value="${esc(p.name || '')}"></div>
        <div class="field"><label>WhatsApp</label><input id="pPhone" value="${esc(p.phone || '+233')}"></div>
        <div class="actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveParent('${id}')">Save</button></div>`);
}
function saveParent(id) {
    parentContacts[id] = { name: document.getElementById('pName').value.trim(), phone: document.getElementById('pPhone').value.trim(), sent: false };
    persistParents();
    closeModal();
    renderWhatsApp();
    toast('Parent saved.', 'ok');
}
function sendWa(id) {
    if (!isApproved(id)) return toast('Not approved yet.', 'bad');
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return;
    const p = parentContacts[id] || parentContacts[String(id)];
    if (!p?.phone) return toast('Add a parent number first.', 'bad');
    const perf = studentPerf(id);
    const msg = encodeURIComponent(
        schoolName() + ' — End of Term Report\n' +
        s.name + ' (' + s.class + ')\n' +
        (perf ? 'Average: ' + perf.avg.toFixed(1) + '%  Grade: ' + perf.grade : 'Scores on file') +
        '\nPlease collect the official PDF from the school / teacher.'
    );
    window.open('https://wa.me/' + p.phone.replace(/\D/g, '') + '?text=' + msg, '_blank');
}


function attendanceActor() {
    return sessionStorage.getItem('teacherEmail') || 'teacher';
}

function attendanceLabel(id, details) {
    if (typeof Attendance !== 'undefined') {
        const text = Attendance.label(id);
        if (text) return text;
    }
    return (details && details.attendance) || '—';
}

function clampAttendanceDate(raw) {
    const today = Attendance.todayISO();
    let date = raw || today;
    if (Attendance.isFuture(date)) {
        toast('You cannot mark a date after today.', 'bad');
        date = today;
    }
    if (Attendance.isWeekend(date)) {
        toast('Weekends are not school days.', 'bad');
        const d = new Date(date + 'T12:00:00');
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        date = y + '-' + m + '-' + day;
        if (date > today) date = today;
    }
    return date;
}

function renderAttendance() {
    if (typeof Attendance === 'undefined') {
        document.getElementById('tab-attendance').innerHTML = '<div class="card"><p class="hint">Attendance module failed to load.</p></div>';
        return;
    }
    Attendance.load();
    const today = Attendance.todayISO();
    const dateEl = document.getElementById('attDate');
    const date = clampAttendanceDate(dateEl ? dateEl.value : today);
    const list = classStudents();
    const sum = Attendance.summaryForClass(list, date);
    const days = Attendance.schoolDaysInTerm();
    const win = Attendance.termWindow();
    document.getElementById('tab-attendance').innerHTML = `
        <div class="card">
            <p class="hint">Mark who is in school today. The report prints <strong>days present OUT OF school days</strong> (weekdays only). Future dates are blocked.</p>
            <div class="att-toolbar">
                <div class="field"><label>Date</label>
                    <input type="date" id="attDate" max="${esc(today)}" value="${esc(date)}">
                </div>
                <button type="button" class="btn btn-ok btn-sm" id="attAllPresent"><i class="fas fa-check"></i> All present</button>
                <button type="button" class="btn btn-ghost btn-sm danger" id="attAllAbsent">All absent</button>
                <button type="button" class="btn btn-ghost btn-sm" id="attClearDay">Clear day</button>
                <a class="btn btn-ghost btn-sm" href="/open?src=/api/export/attendance.xlsx"><i class="fas fa-file-excel"></i> Export Excel</a>
            </div>
            <div class="att-summary">
                <span class="att-pill">${sum.present} present</span>
                <span class="att-pill">${sum.late} late</span>
                <span class="att-pill">${sum.absent} absent</span>
                <span class="att-pill">${sum.unmarked} unmarked</span>
                <span class="att-pill">School days this term: ${days || 'set by admin'}</span>
                ${win.start ? `<span class="att-pill">${esc(win.start)} → ${esc(win.end || today)}</span>` : ''}
            </div>
            <div class="table-wrap"><table class="score-table">
                <thead><tr><th>Student</th><th>Status</th><th>Mark</th><th>On report</th></tr></thead>
                <tbody>
                    ${list.map(s => {
                        const m = Attendance.getDay(s.id, date);
                        const st = m ? m.status : '';
                        return `<tr>
                            <td>${esc(s.name)}</td>
                            <td>${st ? `<span class="badge ${st === 'absent' ? 'wait' : 'ok'}">${st}</span>` : '<span class="muted">—</span>'}</td>
                            <td><div class="att-mark">
                                <button type="button" class="att-btn ${st === 'present' ? 'on-present' : ''}" data-att-id="${s.id}" data-att-status="present">Present</button>
                                <button type="button" class="att-btn ${st === 'late' ? 'on-late' : ''}" data-att-id="${s.id}" data-att-status="late">Late</button>
                                <button type="button" class="att-btn ${st === 'absent' ? 'on-absent' : ''}" data-att-id="${s.id}" data-att-status="absent">Absent</button>
                            </div></td>
                            <td><strong>${esc(Attendance.label(s.id) || '—')}</strong></td>
                        </tr>`;
                    }).join('') || '<tr><td colspan="4">No students in this class.</td></tr>'}
                </tbody>
            </table></div>
        </div>`;
    const picker = document.getElementById('attDate');
    if (picker) picker.addEventListener('change', () => renderAttendance());
    const allP = document.getElementById('attAllPresent');
    const allA = document.getElementById('attAllAbsent');
    const allC = document.getElementById('attClearDay');
    if (allP) allP.addEventListener('click', () => teacherMarkAll('present'));
    if (allA) allA.addEventListener('click', () => teacherMarkAll('absent'));
    if (allC) allC.addEventListener('click', () => teacherMarkAll(''));
    document.querySelectorAll('[data-att-id]').forEach(btn => {
        btn.addEventListener('click', () => teacherMark(btn.getAttribute('data-att-id'), btn.getAttribute('data-att-status')));
    });
}

function exportAttendance() {
    window.location.href = '/open?src=' + encodeURIComponent('/api/export/attendance.xlsx');
}

function teacherMark(id, status) {
    if (typeof Attendance === 'undefined') return toast('Attendance is not loaded.', 'bad');
    const date = clampAttendanceDate(document.getElementById('attDate')?.value);
    const current = Attendance.getDay(id, date);
    const next = current && current.status === status ? '' : status;
    const res = Attendance.mark(id, date, next, { className: currentClass, by: attendanceActor() });
    if (!res.ok) return toast(res.error, 'bad');
    toast(next ? (next + ' saved') : 'Mark cleared', 'ok');
    renderAttendance();
    renderStats();
}

function teacherMarkAll(status) {
    if (typeof Attendance === 'undefined') return toast('Attendance is not loaded.', 'bad');
    const date = clampAttendanceDate(document.getElementById('attDate')?.value);
    const list = classStudents();
    if (!list.length) return toast('No students in this class.', 'bad');
    const res = Attendance.markMany(list, date, status, { className: currentClass, by: attendanceActor() });
    if (!res.ok) return toast(res.error, 'bad');
    toast(status ? ('Marked all ' + list.length + ' students ' + status) : ('Cleared ' + list.length + ' marks for this day'), 'ok');
    renderAttendance();
}

function infoCell(label, value, emptyHint) {
    const v = String(value == null ? '' : value).trim();
    return `<div class="info-cell">
        <label>${esc(label)}</label>
        <div class="${v ? '' : 'empty-val'}">${esc(v || emptyHint || 'Not set by admin')}</div>
    </div>`;
}

function renderInfo() {
    loadAll();
    const teacher = classTeacherName(currentClass);
    const logo = schoolLogoSrc();
    const cls = classRecord(currentClass);
    document.getElementById('tab-info').innerHTML = `
        <div class="card">
            <p class="hint">This snapshot is set by admin. Teachers cannot change school, calendar, logo, headteacher, or class-teacher assignment.</p>
            <div class="info-grid">
                ${infoCell('Class', currentClass)}
                ${infoCell('Class teacher', teacher, 'Admin has not assigned a class teacher')}
                ${infoCell('Headteacher', headTeacherName(), 'Set in Admin → School Settings or a Headteacher staff record')}
                ${infoCell('Academic year', schoolInfo.academicYear, 'Set the active year in Admin → Academic Years')}
                ${infoCell('Term', termHeading(), 'Set the active term in Admin → Academic Years')}
                ${infoCell('Vacation / closing', schoolInfo.closingDate, 'Set in Admin → School Settings')}
                ${infoCell('Re-opening', schoolInfo.reopeningDate, 'Set in Admin → School Settings')}
                ${infoCell('Number on roll', String(classStudents().length))}
                ${infoCell('Term school days', (typeof Attendance !== 'undefined' && Attendance.defaultDays()) ? String(Attendance.defaultDays()) : '', 'Set by admin in Attendance')}
                ${infoCell('School', schoolName())}
                ${infoCell('Motto', schoolSettings.motto || '')}
                ${infoCell('Address', schoolSettings.address || '')}
                ${infoCell('Phone', schoolSettings.phone || '')}
            </div>
            <div class="field" style="margin-top:16px;">
                <label>School logo</label>
                <div class="logo-box">${logo ? `<img src="${logo}" alt="">` : 'No logo uploaded'}</div>
            </div>
            <p class="hint" style="margin-top:14px;">
                To change the class teacher, admin assigns a teacher to <strong>${esc(currentClass)}</strong>
                under Admin → Classes. The printed name always follows that teacher’s profile
                ${cls?.classTeacherId ? ' (currently linked).' : '.'}
            </p>
        </div>`;
}

function openModal(html) {
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modal').style.display = 'flex';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

function toggleDark() {
    document.body.classList.toggle('dark');
    localStorage.setItem('teacherDark', document.body.classList.contains('dark') ? '1' : '0');
}

document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('teacherDark') === '1') document.body.classList.add('dark');
    loadAll();

    const isUnlocked = sessionStorage.getItem('teacherUnlocked') === 'true';
    const teacherEmail = sessionStorage.getItem('teacherEmail');

    if (isUnlocked && teacherEmail) {
        await openApp();
    } else {
        document.getElementById('app').style.display = 'none';
        document.getElementById('teacherAuthOverlay').style.display = 'flex';
    }
});

window.addEventListener('storage', (e) => {
    if (['reports', 'scores', 'results', 'students', 'classes', 'subjects', 'schoolSettings', 'schoolInfo'].includes(e.key)) {
        loadAll();
        if (typeof currentTab !== 'undefined') {
            if (currentTab === 'reports') renderReports();
            else if (currentTab === 'scores') { renderScoresTable(); renderStats(); }
            else if (currentTab === 'broadsheet') renderBroadsheet();
        }
    }
});

