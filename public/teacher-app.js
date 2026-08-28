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
    if (typeof applySystemTheme === 'function') {
        applySystemTheme(schoolSettings);
    }
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
    return loadJSON('teachers', []).find(t => String(t.id) === String(id) || String(t.userId) === String(id)) || null;
}
function currentTeacherRecord() {
    const email = (sessionStorage.getItem('teacherEmail') || '').toLowerCase();
    const name = sessionStorage.getItem('teacherName') || '';
    const teachers = loadJSON('teachers', []);
    if (email) {
        const byEmail = teachers.find(t => (t.email || '').toLowerCase() === email && t.status !== 'deleted' && !t.isDeleted);
        if (byEmail) return byEmail;
    }
    if (name) {
        const byName = teachers.find(t => t.name && t.name.toLowerCase() === name.toLowerCase() && t.status !== 'deleted' && !t.isDeleted);
        if (byName) return byName;
    }
    return null;
}
function classTeacherRecord(className) {
    const cls = classRecord(className || currentClass);
    const teachers = loadJSON('teachers', []);
    if (cls && cls.classTeacherId) {
        const assigned = teachers.find(t => (String(t.id) === String(cls.classTeacherId) || String(t.userId) === String(cls.classTeacherId)) && t.status !== 'deleted' && !t.isDeleted && t.status !== 'inactive');
        if (assigned) return assigned;
    }
    if (cls) {
        const matching = teachers.find(t =>
            t.status !== 'deleted' && !t.isDeleted && t.status !== 'inactive' &&
            (String(t.classTeacherOf) === String(cls.id) || String(t.classTeacherOf) === String(cls.name) ||
             (t.role === 'Class Teacher' && Array.isArray(t.assignedClasses) && (t.assignedClasses.includes(cls.id) || t.assignedClasses.includes(cls.name))))
        );
        if (matching) return matching;
    }
    const cur = currentTeacherRecord();
    return cur || null;
}
function classTeacherName(className) {
    const cls = classRecord(className || currentClass);
    if (!cls) {
        const cur = currentTeacherRecord();
        return cur?.name || '';
    }
    // Explicit assigned teacher via classTeacherId
    if (cls.classTeacherId) {
        const assigned = teacherById(cls.classTeacherId);
        if (assigned && assigned.name && assigned.status !== 'deleted' && !assigned.isDeleted) {
            return assigned.name;
        }
    }
    // Check teachers list for classTeacherOf or assignedClasses
    const teachers = loadJSON('teachers', []);
    const matching = teachers.find(t =>
        t.status !== 'deleted' && !t.isDeleted && t.status !== 'inactive' &&
        (String(t.classTeacherOf) === String(cls.id) || String(t.classTeacherOf) === String(cls.name) ||
         (t.role === 'Class Teacher' && Array.isArray(t.assignedClasses) && (t.assignedClasses.includes(cls.id) || t.assignedClasses.includes(cls.name))))
    );
    if (matching && matching.name) return matching.name;
    if (cls.classTeacherName) return cls.classTeacherName;
    const cur = currentTeacherRecord();
    if (cur?.name) return cur.name;
    return '';
}
function classTeacherSignatureSrc(className) {
    const cls = classRecord(className || currentClass);
    const teachers = loadJSON('teachers', []);
    let t = null;
    if (cls && cls.classTeacherId) {
        t = teachers.find(x => (String(x.id) === String(cls.classTeacherId) || String(x.userId) === String(cls.classTeacherId)) && x.status !== 'deleted' && !x.isDeleted);
    }
    if (!t && cls) {
        t = teachers.find(x =>
            x.status !== 'deleted' && !x.isDeleted && x.status !== 'inactive' &&
            (String(x.classTeacherOf) === String(cls.id) || String(x.classTeacherOf) === String(cls.name) ||
             (x.role === 'Class Teacher' && Array.isArray(x.assignedClasses) && (x.assignedClasses.includes(cls.id) || x.assignedClasses.includes(cls.name))))
        );
    }
    if (t) {
        const sig = t.signature || t.teacherSignature || t.signatureData || localStorage.getItem('teacherSignature_' + t.id) || (t.userId ? localStorage.getItem('teacherSignature_' + t.userId) : null);
        if (sig) return sig;
    }
    const cur = currentTeacherRecord();
    if (cur) {
        const curSig = cur.signature || cur.teacherSignature || localStorage.getItem('teacherSignature_' + cur.id) || (cur.userId ? localStorage.getItem('teacherSignature_' + cur.userId) : null);
        if (curSig) return curSig;
    }
    return localStorage.getItem('currentTeacherSignature') || null;
}
function headTeacherName() {
    const teachers = loadJSON('teachers', []);
    const ht = teachers.find(t => t.role === 'Headteacher' && t.status !== 'inactive');
    return ht?.name || schoolSettings.headTeacher || schoolInfo.headTeacher || '';
}
function schoolLogoSrc() {
    return schoolSettings.schoolLogo || schoolInfo.schoolLogo || null;
}
function headTeacherSignatureSrc() {
    return schoolSettings.signature || schoolSettings.headTeacherSignature || schoolInfo.signature || schoolInfo.headTeacherSignature || null;
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
    if (schoolSettings.signature) schoolInfo.signature = schoolSettings.signature;
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
    const sId = String(studentId);
    const subKey = String(subject || '').trim();
    const bag = scores[subKey] || scores[subKey.toUpperCase()] || {};
    let entry = bag[sId] || bag[studentId] || (typeof studentId === 'string' && !isNaN(Number(studentId)) ? bag[Number(studentId)] : null);
    
    // Check results collection in localStorage for latest edits
    const results = loadJSON('results', []);
    const r = results.find(res =>
        String(res.studentId) === sId &&
        (String(res.subjectName || '').toLowerCase().trim() === subKey.toLowerCase() || String(res.subjectId || '').toLowerCase().trim() === subKey.toLowerCase())
    );
    if (r && (r.classScore !== '' || r.examScore !== '')) {
        if (!entry || (entry.classScore === '' && entry.examScore === '')) {
            return {
                classScore: r.classScore,
                examScore: r.examScore,
                classScore50: r.classScore50 !== undefined ? r.classScore50 : fifty(r.classScore),
                examScore50: r.examScore50 !== undefined ? r.examScore50 : fifty(r.examScore),
                totalScore: r.totalScore,
                grade: r.grade,
                remark: r.remark
            };
        }
    }
    return entry || { classScore: '', examScore: '', totalScore: '' };
}
function studentScoreObj(studentId, subject) {
    const e = getScoreEntry(subject, studentId);
    if (!e) return { classScore: '', examScore: '', total: '', grade: '', remark: '' };
    const tot = (e.classScore !== '' && e.examScore !== '') ? totalScore(e.classScore, e.examScore) : (e.totalScore !== '' && e.totalScore !== undefined ? Number(e.totalScore) : '');
    const g = (tot !== '' && !isNaN(Number(tot))) ? getGrade(tot, currentClass) : { grade: e.grade || '', remark: e.remark || '' };
    return {
        classScore: e.classScore !== undefined ? e.classScore : '',
        examScore: e.examScore !== undefined ? e.examScore : '',
        total: tot,
        grade: g.grade || '',
        remark: g.remark || ''
    };
}
function putScoreEntry(subject, studentId, data) {
    const subKey = String(subject || '').trim();
    if (!scores[subKey]) scores[subKey] = {};
    scores[subKey][scoreKey(studentId)] = data;
    if (!isNaN(Number(studentId))) {
        scores[subKey][Number(studentId)] = data;
    }
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
    const targetClass = classNameOrDept || (typeof currentClass !== 'undefined' ? currentClass : '');
    if (targetClass && typeof getGradingScaleForClass === 'function') {
        const clsScale = getGradingScaleForClass(targetClass);
        if (clsScale && Array.isArray(clsScale) && clsScale.length > 0) {
            const t = Math.max(0, Math.min(100, Number(total) || 0));
            return clsScale.find(g => t >= g.min && t <= g.max) || clsScale[clsScale.length - 1];
        }
    }

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

    if (typeof getGradeForScore === 'function') return getGradeForScore(total, targetClass);
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

    let ok = false;
    let authUser = null;

    // 1. Check local cached accounts first for instant 0ms login
    loadAll();
    let teachers = loadJSON('teachers', []);
    let users = loadJSON('users', []);
    let t = teachers.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
    let u = users.find(x => (x.email || '').toLowerCase() === email.toLowerCase());

    if (t?.status === 'inactive' || u?.status === 'inactive' || t?.status === 'deleted' || u?.status === 'deleted' || t?.isDeleted || u?.isDeleted) {
        err.textContent = 'This account has been deactivated / deleted by the administrator.';
        err.style.display = 'block';
        setTeacherLoginLoading(false);
        return;
    }

    let stored = u?.password || t?.password || '';
    if (stored && password === stored) {
        ok = true;
    }

    // 2. If not found locally, fast hydrate from REST sync (< 50ms) to immediately get accounts created on other devices
    if (!ok && typeof hydrateSchoolFromServer === 'function') {
        try {
            await hydrateSchoolFromServer();
            loadAll();
            teachers = loadJSON('teachers', []);
            users = loadJSON('users', []);
            t = teachers.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
            u = users.find(x => (x.email || '').toLowerCase() === email.toLowerCase());

            if (t?.status === 'inactive' || u?.status === 'inactive' || t?.status === 'deleted' || u?.status === 'deleted' || t?.isDeleted || u?.isDeleted) {
                err.textContent = 'This account has been deactivated / deleted by the administrator.';
                err.style.display = 'block';
                setTeacherLoginLoading(false);
                return;
            }
            stored = u?.password || t?.password || '';
            if (stored && password === stored) ok = true;
        } catch (e) {}
    }

    // 3. If still not authenticated, try Firebase Authentication with quick 3s timeout
    if (!ok && typeof isFirebaseActive !== 'undefined' && isFirebaseActive && typeof loginFirebaseUser === 'function') {
        try {
            const creds = await withTimeout(loginFirebaseUser(email, password), 3000, 'Sign-in');
            authUser = creds?.user || null;
            ok = true;
        } catch (e) {
            console.warn('Firebase login attempt notice:', e.message);
            if (e.message && (e.message.includes('deactivated') || e.message.includes('deleted'))) {
                err.textContent = e.message;
                err.style.display = 'block';
                setTeacherLoginLoading(false);
                return;
            }
        }
    }

    // Background cloud sync pull (non-blocking if already logged in)
    if (typeof pullSchoolFromFirebase === 'function') {
        pullSchoolFromFirebase().catch(() => {});
    }

    if (!ok) {
        if (!t && !u && !authUser) {
            err.textContent = 'No account found for this email. Accounts are created by the school administrator.';
        } else {
            err.textContent = 'Incorrect email or password. Use the credentials the administrator created for you.';
        }
        err.style.display = 'block';
        setTeacherLoginLoading(false);
        return;
    }

    sessionStorage.setItem('teacherUnlocked', 'true');
    sessionStorage.setItem('teacherEmail', email);
    const teacherName = (typeof getCurrentUserProfile === 'function' ? getCurrentUserProfile()?.displayName : null) || u?.displayName || t?.name || email.split('@')[0];
    sessionStorage.setItem('teacherName', teacherName);

    await openApp();
}

function validateCurrentTeacherSession(silent = false) {
    const isUnlocked = sessionStorage.getItem('teacherUnlocked') === 'true';
    const email = sessionStorage.getItem('teacherEmail');
    if (!isUnlocked || !email) return false;

    const teachers = loadJSON('teachers', []);
    const users = loadJSON('users', []);
    const normEmail = (email || '').trim().toLowerCase();
    const t = teachers.find(x => (x.email || '').trim().toLowerCase() === normEmail);
    const u = users.find(x => (x.email || '').trim().toLowerCase() === normEmail);

    const isDeactivated = (t && t.status === 'inactive') || (u && u.status === 'inactive');
    const isDeleted = (t && (t.status === 'deleted' || t.isDeleted)) || (u && (u.status === 'deleted' || u.isDeleted));
    const isNotFound = (teachers.length > 0) && !t && !u;

    if (isDeactivated || isDeleted || isNotFound) {
        sessionStorage.removeItem('teacherUnlocked');
        sessionStorage.removeItem('teacherEmail');
        sessionStorage.removeItem('teacherName');
        if (typeof logoutFirebaseUser === 'function') {
            try { logoutFirebaseUser(); } catch (e) {}
        }
        const app = document.getElementById('app');
        if (app) app.style.display = 'none';
        const overlay = document.getElementById('teacherAuthOverlay');
        if (overlay) overlay.style.display = 'flex';
        const err = document.getElementById('teacherAuthError');
        if (err) {
            err.textContent = isDeactivated
                ? 'Your teacher account has been deactivated by the school administrator.'
                : 'Your teacher account has been deleted by the school administrator.';
            err.style.display = 'block';
        }
        if (!silent && typeof showToast === 'function') {
            showToast(isDeactivated ? 'Account deactivated by administrator' : 'Account deleted. Signed out.', 'error');
        }
        return false;
    }
    return true;
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
    if (!validateCurrentTeacherSession(true)) return;

    // Show the app immediately with local data. Cloud sync keeps running in
    // the background instead of holding the sign-in screen hostage.
    document.getElementById('teacherAuthOverlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('teacherChip').textContent = sessionStorage.getItem('teacherName') || 'Teacher';
    document.getElementById('schoolNameLabel').textContent = schoolName();
    document.getElementById('termLabel').textContent = (schoolInfo.academicYear || '') + ' · ' + termHeading();
    fillHeaderClasses();
    
    // Check saved state from sessionStorage or hash to restore exact location upon page refresh
    const savedClass = sessionStorage.getItem('teacherClass');
    const savedTab   = sessionStorage.getItem('teacherTab') || 'students';
    const savedSub   = sessionStorage.getItem('teacherSubject') || '';
    if (savedSub) currentSubject = savedSub;

    const allowed = teacherAllowedClasses();
    if (savedClass && allowed.includes(savedClass)) {
        enterClass(savedClass, savedTab);
    } else if (allowed.length === 1) {
        enterClass(allowed[0], savedTab);
    } else {
        showHub();
    }
    setTeacherLoginLoading(false);

    const refreshFromSync = () => {
        loadAll();
        if (!validateCurrentTeacherSession()) return;
        fillHeaderClasses();
        const sn = document.getElementById('schoolNameLabel');
        if (sn) sn.textContent = schoolName();
        const tl = document.getElementById('termLabel');
        if (tl) tl.textContent = (schoolInfo.academicYear || '') + ' · ' + termHeading();
        updateSidebarState();
        if (currentSubject && !classSubjects().includes(currentSubject)) {
            const subs = classSubjects();
            currentSubject = subs[0] || '';
        }
        if (currentClass) {
            const activeEl = document.activeElement;
            const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT') && activeEl.closest('#tab-scores');
            if (!isEditing) openTab(currentTab);
        } else {
            renderHub();
        }
    };

    // Register real-time sync subscriber for 0ms cross-portal and cross-tab updates
    if (typeof registerSyncSubscriber === 'function') {
        registerSyncSubscriber(function (col, data) {
            refreshFromSync();
        });
    }

    // Cloud (Firebase) and local-server sync run in the background.
    const syncJobs = [];
    if (typeof pullSchoolFromFirebase === 'function') {
        syncJobs.push(pullSchoolFromFirebase().catch(() => false));
    }
    syncJobs.push(hydrateSchoolFromServer());
    Promise.all(syncJobs).then(results => {
        if (results.some(Boolean)) refreshFromSync();
    }).catch(() => {});

    if (typeof setupRealtimeListeners === 'function') {
        try { setupRealtimeListeners(refreshFromSync); } catch (e) {}
    }
    if (typeof startSchoolRealtime === 'function') {
        startSchoolRealtime(refreshFromSync);
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
    sessionStorage.setItem('teacherTab', tab);
    document.querySelectorAll('.nav-pill, .side-link[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
    updateSidebarState();
    renderStats();
    if (tab === 'students') renderStudents();
    if (tab === 'scores') renderScores();
    if (tab === 'broadsheet') renderBroadsheet();
    if (tab === 'reports') renderReports();
    if (tab === 'performance') renderPerformance();
    if (tab === 'attendance') renderAttendance();
    if (tab === 'timetable') renderTeacherTimetableTab();
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

function isSubjectLocked(subjectName) {
    const results = loadJSON('results', []);
    const classStudentIds = classStudents().map(s => String(s.id));
    return results.some(r =>
        (r.subjectName === subjectName || r.subjectId === subjectName) &&
        classStudentIds.includes(String(r.studentId)) &&
        r.locked === true
    );
}

function renderScores() {
    const subs = classSubjects();
    const savedSub = sessionStorage.getItem('teacherSubject');
    if (subs.length) {
        if (currentSubject && subs.includes(currentSubject)) {
            // Keep currentSubject
        } else if (savedSub && subs.includes(savedSub)) {
            currentSubject = savedSub;
        } else {
            currentSubject = subs[0];
        }
    } else {
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
                ${subs.map(sub => {
                    const locked = isSubjectLocked(sub);
                    return `<button class="subject-chip ${currentSubject === sub ? 'active' : ''} ${locked ? 'locked-chip' : ''}" onclick="openSubject('${sub.replace(/'/g, "\\'")}')"
                        title="${locked ? 'This subject is locked by Admin' : sub}">
                        ${locked ? '<i class="fas fa-lock" style="font-size:11px;color:#f59e0b;margin-right:4px;"></i>' : ''}
                        <strong>${esc(sub)}</strong>
                        <small>${scoredCount(sub)} / ${classStudents().length} entered${locked ? ' · Locked' : ''}</small>
                    </button>`;
                }).join('')}
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
    sessionStorage.setItem('teacherSubject', sub);
    renderScores();
}

function getCaValue(assessments, index) {
    if (!assessments) return '';
    const direct = assessments['ca' + index];
    if (direct !== undefined && direct !== null) return direct;
    const legacyMap = { 1: 'test1', 2: 'test2', 3: 'project', 4: 'homework' };
    const legKey = legacyMap[index];
    if (legKey && assessments[legKey] !== undefined) return assessments[legKey];
    return '';
}

function setAutosaveStatus(text, color, icon) {
    const el = document.getElementById('autosaveStatus');
    if (!el) return;
    el.style.color = color || '#64748b';
    el.innerHTML = icon ? `<i class="fas ${icon}"></i> ${text}` : text;
}

function drawScoreSheet() {
    const wrap = document.getElementById('scoreSheet');
    if (!wrap) return;
    const list = classStudents();
    const dept = getDepartmentForClass(currentClass);
    const locked = isSubjectLocked(currentSubject);

    const lockBanner = locked ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;gap:8px;">
        <i class="fas fa-lock" style="font-size:16px;color:#d97706;"></i>
        <div><strong>Mark entry locked by Admin.</strong> Scores for this subject are approved and read-only. Contact the administrator to unlock if edits are required.</div>
    </div>` : '';

    const statusBadge = `<span id="autosaveStatus" style="font-size:12px;font-weight:600;color:#94a3b8;margin-left:12px;display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-check"></i> Autosaved</span>`;

    if (piecewiseMode) {
        const caHeaders = Array.from({ length: caCount }, (_, i) => `<th>CA ${i + 1}</th>`).join('');
        wrap.innerHTML = `
            ${lockBanner}
            <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 6px;">
                <h3 style="margin:0;display:flex;align-items:center;">
                    ${esc(currentSubject)} ${locked ? '<span style="font-size:12px;color:#d97706;font-weight:600;margin-left:8px;"><i class="fas fa-lock"></i> Locked</span>' : ''}
                    ${statusBadge}
                </h3>
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
                            return `<td><input type="number" min="0" max="100" step="0.1" placeholder="CA ${i}" value="${val}" ${locked ? 'disabled title="Locked by Admin"' : ''} oninput="autosavePiece('${sid}','ca${i}',this)" onblur="flushScores()"></td>`;
                        }).join('');

                        return `<tr data-sid="${sid}">
                            <td style="min-width:120px;"><strong>${esc(s.name)}</strong></td>
                            ${caInputs}
                            <td class="cs-calc muted"><strong>${e.classScore !== '' ? e.classScore : '—'}</strong></td>
                            <td class="cs50 muted">${cs50 === '' ? '—' : cs50}</td>
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.examScore}" ${locked ? 'disabled title="Locked by Admin"' : ''} oninput="autosaveScore('${sid}','examScore',this)" onblur="flushScores()"></td>
                            <td class="es50 muted">${es50 === '' ? '—' : es50}</td>
                            <td class="tot"><strong>${tot === '' ? '—' : tot}</strong></td>
                            <td class="grd">${g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>
            ${!locked ? `
            <div style="margin-top:18px;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:14px 0;border-top:1px solid var(--line,#e2e8f0);">
                <div style="font-size:12px;color:var(--text-muted,#64748b);">
                    <i class="fas fa-info-circle"></i>
                    Marks are autosaved. Click <strong>Submit for Approval</strong> when you are done to send them to the Admin portal for review.
                </div>
                <button id="submitForApprovalBtn" type="button" onclick="submitSubjectForApproval()" style="
                    background:linear-gradient(135deg,#6366f1,#8b5cf6);
                    color:#fff;border:none;border-radius:10px;padding:11px 24px;
                    font-size:14px;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;gap:8px;
                    box-shadow:0 4px 14px rgba(99,102,241,0.35);
                    transition:all 0.2s;white-space:nowrap;
                " onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(99,102,241,0.45)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(99,102,241,0.35)'">
                    <i class="fas fa-paper-plane"></i>
                    Submit for Approval
                </button>
            </div>` : `
            <div style="margin-top:14px;display:flex;align-items:center;gap:8px;color:#92400e;font-size:13px;padding:10px 14px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;">
                <i class="fas fa-check-circle" style="color:#d97706;"></i>
                <span>Results for <strong>${esc(currentSubject)}</strong> have been submitted and locked by Admin. Contact the administrator to make further edits.</span>
            </div>`}`;
    } else {
        wrap.innerHTML = `
            ${lockBanner}
            <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 10px;">
                <h3 style="margin:0;display:flex;align-items:center;">
                    ${esc(currentSubject)} ${locked ? '<span style="font-size:12px;color:#d97706;font-weight:600;margin-left:8px;"><i class="fas fa-lock"></i> Locked</span>' : ''}
                    ${statusBadge}
                </h3>
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
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.classScore}" ${locked ? 'disabled title="Locked by Admin"' : ''} oninput="autosaveScore('${esc(scoreKey(s.id))}','classScore',this)" onblur="flushScores()"></td>
                            <td class="cs50 muted">${cs50 === '' ? '—' : cs50}</td>
                            <td><input type="number" min="0" max="100" step="0.1" placeholder="0–100" value="${e.examScore}" ${locked ? 'disabled title="Locked by Admin"' : ''} oninput="autosaveScore('${esc(scoreKey(s.id))}','examScore',this)" onblur="flushScores()"></td>
                            <td class="es50 muted">${es50 === '' ? '—' : es50}</td>
                            <td class="tot"><strong>${tot === '' ? '—' : tot}</strong></td>
                            <td class="grd">${g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table></div>
            ${!locked ? `
            <div style="margin-top:18px;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:14px 0;border-top:1px solid var(--line,#e2e8f0);">
                <div style="font-size:12px;color:var(--text-muted,#64748b);">
                    <i class="fas fa-info-circle"></i>
                    Marks are autosaved. Click <strong>Submit for Approval</strong> when you are done to send them to the Admin portal for review.
                </div>
                <button id="submitForApprovalBtn" type="button" onclick="submitSubjectForApproval()" style="
                    background:linear-gradient(135deg,#6366f1,#8b5cf6);
                    color:#fff;border:none;border-radius:10px;padding:11px 24px;
                    font-size:14px;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;gap:8px;
                    box-shadow:0 4px 14px rgba(99,102,241,0.35);
                    transition:all 0.2s;white-space:nowrap;
                " onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(99,102,241,0.45)'" onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(99,102,241,0.35)'">
                    <i class="fas fa-paper-plane"></i>
                    Submit for Approval
                </button>
            </div>` : `
            <div style="margin-top:14px;display:flex;align-items:center;gap:8px;color:#92400e;font-size:13px;padding:10px 14px;background:#fffbeb;border-radius:8px;border:1px solid #fde68a;">
                <i class="fas fa-check-circle" style="color:#d97706;"></i>
                <span>Results for <strong>${esc(currentSubject)}</strong> have been submitted and locked by Admin. Contact the administrator to make further edits.</span>
            </div>`}`;
    }
}

// Submit all marks for currentSubject to admin portal for approval
async function submitSubjectForApproval() {
    const btn = document.getElementById('submitForApprovalBtn');
    const studs = classStudents();
    const sub = currentSubject;

    if (!sub) { toast('Please select a subject first.', 'bad'); return; }
    if (!studs || studs.length === 0) { toast('No students found in this class.', 'bad'); return; }

    // Check at least one score has been entered
    const hasAnyScore = studs.some(s => {
        const e = getScoreEntry(sub, s.id);
        return (e.classScore !== '' && e.classScore != null) || (e.examScore !== '' && e.examScore != null);
    });
    if (!hasAnyScore) {
        toast(`No marks entered yet for ${sub}. Please enter marks before submitting.`, 'bad');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…';
    }

    try {
        // Step 1: Flush all in-memory scores to localStorage first
        persistScores();

        // Step 2: Sync the scores bag to results (sets status = 'Submitted' for unreviewed entries)
        syncScoresToResults();

        // Step 3: Mark results for this subject as explicitly 'Submitted' in localStorage
        let results = [];
        try { results = JSON.parse(localStorage.getItem('results') || '[]'); } catch(e) {}
        let updatedCount = 0;
        results.forEach(r => {
            const subNameN = String(sub).toLowerCase().trim();
            const matches =
                String(r.subjectName || '').toLowerCase().trim() === subNameN ||
                String(r.subjectId   || '').toLowerCase().trim() === subNameN;
            const classMatch =
                !r.classId ||
                String(r.classId) === String(currentClass) ||
                String(r.classId).toLowerCase() === String(currentClass).toLowerCase();
            if (matches && classMatch && r.status !== 'Approved') {
                r.status = 'Submitted';
                r.submittedAt = new Date().toISOString();
                r.submittedBy = sessionStorage.getItem('teacherName') || sessionStorage.getItem('teacherEmail') || 'Teacher';
                updatedCount++;
            }
        });
        localStorage.setItem('results', JSON.stringify(results));

        // Step 4: Push to Firestore via syncSaveCollection
        if (typeof syncSaveCollection === 'function') {
            await syncSaveCollection('results', results).catch(() => {});
        }

        // Step 5: Also bridge via syncScoresMapToResults for the 3-level scores map
        if (typeof syncScoresMapToResults === 'function') {
            const allScores = JSON.parse(localStorage.getItem('scores') || '{}');
            const years = JSON.parse(localStorage.getItem('academicYears') || '[]');
            const terms = JSON.parse(localStorage.getItem('terms') || '[]');
            const activeYear = (years.find(y => y.isActive) || {}).id || schoolInfo.academicYear || '';
            const activeTerm = (terms.find(t => t.isActive) || {}).id || schoolInfo.term || '';
            await syncScoresMapToResults(allScores, activeYear, activeTerm).catch(() => {});
        }

        // Step 6: Broadcast update to admin portal via BroadcastChannel / storage event
        try {
            if (typeof broadcastSchoolSync === 'function') {
                broadcastSchoolSync('results', results);
            } else {
                // Manual broadcast fallback
                window.dispatchEvent(new CustomEvent('onereal_data_updated', { detail: { collection: 'results' } }));
                localStorage.setItem('_sync_ping', Date.now().toString());
                localStorage.removeItem('_sync_ping');
            }
        } catch(e) {}

        const countMsg = updatedCount > 0 ? ` (${updatedCount} student${updatedCount !== 1 ? 's' : ''})` : '';
        toast(`✅ ${sub} marks submitted to Admin for approval${countMsg}!`, 'good');
        setAutosaveStatus('Submitted for approval ✓', '#6366f1', 'fa-paper-plane');

        // Brief delay then re-render to show updated submission state
        setTimeout(() => renderScores(), 1800);

    } catch(err) {
        console.warn('submitSubjectForApproval error:', err);
        toast('Submission failed. Please try again.', 'bad');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Approval';
        }
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

// Flush in-memory scores to localStorage — called on blur and by the inactivity timer.
// Kept separate so oninput stays lightweight and never blocks typing.
function flushScores() {
    persistScores();
    syncScoresToResults();
    setAutosaveStatus('All marks saved & updated', '#059669', 'fa-check-circle');
    setTimeout(() => { setAutosaveStatus('Autosaved', '#94a3b8', 'fa-check'); }, 2500);
    // Also bridge 3-level scores map to Firestore results so admin sees marks instantly
    if (typeof syncScoresMapToResults === 'function') {
        const allScores = JSON.parse(localStorage.getItem('scores') || '{}');
        const years = JSON.parse(localStorage.getItem('academicYears') || '[]');
        const terms = JSON.parse(localStorage.getItem('terms') || '[]');
        const activeYear = (years.find(y => y.isActive) || {}).id || schoolInfo.academicYear || '';
        const activeTerm = (terms.find(t => t.isActive) || {}).id || schoolInfo.term || '';
        syncScoresMapToResults(allScores, activeYear, activeTerm).catch(() => {});
    }
}


// Piecewise: update in-memory entry for an individual CA component and refresh the row display.
// localStorage is NOT written here — that happens on blur (flushScores) or the inactivity timer.
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
    // Update in-memory map only — fast, no localStorage writes while user is still typing
    putScoreEntry(currentSubject, studentId, row);
    refreshScoreRow(studentId);
    setAutosaveStatus('Unsaved changes…', '#d97706', 'fa-clock');
    // Inactivity timer: if user stops typing for 1.5s, flush to localStorage automatically
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        flushScores();
        renderStats();
    }, 1500);
}

// Sync scores to the shared results collection so admin can see them
function syncScoresToResults() {
    try {
        const existingResults = JSON.parse(localStorage.getItem('results') || '[]');
        const classes = JSON.parse(localStorage.getItem('classes') || '[]');
        const subjectsList = JSON.parse(localStorage.getItem('subjects') || '[]');
        const classRec = classes.find(c => c.name === currentClass || String(c.id) === String(currentClass));
        const classId = classRec ? classRec.id : currentClass;
        const className = classRec ? classRec.name : currentClass;
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
                if (!e || (e.classScore === '' && e.examScore === '' && (e.totalScore == null || e.totalScore === ''))) return;

                const subObj = subjectsList.find(s => s.name === sub || String(s.id) === String(sub) || s.code === sub);
                const subName = subObj?.name || sub;
                const subId = subObj?.id || sub;

                const csVal = (e.classScore !== '' && e.classScore != null) ? Number(e.classScore) : '';
                const esVal = (e.examScore !== '' && e.examScore != null) ? Number(e.examScore) : '';
                const cs50 = csVal !== '' ? (e.classScore50 !== undefined && e.classScore50 !== '' ? Number(e.classScore50) : fifty(csVal)) : '';
                const es50 = esVal !== '' ? (e.examScore50 !== undefined && e.examScore50 !== '' ? Number(e.examScore50) : fifty(esVal)) : '';
                const totVal = (cs50 !== '' && es50 !== '') ? Math.round((Number(cs50) + Number(es50)) * 10) / 10 : (e.totalScore || '');
                const dept = getDepartmentForClass(className);
                const g = totVal !== '' ? getGrade(totVal, className) : { grade: e.grade || '', remark: e.remark || '' };

                // Normalize for comparison — handles mismatches between name-as-id (admin path) and real id (teacher path)
                const subNameN = subName.toLowerCase().trim();
                const subIdN = String(subId).toLowerCase().trim();
                const stuIdN = String(stu.id);

                const existing = results.find(r =>
                    String(r.studentId) === stuIdN &&
                    (
                        String(r.subjectName || '').toLowerCase().trim() === subNameN ||
                        String(r.subjectId  || '').toLowerCase().trim() === subIdN ||
                        String(r.subjectId  || '').toLowerCase().trim() === subNameN ||
                        String(r.subjectName|| '').toLowerCase().trim() === subIdN
                    )
                );

                const entryData = {
                    studentId: stuIdN,
                    studentName: stu.name,
                    classId: classId,
                    subjectId: subId,
                    subjectName: subName,
                    classScore: csVal,
                    examScore: esVal,
                    classScore50: cs50,
                    examScore50: es50,
                    totalScore: totVal,
                    grade: g.grade,
                    remark: g.remark,
                    status: existing?.status === 'Approved' ? 'Approved' : 'Submitted',
                    academicYearId: activeYear?.id || schoolInfo.academicYear || '',
                    termId: activeTerm?.id || schoolInfo.term || '',
                    updatedAt: new Date().toISOString()
                };

                if (existing) {
                    Object.assign(existing, entryData);
                } else {
                    entryData.id = 'res_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
                    entryData.locked = false;
                    results.push(entryData);
                }
            });
        });

        // Also scan the entire scores bag so any marks across any class/subject are synced to results
        const allScoresBag = JSON.parse(localStorage.getItem('scores') || '{}');
        const allStudents = JSON.parse(localStorage.getItem('students') || '[]');
        Object.keys(allScoresBag).forEach(subKey => {
            const subMap = allScoresBag[subKey] || {};
            const subObj = subjectsList.find(s => s.name === subKey || String(s.id) === String(subKey) || s.code === subKey);
            const subName = subObj?.name || subKey;
            const subId = subObj?.id || subKey;
            const subNameN = subName.toLowerCase().trim();
            const subIdN = String(subId).toLowerCase().trim();

            Object.keys(subMap).forEach(stuIdKey => {
                const e = subMap[stuIdKey];
                if (!e || (e.classScore === '' && e.examScore === '' && (e.totalScore == null || e.totalScore === ''))) return;

                const stu = allStudents.find(s => String(s.id) === String(stuIdKey)) || { id: stuIdKey, name: 'Student ' + stuIdKey };
                const stuClass = stu.classId || stu.class || '';
                const classRecAll = classes.find(c => c.name === stuClass || String(c.id) === String(stuClass));
                const classIdAll = classRecAll ? classRecAll.id : (stuClass || classId);
                const classNameAll = classRecAll ? classRecAll.name : (stuClass || className);

                const csVal = (e.classScore !== '' && e.classScore != null) ? Number(e.classScore) : '';
                const esVal = (e.examScore !== '' && e.examScore != null) ? Number(e.examScore) : '';
                const cs50 = csVal !== '' ? (e.classScore50 !== undefined && e.classScore50 !== '' ? Number(e.classScore50) : fifty(csVal)) : '';
                const es50 = esVal !== '' ? (e.examScore50 !== undefined && e.examScore50 !== '' ? Number(e.examScore50) : fifty(esVal)) : '';
                const totVal = (cs50 !== '' && es50 !== '') ? Math.round((Number(cs50) + Number(es50)) * 10) / 10 : (e.totalScore || '');
                const g = totVal !== '' ? getGrade(totVal, classNameAll) : { grade: e.grade || '', remark: e.remark || '' };

                const stuIdN = String(stu.id);
                const existing = results.find(r =>
                    String(r.studentId) === stuIdN &&
                    (
                        String(r.subjectName || '').toLowerCase().trim() === subNameN ||
                        String(r.subjectId  || '').toLowerCase().trim() === subIdN ||
                        String(r.subjectId  || '').toLowerCase().trim() === subNameN ||
                        String(r.subjectName|| '').toLowerCase().trim() === subIdN
                    )
                );

                const entryData = {
                    studentId: stuIdN,
                    studentName: stu.name,
                    classId: classIdAll,
                    subjectId: subId,
                    subjectName: subName,
                    classScore: csVal,
                    examScore: esVal,
                    classScore50: cs50,
                    examScore50: es50,
                    totalScore: totVal,
                    grade: g.grade,
                    remark: g.remark,
                    status: existing?.status === 'Approved' ? 'Approved' : 'Submitted',
                    academicYearId: activeYear?.id || schoolInfo.academicYear || '',
                    termId: activeTerm?.id || schoolInfo.term || '',
                    updatedAt: new Date().toISOString()
                };

                if (existing) {
                    Object.assign(existing, entryData);
                } else {
                    entryData.id = 'res_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
                    entryData.locked = false;
                    results.push(entryData);
                }
            });
        });

        // Final dedup pass — collapse any pre-existing duplicate pairs
        const deduped = deduplicateResultsArray(results);
        localStorage.setItem('results', JSON.stringify(deduped));
        if (typeof syncSaveCollection === 'function') {
            syncSaveCollection('results', deduped).catch(() => {});
        }
    } catch(e) { console.warn('syncScoresToResults error:', e); }
}

/**
 * Collapses duplicate result entries that refer to the same student + subject.
 * Keeps the entry with the latest updatedAt; merges status upward (Approved wins).
 */
function deduplicateResultsArray(arr) {
    const seen = new Map();
    arr.forEach(r => {
        // Build a canonical key: studentId + normalised subject name
        const subNorm = String(r.subjectName || r.subjectId || '').toLowerCase().trim();
        const key = String(r.studentId) + '|' + subNorm;
        if (!seen.has(key)) {
            seen.set(key, Object.assign({}, r));
        } else {
            const prev = seen.get(key);
            // Keep the most recent update
            const prevDate = new Date(prev.updatedAt || 0).getTime();
            const curDate  = new Date(r.updatedAt  || 0).getTime();
            const winner   = curDate >= prevDate ? r : prev;
            // Prefer Approved/Published status regardless of which is newer
            const statusRank = s => ['approved','published'].includes((s||'').toLowerCase()) ? 2 : 1;
            const bestStatus = statusRank(r.status) >= statusRank(prev.status) ? r.status : prev.status;
            // Prefer a real subject ID (not just the name used as ID)
            const bestSubjectId = (String(prev.subjectId||'').startsWith('res_') || prev.subjectId === prev.subjectName)
                ? (r.subjectId || prev.subjectId)
                : prev.subjectId;
            seen.set(key, Object.assign({}, winner, { status: bestStatus, subjectId: bestSubjectId, subjectName: winner.subjectName || prev.subjectName }));
        }
    });
    return Array.from(seen.values());
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
    // Update in-memory map only — fast, no localStorage writes while user is still typing
    putScoreEntry(currentSubject, studentId, row);
    refreshScoreRow(studentId);
    setAutosaveStatus('Unsaved changes…', '#d97706', 'fa-clock');
    // Inactivity timer: if user stops typing for 1.5s, flush to localStorage automatically
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        flushScores();
        renderStats();
    }, 1500);
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
        return { s, map, sum, avg: p ? p.avg : 0, grade: p ? p.grade : '—', remark: p ? p.remark : '—' };
    }).sort((a, b) => b.sum - a.sum);
    list.forEach((row, i) => { row.rank = i + 1; });

    document.getElementById('tab-broadsheet').innerHTML = `
        <div class="card">
            <div class="actions" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div>
                    <h3 style="margin:0;font-size:15px;color:var(--ink);font-weight:700;"><i class="fas fa-table" style="color:var(--primary);margin-right:6px;"></i> Master Broadsheet — ${esc(currentClass || 'Class')}</h3>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px;">${list.length} student${list.length === 1 ? '' : 's'} registered in this class</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" id="exportBroadsheetBtn" onclick="exportBroadsheet()">
                    <i class="fas fa-file-excel"></i> Export Excel Broadsheet
                </button>
            </div>
            <div class="table-wrap"><table class="broadsheet">
                <thead><tr><th>Pos</th><th>Student</th>${subs.map(s => `<th>${esc(s.split(' ')[0])}</th>`).join('')}<th>Total</th><th>Avg</th><th>Grade</th></tr></thead>
                <tbody>
                    ${list.map(r => `<tr>
                        <td><span class="badge ${r.rank < 4 ? 'rank' + r.rank : ''}">${r.rank}</span></td>
                        <td class="name">${esc(r.s.name)}</td>
                        ${subs.map(sub => `<td>${r.map[sub] == null ? '—' : r.map[sub]}</td>`).join('')}
                        <td><strong>${r.sum.toFixed(0)}</strong></td>
                        <td>${r.avg ? r.avg.toFixed(1) + '%' : '—'}</td>
                        <td><span class="badge ${r.grade === 'A' ? 'ok' : ''}">${r.grade}</span></td>
                    </tr>`).join('') || '<tr><td colspan="20" style="text-align:center;padding:24px;color:var(--muted);">No students in this class yet.</td></tr>'}
                </tbody>
            </table></div>
        </div>`;
}

function exportBroadsheet() {
    if (!currentClass) {
        toast('Please select a class first.', 'bad');
        return;
    }
    const subs = allClassSubjects(currentClass);
    const studentsList = classStudents();
    if (!studentsList.length) {
        toast('No students found in this class to export.', 'bad');
        return;
    }

    const list = studentsList.map(s => {
        const p = studentPerf(s.id);
        const map = {};
        subs.forEach(sub => {
            const e = getScoreEntry(sub, s.id);
            map[sub] = (e && e.totalScore !== '' && e.totalScore != null) ? Number(e.totalScore) : null;
        });
        const sum = Object.values(map).reduce((a, b) => a + (b || 0), 0);
        return { 
            s, 
            map, 
            sum, 
            avg: p ? p.avg : 0, 
            grade: p ? p.grade : '—', 
            remark: p ? p.remark : '—' 
        };
    }).sort((a, b) => b.sum - a.sum);

    list.forEach((row, i) => { row.rank = i + 1; });

    const schoolName = (typeof schoolInfo !== 'undefined' && schoolInfo && schoolInfo.name) ? schoolInfo.name : 'OneReal School';
    const termStr = (typeof currentTerm !== 'undefined' && currentTerm) ? currentTerm : 'Term 1';

    // Build tabular worksheet array
    const rows = [
        [schoolName.toUpperCase()],
        [`MASTER BROADSHEET — ${currentClass.toUpperCase()}`, `Academic Period: ${termStr}`],
        [],
        ['Pos', 'Student Name', ...subs, 'Total Score', 'Average (%)', 'Overall Grade', 'Remarks']
    ];

    list.forEach(r => {
        const subScores = subs.map(sub => r.map[sub] != null ? r.map[sub] : '');
        rows.push([
            r.rank,
            r.s.name,
            ...subScores,
            Math.round(r.sum),
            Number(r.avg.toFixed(1)),
            r.grade,
            r.remark
        ]);
    });

    // Summary statistics
    const classAvgRow = ['—', 'Class Average'];
    const highestRow = ['—', 'Highest Score'];
    const lowestRow = ['—', 'Lowest Score'];

    subs.forEach(sub => {
        const validScores = list.map(r => r.map[sub]).filter(v => v !== null && !isNaN(v));
        if (validScores.length > 0) {
            const avg = (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1);
            const max = Math.max(...validScores);
            const min = Math.min(...validScores);
            classAvgRow.push(Number(avg));
            highestRow.push(max);
            lowestRow.push(min);
        } else {
            classAvgRow.push('—');
            highestRow.push('—');
            lowestRow.push('—');
        }
    });

    classAvgRow.push('—', '—', '—', '—');
    highestRow.push('—', '—', '—', '—');
    lowestRow.push('—', '—', '—', '—');

    rows.push([]);
    rows.push(classAvgRow);
    rows.push(highestRow);
    rows.push(lowestRow);

    const safeClassName = currentClass.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeClassName}_Master_Broadsheet.xlsx`;

    try {
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [
                { wch: 6 },
                { wch: 25 },
                ...subs.map(() => ({ wch: 14 })),
                { wch: 12 },
                { wch: 12 },
                { wch: 10 },
                { wch: 22 }
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Master Broadsheet");
            XLSX.writeFile(wb, fileName);
            toast(`Broadsheet exported straight to Excel (${fileName})!`, 'ok');
            return;
        }
    } catch (e) {
        console.warn('XLSX direct write error, falling back to OneRealFiles', e);
    }

    try {
        if (typeof OneRealFiles !== 'undefined' && OneRealFiles.buildXlsx) {
            const bytes = OneRealFiles.buildXlsx(rows, 'Master Broadsheet');
            const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            if (OneRealFiles.saveBlob) {
                OneRealFiles.saveBlob(blob, fileName);
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 3000);
            }
            toast(`Broadsheet exported straight to Excel (${fileName})!`, 'ok');
            return;
        }
    } catch (e) {
        console.warn('OneRealFiles export error', e);
    }

    // Direct browser anchor CSV download fallback
    let csvContent = "\uFEFF" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.xlsx$/, '.csv');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 3000);
    toast('Broadsheet exported directly!', 'ok');
}

function renderReports() {
    loadAll();
    const list = classStudents();
    const approved = list.filter(s => isApproved(s.id)).length;
    const hasApproved = approved > 0;
    const teacherName = classTeacherName(currentClass) || 'Not Assigned';
    const teacherSig = classTeacherSignatureSrc(currentClass);

    document.getElementById('tab-reports').innerHTML = `
        <div class="card" style="margin-bottom:14px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:42px;height:42px;border-radius:10px;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;">
                        <i class="fas fa-signature"></i>
                    </div>
                    <div>
                        <div style="font-size:13px;font-weight:700;color:#1e293b;">
                            Class Teacher: <span style="color:#4f46e5;">${esc(teacherName)}</span>
                        </div>
                        <div style="font-size:11.5px;color:#64748b;display:flex;align-items:center;gap:8px;margin-top:2px;">
                            ${teacherSig ? `
                                <span class="badge ok" style="font-size:10.5px;padding:2px 8px;"><i class="fas fa-check-circle"></i> Signature Active on Report Cards</span>
                                <span style="display:inline-flex;align-items:center;background:#fff;border:1px solid #cbd5e1;border-radius:4px;padding:2px 6px;height:24px;">
                                    <img src="${teacherSig}" style="max-height:18px;max-width:80px;object-fit:contain;" alt="Signature">
                                </span>
                            ` : `
                                <span class="badge wait" style="font-size:10.5px;padding:2px 8px;"><i class="fas fa-exclamation-circle"></i> No Signature on File</span>
                                <span>Sign to have your signature print on report cards</span>
                            `}
                        </div>
                    </div>
                </div>
                <div>
                    <button class="btn ${teacherSig ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="openTeacherSignatureModal()">
                        <i class="fas fa-pen-nib"></i> ${teacherSig ? 'Update Signature' : 'Sign Report Cards'}
                    </button>
                </div>
            </div>
        </div>

        <div class="card">
            <p class="hint">Preview anytime. Download buttons appear only after admin approves a report.</p>
            <div class="actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <button class="btn btn-primary" onclick="openBatchSmartRemarksModal()"><i class="fas fa-magic"></i> Auto-Generate Smart Remarks for Class</button>
                <button class="btn btn-ghost" onclick="generateClassReports()"><i class="fas fa-sync-alt"></i> Refresh Class Reports</button>
                ${hasApproved ? `<button class="btn btn-ok" onclick="bulkDownload()"><i class="fas fa-file-archive"></i> Download approved ZIP (${approved})</button>` : '<button class="btn btn-ghost" disabled title="No approved reports yet"><i class="fas fa-lock"></i> Class ZIP locked</button>'}
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
                            ${ok ? `<button class="btn btn-ok btn-sm" onclick="downloadReport('${s.id}')"><i class="fas fa-download"></i> Download</button>` : '<span class="badge wait" style="font-size:0.72rem;"><i class="fas fa-lock"></i> Awaiting admin</span>'}
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

    // Performance context
    const p = studentPerf(String(id));
    const avg = p ? p.avg : null;
    const best = (p && p.items.length) ? p.items.slice().sort((a, b) => b.total - a.total)[0] : null;

    // Default tone based on academic average if available
    const defaultTone = (avg === null) ? 'middle' : (avg >= 68 ? 'positive' : (avg >= 50 ? 'middle' : 'negative'));

    // Pre-fill current override values if any
    const currentPresent = (typeof Attendance !== 'undefined' && Attendance.hasPresentOverride && Attendance.hasPresentOverride(id))
        ? Attendance.presentCount(id) : '';
    const currentTotal = (typeof Attendance !== 'undefined' && Attendance.totalDays) ? Attendance.totalDays(id) : '';

    openModal(`
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:14px;">
            <h3 style="margin:0;font-size:16px;font-weight:700;"><i class="fas fa-edit" style="color:var(--primary);margin-right:6px;"></i> Student Remarks &amp; Promotion — ${esc(s.name)}</h3>
        </div>

        ${p ? `
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:12px;">
            <div>
                <span style="color:var(--muted);">Academic Average:</span> <strong style="color:var(--ink);">${p.avg.toFixed(1)}% (${p.grade})</strong>
                <span style="margin:0 8px;color:var(--line);">|</span>
                <span style="color:var(--muted);">Top Subject:</span> <strong style="color:var(--primary);">${best ? esc(best.subject) + ' (' + best.total + '%)' : 'None'}</strong>
            </div>
            <div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="smartRemarks('${sid}')" style="font-size:11px;padding:4px 10px;">
                    <i class="fas fa-magic"></i> Auto-Generate All
                </button>
            </div>
        </div>
        ` : ''}

        <div class="field" style="margin-bottom:10px;"><label>Attendance (current)</label><div class="readonly-box">${esc(attText)}</div></div>

        <div class="row" style="margin-bottom:10px;">
            <div class="field"><label>Days Present Override</label>
                <input type="number" id="rmAttPresent" min="0" value="${currentPresent !== '' ? currentPresent : ''}" placeholder="Leave blank to use register">
                <p class="hint" style="margin:2px 0 0;">Overrides daily register count for this student.</p>
            </div>
            <div class="field"><label>Student Total Days</label>
                <input type="number" id="rmAttTotal" min="0" value="${currentTotal !== '' ? currentTotal : ''}" placeholder="Leave blank for term default">
                <p class="hint" style="margin:2px 0 0;">Overrides the OUT OF days for this student only.</p>
            </div>
        </div>

        <div class="row" style="margin-bottom:12px;">
            <div class="field"><label>Promotion</label>
                <select id="rmPromo" onchange="onPromotionChange('${sid}')">
                    <option value="">—</option>
                    <option ${d.promotionStatus === 'Promoted' ? 'selected' : ''}>Promoted</option>
                    <option ${d.promotionStatus === 'Repeated' ? 'selected' : ''}>Repeated</option>
                </select>
            </div>
            <div class="field"><label>To / in</label><input id="rmTarget" value="${esc(d.promotionTarget || '')}" placeholder="e.g. Basic 7"></div>
        </div>

        <!-- Conduct Field with Positive / Middle / Negative Tone Selector -->
        <div class="field" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <label style="margin:0;font-weight:600;">Conduct</label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:11px;color:var(--muted);">Tone:</span>
                    <select id="rmConductTone" onchange="generateConductRemark('${sid}')" style="font-size:11.5px;padding:3px 8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);">
                        <option value="positive" ${defaultTone === 'positive' ? 'selected' : ''}>Positive (Exemplary &amp; Disciplined)</option>
                        <option value="middle" ${defaultTone === 'middle' ? 'selected' : ''}>Middle (Satisfactory &amp; Cooperative)</option>
                        <option value="negative" ${defaultTone === 'negative' ? 'selected' : ''}>Negative (Needs Improvement)</option>
                    </select>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="generateConductRemark('${sid}')" title="Generate conduct remark from selected tone" style="font-size:11px;padding:3px 8px;"><i class="fas fa-sync-alt"></i> Apply Tone</button>
                </div>
            </div>
            <input id="rmConduct" value="${esc(d.conduct || '')}" placeholder="e.g. Very well behaved, courteous and respectful">
        </div>

        <!-- Interest Field (uses highest mark subject) -->
        <div class="field" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <label style="margin:0;font-weight:600;">Interest</label>
                <div style="display:flex;align-items:center;gap:6px;">
                    ${best ? `<button type="button" class="btn btn-ghost btn-sm" onclick="applyTopSubjectInterest('${sid}')" title="Set interest to highest scoring subject (${esc(best.subject)})" style="font-size:11px;padding:3px 8px;"><i class="fas fa-star" style="color:#d97706;"></i> Use Highest Subject (${esc(best.subject)})</button>` : ''}
                </div>
            </div>
            <input id="rmInterest" value="${esc(d.interest || '')}" placeholder="${best ? 'e.g. ' + esc(best.subject) : 'e.g. Mathematics, reading, sports'}">
            <p class="hint" style="margin:3px 0 0;font-size:11px;">Smart remarks uses the student's highest scoring subject as their interest.</p>
        </div>

        <!-- Teacher's Remarks Field with Positive / Middle / Negative Tone Selector -->
        <div class="field" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <label style="margin:0;font-weight:600;">Teacher's Remarks</label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:11px;color:var(--muted);">Tone:</span>
                    <select id="rmTeachTone" onchange="generateTeacherRemark('${sid}')" style="font-size:11.5px;padding:3px 8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);">
                        <option value="positive" ${defaultTone === 'positive' ? 'selected' : ''}>Positive (Outstanding / Commendable)</option>
                        <option value="middle" ${defaultTone === 'middle' ? 'selected' : ''}>Middle (Satisfactory / Fair Progress)</option>
                        <option value="negative" ${defaultTone === 'negative' ? 'selected' : ''}>Negative (Needs Support / Remedial)</option>
                    </select>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="generateTeacherRemark('${sid}')" title="Generate teacher remarks from selected tone" style="font-size:11px;padding:3px 8px;"><i class="fas fa-sync-alt"></i> Apply Tone</button>
                </div>
            </div>
            <textarea id="rmTeach" rows="3" placeholder="Teacher's overall narrative remark">${esc(d.teacherRemarks || '')}</textarea>
        </div>

        <div class="actions" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:12px;">
            <button type="button" class="btn btn-ghost btn-sm" onclick="smartRemarks('${sid}')" style="font-size:12px;">
                <i class="fas fa-magic"></i> Generate Smart Remarks
            </button>
            <div style="display:flex;gap:8px;">
                <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
                <button type="button" class="btn btn-primary" onclick="saveRemarks('${sid}')"><i class="fas fa-save"></i> Save Remarks</button>
            </div>
        </div>
    `);
}

function calculateSmartRemarksData(id, opts = {}) {
    const p = studentPerf(String(id));
    const s = students.find(x => String(x.id) === String(id));
    const currentCls = s?.class || currentClass || '';
    const avg = p ? p.avg : 60;
    const best = (p && p.items && p.items.length) ? p.items.slice().sort((a, b) => b.total - a.total)[0] : null;
    const weak = (p && p.items && p.items.length) ? p.items.slice().sort((a, b) => a.total - b.total)[0] : null;
    const bestSub = best ? best.subject : '';
    const weakSub = (weak && weak.subject !== bestSub) ? weak.subject : '';

    let conductTone = opts.conductTone || 'auto';
    if (conductTone === 'auto') {
        conductTone = avg >= 68 ? 'positive' : (avg >= 50 ? 'middle' : 'negative');
    }
    let teachTone = opts.teachTone || opts.teacherTone || 'auto';
    if (teachTone === 'auto') {
        teachTone = avg >= 68 ? 'positive' : (avg >= 50 ? 'middle' : 'negative');
    }

    let conduct = '';
    if (conductTone === 'positive') {
        if (avg >= 80) {
            conduct = 'Exemplary behavior; very respectful, obedient, and highly disciplined at all times.';
        } else {
            conduct = 'Very well-behaved, courteous, and exhibits excellent cooperation with teachers and peers.';
        }
    } else if (conductTone === 'negative') {
        if (avg < 45) {
            conduct = 'Conduct requires significant improvement. Easily distracted and needs constant supervision in class.';
        } else {
            conduct = 'Needs to improve self-discipline, punctuality, and pay closer attention to class instructions.';
        }
    } else {
        conduct = 'Generally well-behaved and cooperative, though occasionally needs gentle guidance and focus.';
    }

    let teacher = '';
    if (teachTone === 'positive') {
        if (avg >= 80) {
            teacher = `An outstanding student who demonstrates high academic excellence${bestSub ? ', especially in ' + bestSub : ''}. Keep up the brilliant performance!`;
        } else {
            teacher = `Commendable academic effort and steady progress${bestSub ? ' with notable strength in ' + bestSub : ''}. Continue to work diligently!`;
        }
    } else if (teachTone === 'negative') {
        if (weakSub) {
            teacher = `Academic performance is below expectations, particularly in ${weakSub}. Urgent remedial support and regular study habits are required.`;
        } else {
            teacher = `Needs significant academic improvement. Dedicated home study, teacher guidance, and parental supervision strongly recommended.`;
        }
    } else {
        if (bestSub && weakSub) {
            teacher = `A satisfactory performance overall. Shows good understanding in ${bestSub}, but needs to devote extra study time to ${weakSub} for higher grades.`;
        } else if (bestSub) {
            teacher = `A fair performance with promising aptitude in ${bestSub}. Encouraged to maintain steady study habits for greater progress.`;
        } else {
            teacher = `Satisfactory work overall. Extra diligence, regular revision, and active classroom participation are recommended.`;
        }
    }

    const interest = (opts.useTopSubject !== false && bestSub) ? bestSub : (opts.defaultInterest || 'Class activities');

    let promo = '';
    let target = '';
    if (opts.autoPromo !== false) {
        if (avg >= 45) {
            promo = 'Promoted';
            target = calculateNextClass(currentCls);
        } else {
            promo = 'Repeated';
            target = currentCls;
        }
    }

    return {
        conduct,
        conductTone,
        interest,
        teacherRemarks: teacher,
        teachTone,
        promotionStatus: promo,
        promotionTarget: target,
        avg,
        bestSub,
        weakSub
    };
}

function generateConductRemark(id) {
    const toneSelect = document.getElementById('rmConductTone');
    const tone = toneSelect ? toneSelect.value : 'middle';
    const res = calculateSmartRemarksData(id, { conductTone: tone });
    const rmConduct = document.getElementById('rmConduct');
    if (rmConduct) rmConduct.value = res.conduct;
}

function generateTeacherRemark(id) {
    const toneSelect = document.getElementById('rmTeachTone');
    const tone = toneSelect ? toneSelect.value : 'middle';
    const res = calculateSmartRemarksData(id, { teachTone: tone });
    const rmTeach = document.getElementById('rmTeach');
    if (rmTeach) rmTeach.value = res.teacherRemarks;
}

function applyTopSubjectInterest(id) {
    const p = studentPerf(String(id));
    const best = (p && p.items.length) ? p.items.slice().sort((a, b) => b.total - a.total)[0] : null;
    const rmInterest = document.getElementById('rmInterest');
    if (rmInterest) {
        rmInterest.value = best ? best.subject : 'Class activities';
    }
}

function smartRemarks(id) {
    const p = studentPerf(String(id));
    if (!p) {
        toast('No scores entered yet. Enter scores first to generate smart remarks.', 'bad');
        return;
    }
    const conductToneEl = document.getElementById('rmConductTone');
    const teachToneEl = document.getElementById('rmTeachTone');

    const res = calculateSmartRemarksData(id, {
        conductTone: conductToneEl ? conductToneEl.value : 'auto',
        teachTone: teachToneEl ? teachToneEl.value : 'auto',
        useTopSubject: true,
        autoPromo: true
    });

    if (conductToneEl) conductToneEl.value = res.conductTone;
    if (teachToneEl) teachToneEl.value = res.teachTone;

    const rmConduct = document.getElementById('rmConduct');
    const rmTeach = document.getElementById('rmTeach');
    const rmInterest = document.getElementById('rmInterest');
    const rmPromo = document.getElementById('rmPromo');
    const rmTarget = document.getElementById('rmTarget');

    if (rmConduct) rmConduct.value = res.conduct;
    if (rmTeach) rmTeach.value = res.teacherRemarks;
    if (rmInterest) rmInterest.value = res.interest;
    if (rmPromo) rmPromo.value = res.promotionStatus;
    if (rmTarget) rmTarget.value = res.promotionTarget;

    toast('Smart remarks generated with selected tone and top subject interest!', 'ok');
}

function openBatchSmartRemarksModal() {
    const list = classStudents();
    if (!list.length) return toast('No students in this class.', 'bad');
    const withScores = list.filter(s => studentPerf(s.id));

    openModal(`
        <div class="modal-head" style="margin-bottom:12px;">
            <h3 style="margin:0;display:flex;align-items:center;gap:8px;font-size:16px;">
                <i class="fas fa-magic" style="color:var(--primary);"></i> Batch Smart Remarks Generator
            </h3>
            <p class="hint" style="margin:4px 0 0;font-size:12px;">
                Generate customized remarks, conduct notes, top-scoring subject interests, and promotion targets for all <strong>${list.length}</strong> students in <strong>${esc(currentClass || 'Class')}</strong> with a single click.
            </p>
        </div>

        <div style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div><span style="color:var(--muted);">Total Students:</span> <strong>${list.length}</strong></div>
                <div><span style="color:var(--muted);">With Recorded Scores:</span> <strong style="color:var(--primary);">${withScores.length} / ${list.length}</strong></div>
                <div><span style="color:var(--muted);">Ready to Process:</span> <span class="badge ok" style="font-size:11px;">100% Automated</span></div>
            </div>
        </div>

        <div class="row" style="margin-bottom:12px;">
            <div class="field">
                <label style="font-weight:700;">Overall Narrative Tone</label>
                <select id="batchTeachTone" style="width:100%;">
                    <option value="auto" selected>✨ Auto-Adaptive (Scores-driven: High/Mid/Low)</option>
                    <option value="positive">🌟 Positive (Exemplary &amp; Commendable for All)</option>
                    <option value="middle">⚖️ Middle (Satisfactory &amp; Fair Progress)</option>
                    <option value="negative">⚠️ Remedial (Needs Support &amp; Extra Study)</option>
                </select>
                <p class="hint" style="margin:3px 0 0;font-size:11px;">Auto-Adaptive awards praise for high marks and recommends revision in weaker areas.</p>
            </div>
            <div class="field">
                <label style="font-weight:700;">Conduct Note Tone</label>
                <select id="batchConductTone" style="width:100%;">
                    <option value="auto" selected>✨ Auto-Adaptive (Disciplined / Cooperative / Needs Focus)</option>
                    <option value="positive">🌟 Exemplary &amp; Disciplined at all times</option>
                    <option value="middle">⚖️ Cooperative with gentle guidance</option>
                    <option value="negative">⚠️ Needs self-discipline &amp; closer attention</option>
                </select>
            </div>
        </div>

        <div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;">
            <div style="font-weight:700;margin-bottom:8px;color:var(--ink);">Automated Field Criteria</div>
            <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer;">
                <input type="checkbox" id="batchUseTopSubject" checked style="margin-top:2px;">
                <div>
                    <strong>Top-Scoring Subject Interest:</strong>
                    <div style="color:var(--muted);font-size:11.5px;">Automatically detects each student's highest scoring subject (e.g. Mathematics, Science, English) and sets it as their interest.</div>
                </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;cursor:pointer;">
                <input type="checkbox" id="batchAutoPromo" checked style="margin-top:2px;">
                <div>
                    <strong>Automatic Class Promotion:</strong>
                    <div style="color:var(--muted);font-size:11.5px;">Recommends "Promoted to [Next Class]" (e.g. Basic 7 &rarr; Basic 8) for averages &ge;45%, and "Repeated" if below.</div>
                </div>
            </label>
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
                <input type="checkbox" id="batchOverwrite" checked style="margin-top:2px;">
                <div>
                    <strong>Overwrite existing remarks:</strong>
                    <div style="color:var(--muted);font-size:11.5px;">Uncheck if you only want to fill remarks for students who currently have empty remarks.</div>
                </div>
            </label>
        </div>

        <div class="actions" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:12px;">
            <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="executeBatchSmartRemarks()">
                <i class="fas fa-magic"></i> Generate for Entire Class (${list.length})
            </button>
        </div>
    `);
}

function executeBatchSmartRemarks() {
    const list = classStudents();
    if (!list.length) return toast('No students in this class.', 'bad');

    const teachTone = document.getElementById('batchTeachTone')?.value || 'auto';
    const conductTone = document.getElementById('batchConductTone')?.value || 'auto';
    const useTopSubject = document.getElementById('batchUseTopSubject')?.checked !== false;
    const autoPromo = document.getElementById('batchAutoPromo')?.checked !== false;
    const overwrite = document.getElementById('batchOverwrite')?.checked !== false;

    let processedCount = 0;

    list.forEach(s => {
        const sid = String(s.id);
        const existing = studentReportDetails[sid] || studentReportDetails[s.id] || {};
        const hasExisting = Boolean(existing.teacherRemarks || existing.conduct || existing.interest);

        if (!overwrite && hasExisting) {
            return;
        }

        const data = calculateSmartRemarksData(sid, {
            teachTone,
            conductTone,
            useTopSubject,
            autoPromo
        });

        studentReportDetails[sid] = {
            attendance: (typeof Attendance !== 'undefined' && Attendance.label(s.id)) || existing.attendance || '',
            promotionStatus: data.promotionStatus || existing.promotionStatus || '',
            promotionTarget: data.promotionTarget || existing.promotionTarget || '',
            conduct: data.conduct || existing.conduct || '',
            interest: data.interest || existing.interest || '',
            teacherRemarks: data.teacherRemarks || existing.teacherRemarks || ''
        };

        if (!isNaN(Number(s.id))) {
            studentReportDetails[Number(s.id)] = studentReportDetails[sid];
        }
        processedCount++;
    });

    persistDetails();
    closeModal();
    toast(`✨ Smart remarks generated and applied for ${processedCount} student${processedCount === 1 ? '' : 's'}!`, 'ok');
    renderReports();
}

function saveRemarks(id) {
    const sid = String(id);
    // Save attendance overrides if changed
    if (typeof Attendance !== 'undefined') {
        const presentInput = document.getElementById('rmAttPresent');
        const totalInput = document.getElementById('rmAttTotal');
        if (presentInput && presentInput.value.trim() !== '') {
            const n = Number(presentInput.value);
            if (!isNaN(n) && n >= 0) Attendance.setPresentOverride(id, n);
        }
        if (totalInput && totalInput.value.trim() !== '') {
            const n = Number(totalInput.value);
            if (!isNaN(n) && n >= 0 && typeof Attendance.setStudentDays === 'function') Attendance.setStudentDays(id, n);
        }
    }
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

function formatOrdinal(n) {
    if (!n || isNaN(n)) return '';
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getStudentClassRank(studentId, className) {
    const targetClass = className || currentClass || '';
    const classMates = (students || []).filter(s => (s.class || '') === targetClass && !s.isDeleted && s.status !== 'deleted');
    if (!classMates.length) return null;

    const ranked = classMates.map(s => {
        const p = studentPerf(String(s.id));
        return {
            id: String(s.id),
            avg: (p && p.items && p.items.length > 0) ? p.avg : -1
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

// ── Unified report HTML generator (same layout across Admin / Teacher / Student) ──
function buildUnifiedReportHTML(id) {
    const s = students.find(x => String(x.id) === String(id));
    if (!s) return '';
    const d = studentReportDetails[id] || studentReportDetails[String(id)] || {};
    const className = s.class || currentClass || 'Class';
    const subs = allClassSubjects(className);
    const logo = schoolLogoSrc();
    const settings = schoolSettings || {};
    const fieldToggles = settings.fieldToggles || {};
    const showPosition = fieldToggles.showPosition !== false;
    const showLogo = fieldToggles.showSchoolLogo !== false;
    const showMotto = fieldToggles.showSchoolMotto !== false;
    const showNextTerm = fieldToggles.showNextTerm !== false;
    const showAttendance = fieldToggles.showAttendance !== false;
    const showConduct = fieldToggles.showConduct !== false;
    const showPromotion = fieldToggles.showPromotionStatus !== false;
    const showTeacherRemark = fieldToggles.showClassTeacherRemark !== false;
    const showSignature = fieldToggles.showSignature !== false;

    let positionText = '—';
    if (showPosition) {
        const rankInfo = getStudentClassRank(id, className);
        if (rankInfo && rankInfo.formatted) {
            positionText = rankInfo.formatted;
        }
    }

    const primaryColor = settings.primaryColor || '#4f46e5';
    const secondaryColor = settings.secondaryColor || '#7e3af2';
    const headerTextColor = settings.headerTextColor || '#ffffff';
    const primaryDark = (typeof adjustColorBrightness === 'function') ? adjustColorBrightness(primaryColor, -15) : '#4338ca';

    const logoEl = (showLogo && logo)
        ? `<img src="${logo}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo" crossorigin="anonymous">`
        : (showLogo ? `<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>` : '');

    const scale = typeof gradeScale === 'function' ? gradeScale(className) : DEFAULT_GRADES;
    const jhsKeywords = ['basic 7','basic 8','basic 9','jhs 1','jhs 2','jhs 3','jhs'];
    const isJHS = jhsKeywords.some(k => String(className).toLowerCase().includes(k));

    function getEffectiveGrade(tot) {
        return getGrade(tot, className);
    }

    let totalScoreSum = 0, scoredCount = 0;
    const subjectRows = [];
    const jhsSubjectResults = [];

    const allResults = loadJSON('results', []);

    (subs || []).forEach(sub => {
        const e = getScoreEntry(sub, id);
        // Check if this result is approved
        const resultRecord = allResults.find(r =>
            (String(r.studentId) === String(id) || String(r.studentId) === String(s.id)) &&
            (r.subjectName === sub || r.subjectId === sub)
        );
        const resultApproved = resultRecord && ['approved','published'].includes(String(resultRecord.status || '').toLowerCase());

        if (e && e.classScore !== '' && e.examScore !== '' && resultApproved) {
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
                <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:${primaryColor}1a;color:${primaryDark};">${g.grade}</span></td>
                <td style="padding:8px 10px;border:1px solid #cbd5e1;">${g.remark}</td>
            </tr>`);
        } else if (e && e.classScore !== '' && e.examScore !== '' && !resultApproved) {
            jhsSubjectResults.push({ sub, tot: null, grade: 99 });
            subjectRows.push(`<tr>
                <td style="text-align:left;font-weight:600;padding:8px 10px;border:1px solid #cbd5e1;">${esc(sub)}</td>
                <td colspan="5" style="padding:8px 10px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;font-style:italic;"><i class="fas fa-clock"></i> Pending Admin Approval</td>
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
        jhsAggregateHTML = `
        <div style="background:${primaryDark};color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;">
            <div style="font-weight:700;font-size:13px;letter-spacing:0.5px;">TOTAL AGGREGATE</div>
            <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;margin-top:2px;">${totalAgg}</div>
        </div>`;
    }


    return `
    <div id="printableReportCard" style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',Arial,sans-serif;max-width:800px;margin:0 auto;box-sizing:border-box;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${primaryColor};padding-bottom:14px;margin-bottom:18px;">
            ${logoEl}
            <div style="text-align:center;flex:1;padding:0 12px;">
                <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;letter-spacing:-0.5px;">${esc(settings.schoolName || schoolName())}</h2>
                <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${esc(settings.address || '')}</p>
                <p style="font-size:11.5px;color:${primaryColor};font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${esc(settings.motto || 'Drink deep or taste not the spring of knowledge')}&rdquo;</em></p>
                <div style="display:inline-block;background:${primaryColor};color:${headerTextColor};font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:0.5px;">
                    END OF ${esc(String(tm).toUpperCase())} REPORT SHEET
                </div>
            </div>
            ${logoEl}
        </div>

        <div class="report-meta-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#f8fafc;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #e2e8f0;">
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">NAME OF LEARNER</span><strong>${esc(s.name)}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS</span><strong>${esc(className)}</strong></div>
            ${showPosition ? `<div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="color:${primaryDark};font-size:13.5px;">${esc(positionText)}</strong></div>` : ''}
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">ACADEMIC YEAR</span><strong>${esc(yr)}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">TERM</span><strong>${esc(tm)}</strong></div>
            ${showNextTerm ? `
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">DATE OF VACATION</span><strong>${esc(schoolInfo.closingDate || '—')}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">RE-OPENING DATE</span><strong>${esc(schoolInfo.reopeningDate || '—')}</strong></div>
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
                <tbody>${subjectRows.join('') || '<tr><td colspan="6" style="padding:16px;color:#94a3b8;">No subjects assigned</td></tr>'}</tbody>
            </table>
        </div>

        ${jhsAggregateHTML}

        <div class="report-perf-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#eef2ff;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #c7d2fe;">
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">OVERALL AVERAGE GRADE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? overallGrade.grade + ' (' + overallGrade.remark + ')' : '—'}</strong></div>
            ${showPosition ? `<div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="font-size:14px;color:#1e1b4b;">${esc(positionText)}</strong></div>` : ''}
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount} / ${subs.length}</strong></div>
        </div>

        ${(() => {
            const prog = typeof getStudentTermProgression === 'function' ? getStudentTermProgression(id) : null;
            if (!prog || prog.termCount <= 1) return '';
            let trajColor = prog.trajectory === 'improving' ? '#166534' : (prog.trajectory === 'declining' ? '#991b1b' : '#334155');
            let trajBg = prog.trajectory === 'improving' ? '#dcfce7' : (prog.trajectory === 'declining' ? '#fee2e2' : '#f1f5f9');
            let trajBorder = prog.trajectory === 'improving' ? '#86efac' : (prog.trajectory === 'declining' ? '#fca5a5' : '#cbd5e1');
            return `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin-bottom:14px;font-size:11.5px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div>
                    <span style="font-weight:700;color:#475569;margin-right:6px;font-size:10.5px;text-transform:uppercase;">Term Progression:</span>
                    <span>T1: <strong>${prog.t1 !== null ? prog.t1 + '%' : '—'}</strong></span>
                    <span style="margin:0 5px;color:#cbd5e1;">·</span>
                    <span>T2: <strong>${prog.t2 !== null ? prog.t2 + '%' : '—'}</strong></span>
                    <span style="margin:0 5px;color:#cbd5e1;">·</span>
                    <span>T3: <strong>${prog.t3 !== null ? prog.t3 + '%' : '—'}</strong></span>
                </div>
                <div style="display:inline-flex;align-items:center;gap:6px;">
                    <span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${trajBg};color:${trajColor};border:1px solid ${trajBorder};">
                        ${prog.trajectoryLabel}
                    </span>
                </div>
            </div>`;
        })()}

        <div class="report-conduct-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-bottom:14px;font-size:12px;">
            <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Attendance:</span> ${esc(attendanceLabel(id, d))}</div>
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Conduct:</span> ${esc(d.conduct || '—')}</div>
                <div><span style="color:#64748b;font-weight:600;">Interest:</span> ${esc(d.interest || '—')}</div>
            </div>
            <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Promoted to / In:</span> ${esc(d.promotionTarget || (d.promotionStatus || '—'))}</div>
                <div><span style="color:#64748b;font-weight:600;">Teacher's Remarks:</span> <em>${esc(d.teacherRemarks || '—')}</em></div>
            </div>
        </div>

        <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569;gap:20px;">
            <div style="flex:1;">
                <div><strong>Class Teacher:</strong> ${esc(classTeacherName(className) || '—')}</div>
                ${classTeacherSignatureSrc(className) ? `<div style="height:28px;margin-top:2px;display:flex;align-items:flex-end;"><img src="${classTeacherSignatureSrc(className)}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Class Teacher Signature" crossorigin="anonymous"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
            </div>
            <div style="flex:1;text-align:right;">
                <div><strong>Headteacher:</strong> ${esc(headTeacherName() || '—')}</div>
                ${headTeacherSignatureSrc() ? `<div style="height:28px;margin-top:2px;display:flex;justify-content:flex-end;align-items:flex-end;"><img src="${headTeacherSignatureSrc()}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Headteacher Signature" crossorigin="anonymous"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
            </div>
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
    // Show/hide action buttons based on approval status
    const approved = isApproved(id);
    const printBtn = document.getElementById('previewPrintBtn');
    const dlBtn = document.getElementById('previewDownloadBtn');
    const badge = document.getElementById('previewUnapprovedBadge');
    if (printBtn) printBtn.style.display = approved ? '' : 'none';
    if (dlBtn) dlBtn.style.display = approved ? '' : 'none';
    if (badge) badge.style.display = approved ? 'none' : '';
}

function closePreview() {
    const modal = document.getElementById('previewModal');
    if (modal) modal.style.display = 'none';
}

function printTeacherPreview() {
    if (!currentPreviewReportStudentId || !isApproved(currentPreviewReportStudentId)) {
        return toast('This report has not been approved by admin yet. Printing is locked.', 'bad');
    }
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
    if (!currentPreviewReportStudentId) return toast('No preview selected.', 'bad');
    if (!isApproved(currentPreviewReportStudentId)) {
        return toast('This report has not been approved by admin yet. Download is locked.', 'bad');
    }
    downloadReport(currentPreviewReportStudentId);
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
    if (!isApproved(id)) {
        return toast('This report has not been approved by admin yet. Download is locked.', 'bad');
    }
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
    // Only download approved reports
    const approvedList = list.filter(s => isApproved(s.id));
    if (!approvedList.length) return toast('No approved reports to download. Admin must approve reports first.', 'bad');
    if (window.OneRealFiles) OneRealFiles.arm();
    if (typeof JSZip === 'undefined') return toast('ZIP library missing.', 'bad');
    toast(`Preparing ZIP for ${approvedList.length} approved report(s)...`, 'ok');
    const zip = new JSZip();
    let count = 0;
    for (let i = 0; i < approvedList.length; i++) {
        const s = approvedList[i];
        try {
            toast(`Building report ${i + 1} of ${approvedList.length}...`, 'ok');
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
    const name = (currentClass || 'class').replace(/\s/g, '_') + '_approved_reports.zip';
    await downloadBlobFile(zipBlob, name, 'application/zip');
    toast(`Downloaded ${count} approved report(s) in ZIP successfully!`, 'ok');
}

let currentPerfView = 'ranking';

function setPerfView(view) {
    currentPerfView = view;
    renderPerformance();
}

function getStudentTermProgression(studentId) {
    const sId = String(studentId);
    const history = loadJSON('termProgressionHistory', {});
    const stuHist = history[sId] || {};

    const allResults = loadJSON('results', []);
    const currTermNum = String(schoolInfo.term || '1');
    const currentPerf = studentPerf(sId);
    const currentAvg = currentPerf ? Math.round(currentPerf.avg * 10) / 10 : null;

    let t1 = (stuHist.term1 !== undefined && stuHist.term1 !== null && stuHist.term1 !== '') ? Number(stuHist.term1) : null;
    let t2 = (stuHist.term2 !== undefined && stuHist.term2 !== null && stuHist.term2 !== '') ? Number(stuHist.term2) : null;
    let t3 = (stuHist.term3 !== undefined && stuHist.term3 !== null && stuHist.term3 !== '') ? Number(stuHist.term3) : null;

    // Check stored results collection if any
    ['1', '2', '3'].forEach(tNum => {
        if (tNum === currTermNum && currentAvg !== null) {
            if (tNum === '1' && t1 === null) t1 = currentAvg;
            if (tNum === '2' && t2 === null) t2 = currentAvg;
            if (tNum === '3' && t3 === null) t3 = currentAvg;
        } else {
            const termRes = allResults.filter(r => String(r.studentId) === sId && String(r.termId || '') === tNum && r.totalScore !== '' && r.totalScore !== undefined);
            if (termRes.length > 0) {
                const sum = termRes.reduce((acc, curr) => acc + Number(curr.totalScore || 0), 0);
                const avg = Math.round((sum / termRes.length) * 10) / 10;
                if (tNum === '1' && t1 === null) t1 = avg;
                if (tNum === '2' && t2 === null) t2 = avg;
                if (tNum === '3' && t3 === null) t3 = avg;
            }
        }
    });

    // If current term is set, ensure current term reflects live calculation
    if (currTermNum === '1' && currentAvg !== null) t1 = currentAvg;
    if (currTermNum === '2' && currentAvg !== null) t2 = currentAvg;
    if (currTermNum === '3' && currentAvg !== null) t3 = currentAvg;

    const termValues = [t1, t2, t3].filter(v => v !== null && !isNaN(v));
    const cumulativeAvg = termValues.length ? Math.round((termValues.reduce((a, b) => a + b, 0) / termValues.length) * 10) / 10 : null;

    let trajectory = 'steady';
    let trajectoryLabel = 'Steady (±0.0%)';
    let diff = 0;

    if (t3 !== null && t2 !== null) {
        diff = Math.round((t3 - t2) * 10) / 10;
    } else if (t2 !== null && t1 !== null) {
        diff = Math.round((t2 - t1) * 10) / 10;
    } else if (t3 !== null && t1 !== null) {
        diff = Math.round((t3 - t1) * 10) / 10;
    }

    if (termValues.length < 2) {
        trajectory = 'initial';
        trajectoryLabel = 'Baseline Term';
    } else if (diff >= 1.5) {
        trajectory = 'improving';
        trajectoryLabel = `Improving (+${diff}%)`;
    } else if (diff <= -1.5) {
        trajectory = 'declining';
        trajectoryLabel = `Declining (${diff}%)`;
    } else {
        trajectory = 'steady';
        trajectoryLabel = `Steady (${diff >= 0 ? '+' : ''}${diff}%)`;
    }

    return {
        t1, t2, t3,
        cumulativeAvg,
        trajectory,
        trajectoryLabel,
        diff,
        termCount: termValues.length
    };
}

function saveStudentTermProgression(studentId, t1Val, t2Val, t3Val) {
    const history = loadJSON('termProgressionHistory', {});
    const sId = String(studentId);
    history[sId] = {
        term1: t1Val !== '' && !isNaN(Number(t1Val)) ? Number(t1Val) : null,
        term2: t2Val !== '' && !isNaN(Number(t2Val)) ? Number(t2Val) : null,
        term3: t3Val !== '' && !isNaN(Number(t3Val)) ? Number(t3Val) : null
    };
    saveJSON('termProgressionHistory', history);
    closeModal();
    toast('Term progression history updated.', 'ok');
    renderPerformance();
}

function openEditTermProgressionModal(studentId) {
    const sId = String(studentId);
    const s = students.find(x => String(x.id) === sId);
    if (!s) return;
    const prog = getStudentTermProgression(sId);

    openModal(`
        <div class="modal-head" style="margin-bottom:12px;">
            <h3 style="margin:0;display:flex;align-items:center;gap:8px;font-size:16px;">
                <i class="fas fa-chart-line" style="color:var(--primary);"></i> Edit Term Averages: ${esc(s.name)}
            </h3>
            <p class="hint" style="margin:4px 0 0;font-size:12px;">
                Record or adjust historical term averages to track this student's multi-term academic trajectory.
            </p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-bottom:14px;">
            <div class="field">
                <label style="font-weight:700;">Term 1 Average (%)</label>
                <input type="number" step="0.1" min="0" max="100" id="progT1" value="${prog.t1 !== null ? prog.t1 : ''}" placeholder="e.g. 68.5">
            </div>
            <div class="field">
                <label style="font-weight:700;">Term 2 Average (%)</label>
                <input type="number" step="0.1" min="0" max="100" id="progT2" value="${prog.t2 !== null ? prog.t2 : ''}" placeholder="e.g. 72.0">
            </div>
            <div class="field">
                <label style="font-weight:700;">Term 3 Average (%)</label>
                <input type="number" step="0.1" min="0" max="100" id="progT3" value="${prog.t3 !== null ? prog.t3 : ''}" placeholder="e.g. 75.4">
            </div>
        </div>

        <div class="actions" style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:12px;">
            <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="saveStudentTermProgression('${sId}', document.getElementById('progT1').value, document.getElementById('progT2').value, document.getElementById('progT3').value)">
                <i class="fas fa-save"></i> Save Term History
            </button>
        </div>
    `);
}

function exportSubjectRemedial(subject) {
    const list = classStudents();
    const rows = [];
    list.forEach(s => {
        const sc = studentScoreObj(s.id, subject);
        if (sc && sc.total !== undefined && sc.total < 50) {
            rows.push({
                Student: s.name,
                Class: s.class || currentClass,
                Subject: subject,
                ClassScore_50: sc.classScore,
                ExamScore_50: sc.examScore,
                TotalScore_100: sc.total,
                Grade: sc.grade,
                Remarks: sc.remark,
                InterventionNeeded: 'Extra Class Remedial Support'
            });
        }
    });
    if (!rows.length) return toast(`No remedial students recorded for ${subject}.`, 'ok');
    const csv = window.OneRealFiles ? OneRealFiles.toCsv(rows) : JSON.stringify(rows);
    const name = `${(currentClass || 'class').replace(/\s/g, '_')}_${subject.replace(/\s/g, '_')}_remedial_list.csv`;
    downloadBlobFile(csv, name, 'text/csv;charset=utf-8');
    toast(`Remedial list for ${subject} exported.`, 'ok');
}

function exportTermProgression() {
    const list = classStudents();
    const rows = list.map(s => {
        const prog = getStudentTermProgression(s.id);
        return {
            Student: s.name,
            Class: s.class || currentClass,
            Term1_Average: prog.t1 !== null ? prog.t1 : '',
            Term2_Average: prog.t2 !== null ? prog.t2 : '',
            Term3_Average: prog.t3 !== null ? prog.t3 : '',
            Cumulative_Average: prog.cumulativeAvg !== null ? prog.cumulativeAvg : '',
            Trajectory: prog.trajectoryLabel,
            Delta: prog.diff
        };
    });
    const csv = window.OneRealFiles ? OneRealFiles.toCsv(rows) : JSON.stringify(rows);
    const name = `${(currentClass || 'class').replace(/\s/g, '_')}_term_progression.csv`;
    downloadBlobFile(csv, name, 'text/csv;charset=utf-8');
    toast('Term-over-Term Progression spreadsheet exported.', 'ok');
}

function toggleRemedialList(subId) {
    const el = document.getElementById(`remedial-box-${subId}`);
    if (el) {
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
}

function renderPerformance() {
    const list = classStudents();
    const rows = list.map(s => {
        const p = studentPerf(s.id);
        return { s, avg: p ? p.avg : 0, grade: p ? p.grade : '—', remark: p ? p.remark : 'No scores' };
    }).sort((a, b) => b.avg - a.avg);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const withScores = rows.filter(r => r.avg);
    const classAvg = withScores.length ? (withScores.reduce((a, b) => a + b.avg, 0) / withScores.length) : 0;

    // Sub-navigation bar
    const subnavHtml = `
        <div class="perf-subnav">
            <button type="button" class="perf-subnav-btn ${currentPerfView === 'ranking' ? 'active' : ''}" onclick="setPerfView('ranking')">
                <i class="fas fa-list-ol"></i> Class Ranking &amp; Averages
            </button>
            <button type="button" class="perf-subnav-btn ${currentPerfView === 'subjects' ? 'active' : ''}" onclick="setPerfView('subjects')">
                <i class="fas fa-chart-bar"></i> Subject Performance &amp; Remedials
            </button>
            <button type="button" class="perf-subnav-btn ${currentPerfView === 'progression' ? 'active' : ''}" onclick="setPerfView('progression')">
                <i class="fas fa-chart-line"></i> Term-over-Term Progression
            </button>
        </div>
    `;

    let mainContentHtml = '';

    if (currentPerfView === 'subjects') {
        // --- 1. Subject Performance Breakdown & Remedial Analysis ---
        const subs = allClassSubjects(currentClass);
        const subjectStats = subs.map(sub => {
            const studentScores = [];
            list.forEach(s => {
                const sc = studentScoreObj(s.id, sub);
                if (sc && sc.total !== undefined && sc.classScore !== '' && sc.examScore !== '') {
                    studentScores.push({ student: s, scoreObj: sc, total: Number(sc.total) });
                }
            });

            const scoredCount = studentScores.length;
            const avg = scoredCount ? (studentScores.reduce((sum, item) => sum + item.total, 0) / scoredCount) : 0;
            const passCount = studentScores.filter(item => item.total >= 50).length;
            const remedialCohort = studentScores.filter(item => item.total < 50);
            const passRate = scoredCount ? Math.round((passCount / scoredCount) * 100) : 0;
            const maxScore = scoredCount ? Math.max(...studentScores.map(i => i.total)) : 0;
            const minScore = scoredCount ? Math.min(...studentScores.map(i => i.total)) : 0;

            let barClass = 'strong';
            let badgeClass = 'strong';
            let badgeLabel = 'High Performing';

            if (avg < 50 || (scoredCount > 0 && passRate < 55)) {
                barClass = 'remedial';
                badgeClass = 'alert';
                badgeLabel = 'Urgent Remedial Support';
            } else if (avg < 60 || remedialCohort.length > 0) {
                barClass = 'fair';
                badgeClass = 'fair';
                badgeLabel = 'Remedial Attention';
            } else if (avg < 75) {
                barClass = 'good';
                badgeClass = 'strong';
                badgeLabel = 'Satisfactory';
            }

            return {
                subject: sub,
                avg: Math.round(avg * 10) / 10,
                scoredCount,
                passCount,
                passRate,
                remedialCount: remedialCohort.length,
                remedialCohort,
                maxScore,
                minScore,
                barClass,
                badgeClass,
                badgeLabel
            };
        }).sort((a, b) => a.avg - b.avg); // Sort weakest subjects first to immediately show remedial needs

        const remedialSubjectsCount = subjectStats.filter(s => s.remedialCount > 0 || (s.scoredCount > 0 && s.avg < 50)).length;
        const topSubject = subjectStats.length ? subjectStats.slice().sort((a, b) => b.avg - a.avg)[0] : null;

        mainContentHtml = `
            <div class="card" style="margin-bottom:14px;">
                <div class="stats-row">
                    <div class="stat"><b>${subs.length}</b><span>Total Subjects</span></div>
                    <div class="stat"><b style="color:${remedialSubjectsCount > 0 ? '#ef4444' : '#10b981'};">${remedialSubjectsCount}</b><span>Needs Remedials</span></div>
                    <div class="stat"><b>${topSubject && topSubject.scoredCount ? topSubject.avg + '%' : '—'}</b><span>Top Subject (${esc(topSubject ? topSubject.subject : '—')})</span></div>
                    <div class="stat"><b>${classAvg.toFixed(1)}%</b><span>Class Average</span></div>
                </div>
            </div>

            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
                    <div>
                        <h4 style="margin:0;font-size:15px;color:var(--ink);">Subject Comparison &amp; Extra Class Remedial Identifier</h4>
                        <p class="hint" style="margin:3px 0 0;font-size:12px;">Compare subject averages across ${esc(currentClass || 'the class')} to identify curriculum areas where students need extra class intervention.</p>
                    </div>
                </div>

                ${subjectStats.length === 0 ? '<div class="empty">No subjects assigned for this class.</div>' : `
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        ${subjectStats.map((st, idx) => {
                            const subSafeId = 'sub-' + idx;
                            return `
                            <div class="subject-perf-card">
                                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                                    <div>
                                        <div style="font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px;">
                                            ${esc(st.subject)}
                                            <span class="remedial-badge ${st.badgeClass}">
                                                ${st.remedialCount > 0 ? `<i class="fas fa-exclamation-triangle"></i> ${st.remedialCount} Remedial Student${st.remedialCount === 1 ? '' : 's'}` : `<i class="fas fa-check-circle"></i> ${st.badgeLabel}`}
                                            </span>
                                        </div>
                                        <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
                                            ${st.scoredCount} student${st.scoredCount === 1 ? '' : 's'} assessed · Pass Rate: <strong>${st.passRate}%</strong> (${st.passCount}/${st.scoredCount}) · Range: ${st.minScore}% &ndash; ${st.maxScore}%
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <div style="font-size:18px;font-weight:800;color:var(--ink);">${st.scoredCount ? st.avg + '%' : '—'}</div>
                                        <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;font-weight:700;">Subject Average</div>
                                    </div>
                                </div>

                                <div class="subject-bar-track" title="Subject Average: ${st.avg}%">
                                    <div class="subject-bar-fill ${st.barClass}" style="width:${Math.min(100, Math.max(0, st.avg))}%;"></div>
                                </div>

                                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:6px;font-size:11.5px;">
                                    <div style="color:var(--muted);">
                                        50% Benchmark: <strong style="color:${st.avg >= 50 ? '#10b981' : '#ef4444'};">${st.avg >= 50 ? 'Passed (+' + (Math.round((st.avg - 50)*10)/10) + '%)' : 'Below Pass Mark (' + (Math.round((st.avg - 50)*10)/10) + '%)'}</strong>
                                    </div>
                                    <div style="display:flex;gap:8px;">
                                        ${st.remedialCount > 0 ? `
                                            <button type="button" class="btn btn-ghost btn-sm" onclick="toggleRemedialList('${subSafeId}')" style="font-size:11px;padding:3px 8px;">
                                                <i class="fas fa-users-cog"></i> ${st.remedialCohort.length} Remedial Students <i class="fas fa-chevron-down" style="font-size:9px;"></i>
                                            </button>
                                            <button type="button" class="btn btn-ghost btn-sm" onclick="exportSubjectRemedial('${esc(st.subject)}')" style="font-size:11px;padding:3px 8px;">
                                                <i class="fas fa-file-csv"></i> Export List
                                            </button>
                                        ` : '<span style="color:#10b981;font-size:11px;font-weight:600;"><i class="fas fa-check"></i> All students above 50%</span>'}
                                    </div>
                                </div>

                                ${st.remedialCount > 0 ? `
                                    <div id="remedial-box-${subSafeId}" class="remedial-box" style="display:none;">
                                        <div style="font-weight:700;color:#991b1b;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                                            <i class="fas fa-bullhorn"></i> Remedial Cohort for ${esc(st.subject)} (Scores below 50%):
                                        </div>
                                        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:6px;">
                                            ${st.remedialCohort.map(rc => `
                                                <div style="background:#fff;border:1px solid #fecdd3;border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">
                                                    <div>
                                                        <strong style="color:#1e293b;font-size:11.5px;">${esc(rc.student.name)}</strong>
                                                        <div style="color:#64748b;font-size:10.5px;">Class: ${rc.scoreObj.classScore || '0'} | Exam: ${rc.scoreObj.examScore || '0'}</div>
                                                    </div>
                                                    <div style="text-align:right;">
                                                        <span style="font-weight:800;color:#dc2626;font-size:12.5px;">${rc.total}%</span>
                                                        <div style="font-size:10px;color:#dc2626;font-weight:700;">Grade: ${rc.scoreObj.grade || '—'}</div>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>`;
                        }).join('')}
                    </div>
                `}
            </div>
        `;
    } else if (currentPerfView === 'progression') {
        // --- 2. Term-over-Term Progression (Term 1 -> Term 2 -> Term 3) ---
        const progRows = list.map(s => {
            const prog = getStudentTermProgression(s.id);
            return { s, prog };
        });

        const improvingCount = progRows.filter(r => r.prog.trajectory === 'improving').length;
        const steadyCount = progRows.filter(r => r.prog.trajectory === 'steady').length;
        const decliningCount = progRows.filter(r => r.prog.trajectory === 'declining').length;

        mainContentHtml = `
            <div class="card" style="margin-bottom:14px;">
                <div class="stats-row">
                    <div class="stat"><b style="color:#10b981;">▲ ${improvingCount}</b><span>Improving</span></div>
                    <div class="stat"><b style="color:#64748b;">▶ ${steadyCount}</b><span>Steady</span></div>
                    <div class="stat"><b style="color:#ef4444;">▼ ${decliningCount}</b><span>Declining</span></div>
                    <div class="stat"><b>${list.length}</b><span>Total Cohort</span></div>
                </div>
            </div>

            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
                    <div>
                        <h4 style="margin:0;font-size:15px;color:var(--ink);">Term-over-Term Student Progression (Term 1 &rarr; Term 2 &rarr; Term 3)</h4>
                        <p class="hint" style="margin:3px 0 0;font-size:12px;">Track whether each student's academic performance is improving, steady, or declining across consecutive terms.</p>
                    </div>
                    <div class="actions">
                        <button type="button" class="btn btn-ghost btn-sm" onclick="exportTermProgression()">
                            <i class="fas fa-file-csv"></i> Export Progression CSV
                        </button>
                    </div>
                </div>

                <div class="table-wrap"><table class="score-table">
                    <thead>
                        <tr>
                            <th>Student</th>
                            <th>Term 1 (50%)</th>
                            <th>Term 2 (50%)</th>
                            <th>Term 3 (50%)</th>
                            <th>Annual Avg</th>
                            <th>Trajectory</th>
                            <th style="text-align:center;">Trend</th>
                            <th style="text-align:right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${progRows.map(r => {
                            const p = r.prog;
                            let trajClass = p.trajectory;
                            let sparkT1 = p.t1 !== null ? Math.max(10, Math.min(100, p.t1)) * 0.16 : 3;
                            let sparkT2 = p.t2 !== null ? Math.max(10, Math.min(100, p.t2)) * 0.16 : 3;
                            let sparkT3 = p.t3 !== null ? Math.max(10, Math.min(100, p.t3)) * 0.16 : 3;

                            return `<tr>
                                <td><strong>${esc(r.s.name)}</strong></td>
                                <td>${p.t1 !== null ? p.t1.toFixed(1) + '%' : '<span style="color:#94a3b8;">—</span>'}</td>
                                <td>${p.t2 !== null ? p.t2.toFixed(1) + '%' : '<span style="color:#94a3b8;">—</span>'}</td>
                                <td>${p.t3 !== null ? p.t3.toFixed(1) + '%' : '<span style="color:#94a3b8;">—</span>'}</td>
                                <td><strong>${p.cumulativeAvg !== null ? p.cumulativeAvg.toFixed(1) + '%' : '—'}</strong></td>
                                <td>
                                    <span class="trajectory-pill ${trajClass}">
                                        ${p.trajectory === 'improving' ? '<i class="fas fa-arrow-up"></i>' : (p.trajectory === 'declining' ? '<i class="fas fa-arrow-down"></i>' : '<i class="fas fa-minus"></i>')}
                                        ${p.trajectoryLabel}
                                    </span>
                                </td>
                                <td style="text-align:center;">
                                    <div class="term-sparkline" title="T1: ${p.t1 || '—'} | T2: ${p.t2 || '—'} | T3: ${p.t3 || '—'}">
                                        <div class="term-spark-bar t1" style="height:${sparkT1}px;"></div>
                                        <div class="term-spark-bar t2" style="height:${sparkT2}px;"></div>
                                        <div class="term-spark-bar t3" style="height:${sparkT3}px;"></div>
                                    </div>
                                </td>
                                <td style="text-align:right;">
                                    <button type="button" class="btn btn-ghost btn-sm" onclick="openEditTermProgressionModal('${r.s.id}')" title="Edit historical term scores">
                                        <i class="fas fa-edit"></i> Edit Terms
                                    </button>
                                </td>
                            </tr>`;
                        }).join('') || '<tr><td colspan="8" style="text-align:center;padding:16px;color:#94a3b8;">No students registered.</td></tr>'}
                    </tbody>
                </table></div>
            </div>
        `;
    } else {
        // --- 3. Class Ranking & Averages ---
        mainContentHtml = `
            <div class="card" style="margin-bottom:14px;">
                <div class="stats-row">
                    <div class="stat"><b>${withScores.length}</b><span>Ranked Students</span></div>
                    <div class="stat"><b>${classAvg.toFixed(1)}%</b><span>Class Average</span></div>
                    <div class="stat"><b>${rows.length ? (rows[0].avg ? rows[0].avg.toFixed(1) + '%' : '—') : '—'}</b><span>Highest Score</span></div>
                </div>
            </div>
            <div class="card">
                <div class="actions" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0;font-size:15px;color:var(--ink);">Official Class Ranking</h4>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <a class="btn btn-ghost btn-sm" id="exportPerformanceBtn" href="/open?src=/api/export/performance.xlsx"><i class="fas fa-file-excel"></i> Export Excel</a>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="exportPerformance()"><i class="fas fa-file-csv"></i> Export CSV</button>
                    </div>
                </div>
                <div class="table-wrap"><table class="score-table">
                    <thead><tr><th>Rank</th><th>Student</th><th>Average</th><th>Grade</th><th>Level</th></tr></thead>
                    <tbody>${rows.map(r => `<tr>
                        <td><strong>#${r.rank}</strong></td><td>${esc(r.s.name)}</td>
                        <td><strong>${r.avg ? r.avg.toFixed(1) + '%' : '—'}</strong></td>
                        <td>${esc(r.grade)}</td><td>${esc(r.remark)}</td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </div>`;
    }

    document.getElementById('tab-performance').innerHTML = `
        ${subnavHtml}
        ${mainContentHtml}
    `;

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
    const defaultDays = (typeof Attendance.defaultDays === 'function') ? (Attendance.defaultDays() || '') : '';
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
        </div>
        <div class="card" style="margin-top:18px;">
            <h3 style="margin-bottom:6px;"><i class="fas fa-sliders-h"></i> Manual Attendance Overrides &amp; Term Totals</h3>
            <p class="hint">Enter values here to override daily register counts. Overridden values are used on report cards and will not be changed by daily marking.</p>
            <div class="field" style="max-width:280px;margin-bottom:14px;">
                <label>Term School Days (default for all students)</label>
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" id="teacherTermDaysInput" min="1" max="365" value="${esc(String(defaultDays))}" placeholder="e.g. 60" style="max-width:120px;">
                    <button class="btn btn-primary btn-sm" onclick="teacherSaveTermDays()"><i class="fas fa-save"></i> Save</button>
                </div>
                <p class="hint" style="margin-top:4px;">This sets the OUT OF figure for all students unless individually overridden below.</p>
            </div>
            <div class="table-wrap"><table class="score-table" id="attTotalsBody">
                <thead><tr><th>Student</th><th>Days Present Override</th><th>Student Total Days</th><th>Report label</th></tr></thead>
                <tbody>
                    ${list.map(s => {
                        const overridePresent = (Attendance.hasPresentOverride && Attendance.hasPresentOverride(s.id)) ? Attendance.presentCount(s.id) : '';
                        const overrideTotal = Attendance.totalDays ? Attendance.totalDays(s.id) : '';
                        return `<tr>
                            <td>${esc(s.name)}</td>
                            <td><input type="number" min="0" class="att-override-input" data-att-override-id="${s.id}" data-att-override-field="present"
                                value="${overridePresent !== '' ? overridePresent : ''}" placeholder="Auto from register"
                                onchange="teacherSetPresentOverride('${s.id}', this.value)" style="width:130px;"></td>
                            <td><input type="number" min="0" class="att-override-input" data-att-override-id="${s.id}" data-att-override-field="total"
                                value="${overrideTotal !== '' && overrideTotal !== defaultDays ? overrideTotal : ''}" placeholder="Use term default"
                                onchange="teacherSetStudentDays('${s.id}', this.value)" style="width:130px;"></td>
                            <td><strong id="attLbl_${s.id}">${esc(Attendance.label(s.id) || '—')}</strong></td>
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

function teacherSetPresentOverride(id, value) {
    if (typeof Attendance === 'undefined') return toast('Attendance module not loaded.', 'bad');
    const v = value === '' || value == null ? null : Number(value);
    if (v === null) {
        // Clear override — restore to register count
        if (typeof Attendance.clearPresentOverride === 'function') {
            Attendance.clearPresentOverride(id);
        } else {
            // Fallback: set to the live register count (removes override intent by calling with register value)
            toast('Clear not supported; override removed.', 'ok');
        }
    } else if (!isNaN(v) && v >= 0) {
        Attendance.setPresentOverride(id, v);
    } else {
        return toast('Invalid attendance value.', 'bad');
    }
    // Update report label in-place without full re-render
    const lbl = document.getElementById('attLbl_' + id);
    if (lbl) lbl.textContent = Attendance.label(id) || '—';
    toast('Attendance override saved.', 'ok');
}

function teacherSetStudentDays(id, value) {
    if (typeof Attendance === 'undefined') return toast('Attendance module not loaded.', 'bad');
    if (typeof Attendance.setStudentDays !== 'function') return toast('setStudentDays not available.', 'bad');
    const v = value === '' || value == null ? null : Number(value);
    if (v === null) {
        if (typeof Attendance.clearStudentDays === 'function') Attendance.clearStudentDays(id);
    } else if (!isNaN(v) && v >= 0) {
        Attendance.setStudentDays(id, v);
    } else {
        return toast('Invalid days value.', 'bad');
    }
    const lbl = document.getElementById('attLbl_' + id);
    if (lbl) lbl.textContent = Attendance.label(id) || '—';
    toast('Student total days saved.', 'ok');
}

function teacherSaveTermDays() {
    if (typeof Attendance === 'undefined') return toast('Attendance module not loaded.', 'bad');
    if (typeof Attendance.setDefaultDays !== 'function') return toast('setDefaultDays not available.', 'bad');
    const input = document.getElementById('teacherTermDaysInput');
    if (!input) return;
    const v = Number(input.value);
    if (isNaN(v) || v <= 0) return toast('Please enter a valid number of school days.', 'bad');
    Attendance.setDefaultDays(v);
    toast(`Term school days set to ${v}.`, 'ok');
    renderAttendance();
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
    const teacherSig = classTeacherSignatureSrc(currentClass);
    const logo = schoolLogoSrc();
    const cls = classRecord(currentClass);
    document.getElementById('tab-info').innerHTML = `
        <div class="card" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <h3 style="margin:0;font-size:15px;display:flex;align-items:center;gap:8px;"><i class="fas fa-signature" style="color:var(--primary);"></i> Class Teacher &amp; Signature</h3>
                <button class="btn btn-primary btn-sm" onclick="openTeacherSignatureModal()"><i class="fas fa-pen-nib"></i> ${teacherSig ? 'Update Signature' : 'Sign / Add Signature'}</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;background:var(--bg);padding:14px;border-radius:10px;border:1px solid var(--line);">
                <div style="flex:1;min-width:200px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:2px;">Class Teacher Assigned</div>
                    <strong style="font-size:14px;color:var(--ink);">${esc(teacher || 'Not assigned by admin')}</strong>
                    <div style="font-size:12px;color:var(--muted);margin-top:2px;">Class: <strong>${esc(currentClass)}</strong></div>
                </div>
                <div style="flex:1;min-width:220px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Signature on Report Cards</div>
                    ${teacherSig ? `
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:4px 10px;display:inline-flex;align-items:center;height:42px;">
                                <img src="${teacherSig}" style="max-height:34px;max-width:140px;object-fit:contain;" alt="Signature">
                            </div>
                            <span class="badge ok" style="font-size:11px;"><i class="fas fa-check-circle"></i> Active</span>
                        </div>
                    ` : `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span class="badge wait" style="font-size:11px;"><i class="fas fa-exclamation-circle"></i> No signature</span>
                            <span style="font-size:12px;color:var(--muted);">Click to draw or upload your signature</span>
                        </div>
                    `}
                </div>
            </div>
        </div>

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

// ─────────────────────────────────────────────────────────────────────────────
// Class Teacher Signature Modal & Controller
// ─────────────────────────────────────────────────────────────────────────────
let sigCanvas = null;
let sigCtx = null;
let isDrawingSig = false;
let sigHasDrawn = false;
let currentSigMode = 'draw';
let activeSigDataUrl = null;
let sigPenColor = '#0f172a';

const CURSIVE_FONTS = [
    { name: 'Brush Script', font: 'Brush Script MT, cursive' },
    { name: 'Dancing Script', font: 'Dancing Script, cursive' },
    { name: 'Great Vibes', font: 'Great Vibes, cursive' },
    { name: 'Segoe Script', font: 'Segoe Script, cursive' },
    { name: 'Caveat', font: 'Caveat, cursive' },
    { name: 'Satisfy', font: 'Satisfy, cursive' }
];

function openTeacherSignatureModal() {
    loadAll();
    const teacher = classTeacherRecord(currentClass) || currentTeacherRecord();
    const tName = classTeacherName(currentClass) || teacher?.name || 'Class Teacher';
    const className = currentClass || 'Class';

    const tNameLabel = document.getElementById('sigTeacherNameLabel');
    if (tNameLabel) tNameLabel.textContent = tName;
    const cNameLabel = document.getElementById('sigClassNameLabel');
    if (cNameLabel) cNameLabel.textContent = className;
    const previewName = document.getElementById('sigPreviewTeacherName');
    if (previewName) previewName.textContent = tName;

    // Load existing signature
    const existingSig = classTeacherSignatureSrc(currentClass) || teacher?.signature || null;
    activeSigDataUrl = existingSig;
    updateSigLivePreview(existingSig);

    const typeInput = document.getElementById('sigTypeNameInput');
    if (typeInput) typeInput.value = tName !== 'Class Teacher' ? tName : '';

    const modal = document.getElementById('teacherSignatureModal');
    if (modal) modal.style.display = 'flex';

    switchSigMode('draw');
    initSigCanvas();
    updateTypedSigPreview();
}

function closeTeacherSignatureModal() {
    const modal = document.getElementById('teacherSignatureModal');
    if (modal) modal.style.display = 'none';
}

function switchSigMode(mode) {
    currentSigMode = mode;
    ['draw', 'upload', 'type'].forEach(m => {
        const tab = document.getElementById('sigTab' + m.charAt(0).toUpperCase() + m.slice(1));
        const panel = document.getElementById('sigMode' + m.charAt(0).toUpperCase() + m.slice(1));
        if (tab) {
            if (m === mode) {
                tab.classList.add('active');
                tab.classList.remove('btn-ghost');
                tab.style.background = 'var(--primary)';
                tab.style.color = '#fff';
            } else {
                tab.classList.remove('active');
                tab.classList.add('btn-ghost');
                tab.style.background = 'none';
                tab.style.color = 'var(--muted)';
            }
        }
        if (panel) panel.style.display = (m === mode ? 'block' : 'none');
    });

    if (mode === 'draw') {
        setTimeout(initSigCanvas, 50);
    }
}

function initSigCanvas() {
    sigCanvas = document.getElementById('sigCanvas');
    if (!sigCanvas) return;
    sigCtx = sigCanvas.getContext('2d');
    
    // Clear canvas
    sigCtx.fillStyle = '#ffffff';
    sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigCtx.lineWidth = 2.4;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = sigPenColor;

    sigHasDrawn = false;
    const ph = document.getElementById('sigCanvasPlaceholder');
    if (ph) ph.style.display = 'block';

    // Remove any existing listeners to prevent duplicates
    sigCanvas.onmousedown = startSigDraw;
    sigCanvas.onmousemove = moveSigDraw;
    sigCanvas.onmouseup = endSigDraw;
    sigCanvas.onmouseleave = endSigDraw;

    sigCanvas.ontouchstart = e => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = sigCanvas.getBoundingClientRect();
        const scaleX = sigCanvas.width / rect.width;
        const scaleY = sigCanvas.height / rect.height;
        startSigDraw({ offsetX: (touch.clientX - rect.left) * scaleX, offsetY: (touch.clientY - rect.top) * scaleY });
    };
    sigCanvas.ontouchmove = e => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = sigCanvas.getBoundingClientRect();
        const scaleX = sigCanvas.width / rect.width;
        const scaleY = sigCanvas.height / rect.height;
        moveSigDraw({ offsetX: (touch.clientX - rect.left) * scaleX, offsetY: (touch.clientY - rect.top) * scaleY });
    };
    sigCanvas.ontouchend = e => {
        e.preventDefault();
        endSigDraw();
    };
}

function startSigDraw(e) {
    if (!sigCtx) return;
    isDrawingSig = true;
    sigHasDrawn = true;
    const ph = document.getElementById('sigCanvasPlaceholder');
    if (ph) ph.style.display = 'none';

    sigCtx.beginPath();
    sigCtx.moveTo(e.offsetX, e.offsetY);
}

function moveSigDraw(e) {
    if (!isDrawingSig || !sigCtx) return;
    sigCtx.lineTo(e.offsetX, e.offsetY);
    sigCtx.stroke();
}

function endSigDraw() {
    if (!isDrawingSig) return;
    isDrawingSig = false;
    if (sigHasDrawn && sigCanvas) {
        activeSigDataUrl = sigCanvas.toDataURL('image/png');
        updateSigLivePreview(activeSigDataUrl);
    }
}

function clearSigCanvas() {
    if (!sigCanvas || !sigCtx) return;
    sigCtx.fillStyle = '#ffffff';
    sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
    sigHasDrawn = false;
    const ph = document.getElementById('sigCanvasPlaceholder');
    if (ph) ph.style.display = 'block';
    activeSigDataUrl = null;
    updateSigLivePreview(null);
}

function updateSigPenColor(color) {
    sigPenColor = color;
    if (sigCtx) sigCtx.strokeStyle = color;
}

function handleSigFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        activeSigDataUrl = e.target.result;
        const previewWrap = document.getElementById('sigUploadPreviewWrap');
        const previewImg = document.getElementById('sigUploadPreview');
        if (previewImg) previewImg.src = activeSigDataUrl;
        if (previewWrap) previewWrap.style.display = 'block';
        updateSigLivePreview(activeSigDataUrl);
    };
    reader.readAsDataURL(file);
}

function updateTypedSigPreview() {
    const text = document.getElementById('sigTypeNameInput')?.value?.trim() || 'Teacher Name';
    const container = document.getElementById('sigFontOptions');
    if (!container) return;

    container.innerHTML = CURSIVE_FONTS.map((cf, idx) => `
        <div onclick="selectTypedSigFont('${cf.font.replace(/'/g, "\\'")}', this)" style="border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--card);cursor:pointer;text-align:center;transition:border-color .15s;" class="typed-font-choice ${idx === 0 ? 'selected-font' : ''}">
            <div style="font-family:${cf.font};font-size:22px;color:var(--ink);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${esc(text)}
            </div>
            <div style="font-size:10.5px;color:var(--muted);">${cf.name}</div>
        </div>
    `).join('');
}

function selectTypedSigFont(fontFamily, el) {
    document.querySelectorAll('.typed-font-choice').forEach(c => {
        c.style.borderColor = 'var(--line)';
        c.style.background = 'var(--card)';
    });
    if (el) {
        el.style.borderColor = 'var(--primary)';
        el.style.background = '#eef2ff';
    }

    const text = document.getElementById('sigTypeNameInput')?.value?.trim() || 'Teacher Name';
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 480;
    tempCanvas.height = 120;
    const ctx = tempCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    ctx.fillStyle = sigPenColor || '#0f172a';
    ctx.font = `italic 38px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, tempCanvas.width / 2, tempCanvas.height / 2);

    activeSigDataUrl = tempCanvas.toDataURL('image/png');
    updateSigLivePreview(activeSigDataUrl);
}

function updateSigLivePreview(sigDataUrl) {
    const badge = document.getElementById('sigStatusBadge');
    const previewImg = document.getElementById('sigPreviewImg');
    const emptyLine = document.getElementById('sigPreviewEmptyLine');
    const removeBtn = document.getElementById('sigRemoveBtn');

    if (sigDataUrl) {
        if (badge) {
            badge.className = 'badge ok';
            badge.innerHTML = '<i class="fas fa-check-circle"></i> Ready to apply';
        }
        if (previewImg) {
            previewImg.src = sigDataUrl;
            previewImg.style.display = 'block';
        }
        if (emptyLine) emptyLine.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else {
        if (badge) {
            badge.className = 'badge wait';
            badge.innerHTML = 'No signature on file';
        }
        if (previewImg) previewImg.style.display = 'none';
        if (emptyLine) emptyLine.style.display = 'inline';
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

async function saveTeacherSignature() {
    if (!activeSigDataUrl) {
        return toast('Please draw, upload or type your signature first.', 'bad');
    }

    loadAll();
    const teachers = loadJSON('teachers', []);
    let teacher = classTeacherRecord(currentClass) || currentTeacherRecord();

    if (!teacher && teachers.length > 0) {
        teacher = teachers[0];
    }

    if (teacher) {
        teacher.signature = activeSigDataUrl;
        const idx = teachers.findIndex(t => String(t.id) === String(teacher.id) || (teacher.email && t.email === teacher.email));
        if (idx >= 0) {
            teachers[idx] = { ...teachers[idx], signature: activeSigDataUrl };
        } else {
            teachers.push(teacher);
        }
        saveJSON('teachers', teachers);
        localStorage.setItem('teacherSignature_' + teacher.id, activeSigDataUrl);
        if (teacher.userId) localStorage.setItem('teacherSignature_' + teacher.userId, activeSigDataUrl);
    }

    localStorage.setItem('currentTeacherSignature', activeSigDataUrl);

    // Sync in background to cloud / Firestore
    if (teacher && typeof updateDocument === 'function') {
        try {
            updateDocument('teachers', teacher.id, { signature: activeSigDataUrl }).catch(() => {});
        } catch (e) {}
    }

    closeTeacherSignatureModal();
    toast('Signature saved! It will now appear on all report cards for ' + (currentClass || 'your class') + '.', 'ok');

    // Refresh UI
    renderInfo();
    renderReports();
    if (typeof currentPreviewReportStudentId !== 'undefined' && currentPreviewReportStudentId) {
        const body = document.getElementById('previewBody');
        if (body) body.innerHTML = buildUnifiedReportHTML(currentPreviewReportStudentId);
    }
}

async function removeTeacherSignature() {
    if (!confirm('Are you sure you want to remove your signature from report cards?')) return;

    loadAll();
    const teachers = loadJSON('teachers', []);
    const teacher = classTeacherRecord(currentClass) || currentTeacherRecord();

    if (teacher) {
        teacher.signature = null;
        const idx = teachers.findIndex(t => String(t.id) === String(teacher.id) || (teacher.email && t.email === teacher.email));
        if (idx >= 0) {
            teachers[idx].signature = null;
        }
        saveJSON('teachers', teachers);
        localStorage.removeItem('teacherSignature_' + teacher.id);
        if (teacher.userId) localStorage.removeItem('teacherSignature_' + teacher.userId);

        if (typeof updateDocument === 'function') {
            try { updateDocument('teachers', teacher.id, { signature: null }).catch(() => {}); } catch (e) {}
        }
    }

    localStorage.removeItem('currentTeacherSignature');
    activeSigDataUrl = null;
    clearSigCanvas();
    updateSigLivePreview(null);

    toast('Signature removed.', 'ok');
    renderInfo();
    renderReports();
    if (typeof currentPreviewReportStudentId !== 'undefined' && currentPreviewReportStudentId) {
        const body = document.getElementById('previewBody');
        if (body) body.innerHTML = buildUnifiedReportHTML(currentPreviewReportStudentId);
    }
}

async function renderTeacherTimetableTab() {
    const panel = document.getElementById('tab-timetable');
    if (!panel) return;

    panel.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Loading schedule data from school system…</p></div>';

    try {
        const [ttRes, exRes] = await Promise.all([
            fetch('/api/timetables'),
            fetch('/api/timetables/exams')
        ]);

        const timetables = ttRes.ok ? await ttRes.json() : [];
        const allExams = exRes.ok ? await exRes.json() : [];

        const allowedClasses = teacherAllowedClasses();
        const activeClass = currentClass || allowedClasses[0] || '';

        const activeDoc = timetables.find(t => (t.class || '').toLowerCase() === activeClass.toLowerCase());
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const periods = (activeDoc && activeDoc.periods && activeDoc.periods.length) ? activeDoc.periods : [
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

        const getSlot = (day, periodNum) => {
            if (!activeDoc) return null;
            if (activeDoc.schedule && Array.isArray(activeDoc.schedule[day])) {
                return activeDoc.schedule[day].find(s => Number(s.period) === Number(periodNum));
            }
            return timetables.find(x => (x.class || '').toLowerCase() === activeClass.toLowerCase() && (x.day || '').toLowerCase() === day.toLowerCase() && Number(x.period) === Number(periodNum));
        };

        let totalScheduled = 0;
        days.forEach(d => {
            periods.forEach(p => {
                if (!p.isBreak) {
                    const s = getSlot(d, p.period);
                    if (s && s.subject) totalScheduled++;
                }
            });
        });

        // 2. Exams for active class
        const classExams = allExams.filter(e => (e.class || '').toLowerCase() === activeClass.toLowerCase());
        classExams.sort((a, b) => (a.examDate || '').localeCompare(b.examDate || ''));

        let html = `
            <div class="panel-head" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
                <div>
                    <h3 style="margin:0;font-size:18px;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-calendar-alt" style="color:var(--primary);"></i> Class Timetable &amp; Examination Schedule
                    </h3>
                    <p class="muted" style="margin:4px 0 0;font-size:12.5px;">
                        Official timetables and exam notices published by School Administration for <strong>${esc(activeClass)}</strong>.
                    </p>
                </div>
                ${allowedClasses.length > 1 ? `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <label style="font-size:13px;font-weight:600;color:var(--ink);">Switch Class:</label>
                        <select onchange="switchClass(this.value)" style="padding:6px 12px;font-size:13px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600;">
                            ${allowedClasses.map(c => `<option value="${esc(c)}" ${c === activeClass ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
            </div>

            <!-- 1. CLASS TIMETABLE -->
            <div class="card" style="margin-bottom:24px;padding:20px;background:var(--card);border:1px solid var(--line);border-radius:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
                    <div>
                        <strong style="font-size:16px;color:var(--ink);"><i class="fas fa-chalkboard" style="color:var(--primary);margin-right:6px;"></i> ${esc(activeClass)} Weekly Master Timetable</strong>
                        <span class="badge ok" style="margin-left:8px;font-size:11px;">${totalScheduled} Periods Scheduled</span>
                    </div>
                    ${totalScheduled ? `
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <button class="btn btn-primary btn-sm" onclick="downloadTeacherTimetablePDF('${esc(activeClass)}')">
                                <i class="fas fa-file-pdf"></i> Download PDF
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick="printTeacherTimetable('${esc(activeClass)}')">
                                <i class="fas fa-print"></i> Print Timetable
                            </button>
                        </div>
                    ` : ''}
                </div>

                ${!totalScheduled ? `
                    <div class="empty" style="padding:32px 20px;text-align:center;color:var(--muted);background:var(--bg);border-radius:8px;border:1px dashed var(--line);">
                        <i class="fas fa-calendar-times fa-2x" style="margin-bottom:8px;opacity:0.5;"></i>
                        <h4 style="font-size:15px;color:var(--ink);margin:0 0 6px;">No Timetable Published Yet</h4>
                        <p style="margin:0;font-size:13px;max-width:460px;margin:0 auto;line-height:1.5;">The school administration has not published a weekly timetable for <strong>${esc(activeClass)}</strong> yet. Once scheduled and published by admin, it will appear here automatically for you to view and download in PDF.</p>
                    </div>
                ` : `
                    <div class="table-wrap" id="printableTeacherClassTimetable" style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:620px;text-align:center;">
                            <thead>
                                <tr style="background:var(--primary);color:#ffffff;">
                                    <th style="padding:10px 8px;width:120px;">Period / Time</th>
                                    ${days.map(d => `<th style="padding:10px 8px;">${esc(d)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${periods.map(p => {
                                    if (p.isBreak) {
                                        return `
                                            <tr style="background:rgba(245,158,11,0.08);">
                                                <td style="padding:8px;border:1px solid var(--line);font-weight:700;color:#b45309;">
                                                    <div>${esc(p.name || 'Break')}</div>
                                                    <div style="font-size:10px;font-weight:normal;">${esc(p.time || '')}</div>
                                                </td>
                                                <td colspan="5" style="padding:8px;border:1px solid var(--line);color:#b45309;font-weight:700;letter-spacing:0.04em;">
                                                    <i class="fas fa-mug-hot" style="margin-right:6px;"></i> ${esc(p.name || 'Break Interval')} (${esc(p.time || '')})
                                                </td>
                                            </tr>
                                        `;
                                    }
                                    return `
                                        <tr>
                                            <td style="padding:8px;border:1px solid var(--line);background:var(--bg);font-weight:700;">
                                                <div>Period ${p.period}</div>
                                                <div style="font-size:10.5px;color:var(--muted);font-weight:normal;">${esc(p.time || '')}</div>
                                            </td>
                                            ${days.map(d => {
                                                const s = getSlot(d, p.period);
                                                if (s && s.subject) {
                                                    return `
                                                        <td style="padding:8px;border:1px solid var(--line);background:rgba(79,70,229,0.05);vertical-align:top;">
                                                            <div style="font-weight:700;color:var(--primary);font-size:12.5px;">${esc(s.subject)}</div>
                                                            ${s.teacher ? `<div style="font-size:11px;color:var(--ink);margin-top:3px;"><i class="fas fa-user-tie" style="font-size:10px;opacity:0.7;"></i> ${esc(s.teacher)}</div>` : ''}
                                                            ${s.room ? `<div style="font-size:10px;color:#059669;margin-top:2px;font-weight:500;"><i class="fas fa-map-marker-alt"></i> ${esc(s.room)}</div>` : ''}
                                                        </td>
                                                    `;
                                                }
                                                return `<td style="padding:8px;border:1px solid var(--line);color:var(--muted);">—</td>`;
                                            }).join('')}
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>

            <!-- 2. EXAMINATION TIMETABLE -->
            <div class="card" style="padding:20px;background:var(--card);border:1px solid var(--line);border-radius:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
                    <div>
                        <strong style="font-size:16px;color:var(--ink);"><i class="fas fa-clipboard-check" style="color:#7c3aed;margin-right:6px;"></i> ${esc(activeClass)} Examination Schedule</strong>
                        <span class="badge info" style="margin-left:8px;font-size:11px;">${classExams.length} Papers</span>
                    </div>
                    ${classExams.length ? `
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            <button class="btn btn-primary btn-sm" onclick="downloadTeacherExamsPDF('${esc(activeClass)}')">
                                <i class="fas fa-file-pdf"></i> Download PDF
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick="printTeacherExams('${esc(activeClass)}')">
                                <i class="fas fa-print"></i> Print Exam Schedule
                            </button>
                        </div>
                    ` : ''}
                </div>

                ${!classExams.length ? `
                    <div class="empty" style="padding:32px 20px;text-align:center;color:var(--muted);background:var(--bg);border-radius:8px;border:1px dashed var(--line);">
                        <i class="fas fa-clipboard-list fa-2x" style="margin-bottom:8px;opacity:0.5;"></i>
                        <h4 style="font-size:15px;color:var(--ink);margin:0 0 6px;">No Examinations Scheduled Yet</h4>
                        <p style="margin:0;font-size:13px;max-width:460px;margin:0 auto;line-height:1.5;">The school administration has not scheduled examinations for <strong>${esc(activeClass)}</strong> yet. Once scheduled by admin, the dates, times, halls, and invigilators will appear here automatically for you to view and download.</p>
                    </div>
                ` : `
                    <div class="table-wrap" id="printableTeacherClassExams" style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:620px;text-align:left;">
                            <thead>
                                <tr style="background:#1e1b4b;color:#ffffff;">
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Subject</th>
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Exam Title</th>
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Date &amp; Time</th>
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Hall / Venue</th>
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Invigilator</th>
                                    <th style="padding:10px 12px;border:1px solid #312e81;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${classExams.map(ex => `
                                    <tr style="border-bottom:1px solid var(--line);">
                                        <td style="padding:10px 12px;font-weight:700;color:var(--ink);">
                                            <i class="fas fa-book" style="color:#7c3aed;margin-right:6px;"></i> ${esc(ex.subject)}
                                        </td>
                                        <td style="padding:10px 12px;color:var(--ink);">${esc(ex.title || ex.examTitle || 'Official Paper')}</td>
                                        <td style="padding:10px 12px;">
                                            <div style="font-weight:600;color:var(--ink);"><i class="fas fa-calendar-day" style="color:var(--primary);"></i> ${esc(ex.examDate)}</div>
                                            <div style="font-size:11px;color:var(--muted);">${esc(ex.startTime || '09:00')} - ${esc(ex.endTime || '11:00')}</div>
                                        </td>
                                        <td style="padding:10px 12px;">
                                            <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:var(--bg);font-weight:600;color:var(--ink);border:1px solid var(--line);">
                                                ${esc(ex.hall || 'Main Hall')}
                                            </span>
                                        </td>
                                        <td style="padding:10px 12px;color:var(--ink);font-size:12px;">
                                            ${ex.chiefInvigilator ? `<div><i class="fas fa-user-check" style="color:#059669;"></i> ${esc(ex.chiefInvigilator)}</div>` : '<span style="color:var(--muted);">Assigned by Admin</span>'}
                                            ${ex.assistantInvigilator ? `<div style="font-size:11px;color:var(--muted);">Asst: ${esc(ex.assistantInvigilator)}</div>` : ''}
                                        </td>
                                        <td style="padding:10px 12px;">
                                            <span class="badge ok" style="font-size:11px;">${esc(ex.status || 'Scheduled')}</span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        panel.innerHTML = html;

    } catch (err) {
        panel.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center;">Failed to load timetable: ${esc(err.message)}</div>`;
    }
}

async function downloadTeacherTimetablePDF(className) {
    className = className || currentClass || 'Class';
    toast('Generating Timetable PDF...', 'ok');
    const el = document.getElementById('printableTeacherClassTimetable');
    if (!el) return toast('No timetable available to download.', 'bad');

    try {
        const sName = schoolSettings.schoolName || schoolName() || 'School';
        const docMarkup = `
            <div style="font-family:'Inter',Arial,sans-serif;padding:24px;color:#0f172a;max-width:800px;margin:0 auto;">
                <div style="text-align:center;margin-bottom:16px;border-bottom:2px solid #0f172a;padding-bottom:12px;">
                    <h1 style="margin:0 0 4px;font-size:20px;font-weight:800;color:#1e1b4b;text-transform:uppercase;">${sName}</h1>
                    <h2 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#4f46e5;">Official Weekly Class Timetable</h2>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">Class: ${className} &nbsp;|&nbsp; Academic Year: ${schoolInfo.academicYear || '2025/2026'} &nbsp;|&nbsp; Term: ${schoolInfo.term || '1'}</p>
                </div>
                ${el.innerHTML}
                <div style="margin-top:20px;padding-top:12px;border-top:1px dashed #cbd5e1;display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
                    <span>Issued by Administration</span>
                    <span>Printed / Downloaded: ${new Date().toLocaleDateString()}</span>
                </div>
            </div>
        `;

        // Direct printable PDF / print fallback
        const win = window.open('', '_blank', 'width=950,height=800');
        win.document.write(`<!DOCTYPE html><html><head><title>${className} Timetable</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                body{margin:20px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
                table{width:100%;border-collapse:collapse;margin-top:10px;}
                th,td{border:1px solid #cbd5e1;padding:8px;text-align:center;}
                @media print { body { margin: 0; } }
            </style>
        </head><body>${docMarkup}<script>window.onload=function(){window.print();};<\/script></body></html>`);
        win.document.close();
        toast('Timetable PDF print dialogue opened.', 'ok');
    } catch (err) {
        toast('Failed to export PDF: ' + err.message, 'bad');
    }
}

async function downloadTeacherExamsPDF(className) {
    className = className || currentClass || 'Class';
    toast('Generating Examination Schedule PDF...', 'ok');
    const el = document.getElementById('printableTeacherClassExams');
    if (!el) return toast('No exam schedule available to download.', 'bad');

    try {
        const sName = schoolSettings.schoolName || schoolName() || 'School';
        const docMarkup = `
            <div style="font-family:'Inter',Arial,sans-serif;padding:24px;color:#0f172a;max-width:850px;margin:0 auto;">
                <div style="text-align:center;margin-bottom:16px;border-bottom:2px solid #0f172a;padding-bottom:12px;">
                    <h1 style="margin:0 0 4px;font-size:20px;font-weight:800;color:#1e1b4b;text-transform:uppercase;">${sName}</h1>
                    <h2 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#7c3aed;">Official Examination Timetable &amp; Schedule</h2>
                    <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">Class: ${className} &nbsp;|&nbsp; Academic Year: ${schoolInfo.academicYear || '2025/2026'} &nbsp;|&nbsp; Term: ${schoolInfo.term || '1'}</p>
                </div>
                ${el.innerHTML}
                <div style="margin-top:20px;padding-top:12px;border-top:1px dashed #cbd5e1;display:flex;justify-content:space-between;font-size:11px;color:#64748b;">
                    <span>Official Schedule — School Administration</span>
                    <span>Printed / Downloaded: ${new Date().toLocaleDateString()}</span>
                </div>
            </div>
        `;

        const win = window.open('', '_blank', 'width=950,height=800');
        win.document.write(`<!DOCTYPE html><html><head><title>${className} Examination Schedule</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                body{margin:20px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
                table{width:100%;border-collapse:collapse;margin-top:10px;}
                th,td{border:1px solid #cbd5e1;padding:8px;}
                @media print { body { margin: 0; } }
            </style>
        </head><body>${docMarkup}<script>window.onload=function(){window.print();};<\/script></body></html>`);
        win.document.close();
        toast('Exam Schedule PDF print dialogue opened.', 'ok');
    } catch (err) {
        toast('Failed to export Exam PDF: ' + err.message, 'bad');
    }
}

function printTeacherTimetable(className) {
    downloadTeacherTimetablePDF(className);
}

function printTeacherExams(className) {
    downloadTeacherExamsPDF(className);
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

    if (typeof initFirebase === 'function') initFirebase();

    const isUnlocked = sessionStorage.getItem('teacherUnlocked') === 'true';
    const teacherEmail = sessionStorage.getItem('teacherEmail');

    if (isUnlocked && teacherEmail) {
        if (!validateCurrentTeacherSession(true)) {
            return;
        }
        await openApp();
    } else {
        document.getElementById('app').style.display = 'none';
        document.getElementById('teacherAuthOverlay').style.display = 'flex';
    }

    // Auto-restore session from persistent Firebase Auth if available
    if (typeof auth !== 'undefined' && auth && typeof auth.onAuthStateChanged === 'function') {
        auth.onAuthStateChanged(async (user) => {
            if (user && user.email) {
                const currentSessionEmail = sessionStorage.getItem('teacherEmail');
                if (!currentSessionEmail || currentSessionEmail.toLowerCase() === user.email.toLowerCase()) {
                    sessionStorage.setItem('teacherUnlocked', 'true');
                    sessionStorage.setItem('teacherEmail', user.email);
                    if (typeof loadUserProfile === 'function') {
                        try {
                            const p = await loadUserProfile(user.uid);
                            if (p?.displayName) sessionStorage.setItem('teacherName', p.displayName);
                        } catch (e) {
                            if (e.message && (e.message.includes('deactivated') || e.message.includes('deleted'))) {
                                validateCurrentTeacherSession();
                                return;
                            }
                        }
                    }
                    if (!validateCurrentTeacherSession(true)) return;
                    if (document.getElementById('app').style.display !== 'block') {
                        await openApp();
                    }
                }
            }
        });
    }

    // Cross-portal real-time sync: reload data when any portal triggers an update
    window.addEventListener('onereal_data_updated', () => {
        handleTeacherSyncUpdate();
    });
    window.addEventListener('onerealDataSynced', () => {
        handleTeacherSyncUpdate();
    });
    window.addEventListener('storage', (e) => {
        if (!e.key || e.key === 'results' || e.key === 'students' || e.key === 'scores' || e.key === 'reports') {
            handleTeacherSyncUpdate();
        }
    });
});


function handleTeacherSyncUpdate() {
    loadAll();
    if (!validateCurrentTeacherSession()) return;
    if (typeof currentTab !== 'undefined') {
        const isTyping = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.closest('#tab-scores');
        if (currentTab === 'reports') renderReports();
        else if (currentTab === 'scores') {
            if (!isTyping) {
                renderScores();
                renderStats();
            }
        }
        else if (currentTab === 'broadsheet') renderBroadsheet();
        else if (currentTab === 'students') renderStudents();
        else if (currentTab === 'attendance' && typeof renderAttendance === 'function') renderAttendance();
        else if (currentTab === 'analytics' && typeof renderAnalytics === 'function') renderAnalytics();
    }
    fillHeaderClasses();
    updateSidebarState();
}

window.addEventListener('storage', (e) => {
    handleTeacherSyncUpdate();
});

window.addEventListener('onerealDataSynced', (e) => {
    handleTeacherSyncUpdate();
});

