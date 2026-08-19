'use strict';

const SUBJECTS = [
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
function gradeScale() {
    if (typeof getActiveGradingScale === 'function') {
        const s = getActiveGradingScale();
        if (s && s.length) return s;
    }
    return loadJSON('activeGradingScale', DEFAULT_GRADES);
}
function getGrade(total) {
    if (typeof getGradeForScore === 'function') return getGradeForScore(total);
    const scale = gradeScale();
    const t = Math.max(0, Math.min(100, Number(total) || 0));
    return scale.find(g => t >= g.min && t <= g.max) || scale[scale.length - 1];
}

function approvalKey(id) {
    return String(id) + '|' + (schoolInfo.academicYear || '') + '|' + (schoolInfo.term || '');
}
function reportRecord(id) {
    const key = approvalKey(id);
    return reports.find(r => r.approvalKey === key || (String(r.studentId) === String(id) && String(r.termId) === String(schoolInfo.term || '') && String(r.academicYearId) === String(schoolInfo.academicYear || '')));
}
function isApproved(id) {
    const rec = reportRecord(id);
    const st = String(rec?.status || '').toLowerCase();
    return st === 'approved' || st === 'published';
}
function upsertPending(list) {
    list.forEach(stu => {
        const key = approvalKey(stu.id);
        const existing = reports.find(r => r.approvalKey === key);
        if (existing) {
            if (!['approved', 'published'].includes(String(existing.status).toLowerCase())) {
                existing.status = 'Pending';
                existing.generatedAt = new Date().toISOString();
                existing.studentName = stu.name;
                existing.classId = stu.class;
            }
        } else {
            reports.push({
                id: 'rpt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                approvalKey: key,
                studentId: stu.id,
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
    persistReports();
}

function togglePw(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.innerHTML = input.type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
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
    const demoTeacher = /^(teacher@school\.com|ama@school\.com)$/i.test(email);
    const localPassOk = password === 'teacher123' || password === 'admin123';
    if (typeof isFirebaseActive !== 'undefined' && isFirebaseActive && typeof loginFirebaseUser === 'function' && !localPassOk) {
        try {
            const creds = await loginFirebaseUser(email, password);
            sessionStorage.setItem('teacherUnlocked', 'true');
            sessionStorage.setItem('teacherEmail', email);
            sessionStorage.setItem('teacherName', getCurrentUserProfile()?.displayName || creds.user.email);
            await openApp();
            return;
        } catch (e) {
            /* fall through to local login */
        }
    }
    const teachers = loadJSON('teachers', []);
    const users = loadJSON('users', []);
    const t = teachers.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
    const u = users.find(x => (x.email || '').toLowerCase() === email.toLowerCase());
    if (!t && !u && !demoTeacher) {
        err.textContent = 'No teacher account for this email. Ask admin to add you, or use teacher@school.com / teacher123.';
        err.style.display = 'block';
        return;
    }
    if (t?.status === 'inactive' || u?.status === 'inactive') {
        err.textContent = 'This account is deactivated.';
        err.style.display = 'block';
        return;
    }
    const stored = u?.password || t?.password || null;
    if (!((stored && password === stored) || password === 'teacher123' || password === 'admin123')) {
        err.textContent = 'Incorrect password.';
        err.style.display = 'block';
        return;
    }
    sessionStorage.setItem('teacherUnlocked', 'true');
    sessionStorage.setItem('teacherEmail', email);
    sessionStorage.setItem('teacherName', u?.displayName || t?.name || email.split('@')[0]);
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
    if (typeof pullSchoolFromFirebase === 'function') {
        try { await pullSchoolFromFirebase(); loadAll(); } catch (e) {}
    }
    if (typeof startSchoolRealtime === 'function') {
        startSchoolRealtime(function () {
            loadAll();
            if (currentClass) openTab(currentTab);
            else renderHub();
        });
    }
    if (typeof Attendance !== 'undefined' && Attendance.hydrateFromServer) Attendance.hydrateFromServer().catch(() => {});
    document.getElementById('teacherAuthOverlay').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('teacherChip').textContent = sessionStorage.getItem('teacherName') || 'Teacher';
    document.getElementById('schoolNameLabel').textContent = schoolName();
    document.getElementById('termLabel').textContent = (schoolInfo.academicYear || '') + ' · ' + termHeading();
    fillHeaderClasses();
    const saved = sessionStorage.getItem('teacherClass');
    if (saved && classList().includes(saved)) enterClass(saved);
    else showHub();
}

function fillHeaderClasses() {
    const sel = document.getElementById('headerClassSelect');
    sel.innerHTML = classList().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (currentClass) sel.value = currentClass;
}

function showHub() {
    currentClass = '';
    sessionStorage.removeItem('teacherClass');
    document.getElementById('view-hub').classList.add('active');
    document.getElementById('view-class').classList.remove('active');
    document.getElementById('classSwitcherWrap').style.display = 'none';
    renderHub();
}

function renderHub() {
    const grid = document.getElementById('classHubGrid');
    grid.innerHTML = classList().map(name => {
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

function enterClass(name) {
    currentClass = name;
    sessionStorage.setItem('teacherClass', name);
    document.getElementById('view-hub').classList.remove('active');
    document.getElementById('view-class').classList.add('active');
    document.getElementById('classSwitcherWrap').style.display = 'flex';
    fillHeaderClasses();
    openTab(currentTab || 'students');
}

function openTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-pill').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
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
    const scored = list.filter(s => SUBJECTS.some(sub => {
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
            <input class="field" style="margin-bottom:10px;width:100%;padding:9px 10px;border:1.5px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);" id="studentFilter" placeholder="Search students…" oninput="renderStudents()">
            <div class="list">
                ${list.filter(s => {
                    const q = (document.getElementById('studentFilter')?.value || '').toLowerCase();
                    return !q || s.name.toLowerCase().includes(q);
                }).map(s => `
                    <div class="list-item">
                        <div><strong>${esc(s.name)}</strong><div class="muted">${esc(s.admissionNo || '')} · ${esc(s.class)}</div></div>
                        <div class="actions">
                            <button class="btn btn-ghost btn-sm" onclick="editStudent(${s.id})">Edit</button>
                            <button class="btn btn-ghost btn-sm danger" onclick="deleteStudent(${s.id})">Delete</button>
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
            <select id="editClass">${classList().map(c => `<option ${c === s.class ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
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
    SUBJECTS.forEach(sub => {
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

function renderScores() {
    document.getElementById('tab-scores').innerHTML = `
        <div class="card">
            <p class="hint"><strong>How to enter marks:</strong> Type class and exam scores <em>out of 100</em>. Each is converted to 50% and added for a total out of 100. Example: class 80 → 40, exam 90 → 45, total 85. Autosaves.</p>
            <div class="subject-grid">
                ${SUBJECTS.map(sub => `<button class="subject-chip ${currentSubject === sub ? 'active' : ''}" onclick="openSubject('${sub.replace(/'/g, "\\'")}')">
                    <strong>${esc(sub)}</strong>
                    <small>${scoredCount(sub)} / ${classStudents().length} entered</small>
                </button>`).join('')}
            </div>
            <div style="margin-top:14px;">
                <input type="file" id="marksFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="importMarks(event)">
                <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('marksFile').click()"><i class="fas fa-file-excel"></i> Import spreadsheet</button>
                <a class="btn btn-ghost btn-sm" id="downloadTemplateBtn" href="/open?src=/api/templates/marks.xlsx"><i class="fas fa-file-excel"></i> Excel template</a>
            </div>
            <div id="scoreSheet" style="margin-top:16px;"></div>
        </div>`;
    const tpl = document.getElementById('downloadTemplateBtn');
    if (tpl) {
        const cls = currentClass || '';
        const subject = currentSubject || 'Mathematics';
        const name = (cls || 'class').replace(/\s/g, '_') + '_' + subject.replace(/\s/g, '_') + '_marks_template.csv';
        tpl.href = '/open?src=' + encodeURIComponent('/api/templates/marks.xlsx?class=' + encodeURIComponent(cls) + '&subject=' + encodeURIComponent(subject));
        tpl.setAttribute('download', name.replace(/\.csv$/i, '.xlsx'));
    }
    if (currentSubject) drawScoreSheet();
}

function openSubject(sub) {
    currentSubject = sub;
    renderScores();
}

function drawScoreSheet() {
    const wrap = document.getElementById('scoreSheet');
    if (!wrap) return;
    const list = classStudents();
    wrap.innerHTML = `
        <h3 style="margin:8px 0 10px;">${esc(currentSubject)}</h3>
        <div class="table-wrap"><table class="score-table">
            <thead><tr>
                <th>Student</th>
                <th>Class /100</th>
                <th>Class 50%</th>
                <th>Exam /100</th>
                <th>Exam 50%</th>
                <th>Total /100</th>
                <th>Grade</th>
            </tr></thead>
            <tbody>
                ${list.map(s => {
                    const e = getScoreEntry(currentSubject, s.id);
                    const cs50 = fifty(e.classScore);
                    const es50 = fifty(e.examScore);
                    const ready = e.classScore !== '' && e.examScore !== '';
                    const tot = ready ? totalScore(e.classScore, e.examScore) : '';
                    const g = ready ? getGrade(tot) : null;
                    return `<tr data-sid="${esc(scoreKey(s.id))}">
                        <td>${esc(s.name)}</td>
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

function refreshScoreRow(studentId) {
    const tr = document.querySelector(`tr[data-sid="${scoreKey(studentId)}"]`);
    const row = getScoreEntry(currentSubject, studentId);
    if (!tr) return;
    const cs50 = fifty(row.classScore);
    const es50 = fifty(row.examScore);
    const ready = row.classScore !== '' && row.examScore !== '';
    const tot = ready ? totalScore(row.classScore, row.examScore) : '';
    const g = ready ? getGrade(tot) : null;
    const csCell = tr.querySelector('.cs50');
    const esCell = tr.querySelector('.es50');
    const totCell = tr.querySelector('.tot');
    const grdCell = tr.querySelector('.grd');
    if (csCell) csCell.textContent = cs50 === '' ? '—' : cs50;
    if (esCell) esCell.textContent = es50 === '' ? '—' : es50;
    if (totCell) totCell.innerHTML = `<strong>${tot === '' ? '—' : tot}</strong>`;
    if (grdCell) grdCell.innerHTML = g ? `<span class="badge grade-${g.grade}">${g.grade}</span>` : '—';
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
    const row = Object.assign({ classScore: '', examScore: '', totalScore: '' }, getScoreEntry(currentSubject, studentId));
    const num = clampPartMark(value, typeof inputEl === 'object' ? inputEl : null);
    row[field] = num;
    if (row.classScore !== '' && row.examScore !== '') {
        row.classScore50 = fifty(row.classScore);
        row.examScore50 = fifty(row.examScore);
        row.totalScore = totalScore(row.classScore, row.examScore);
        const g = getGrade(row.totalScore);
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
        renderStats();
    }, 280);
}

function marksTemplateRows() {
    const list = classStudents();
    const subject = currentSubject || 'Mathematics';
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
    if (window.OneRealFiles && OneRealFiles.download) {
        return OneRealFiles.download(filename, content, mime);
    }
    toast('Open Save Excel from the sheet that appears.', 'ok');
}

function downloadMarksTemplate() {
    const cls = currentClass || '';
    const subject = currentSubject || 'Mathematics';
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
    SUBJECTS.forEach(sub => {
        const e = getScoreEntry(sub, id);
        if (e && e.classScore !== '' && e.examScore !== '') {
            const tot = totalScore(e.classScore, e.examScore);
            const g = getGrade(tot);
            items.push({ subject: sub, total: tot, grade: g.grade, remark: g.remark, cs: fifty(e.classScore), es: fifty(e.examScore) });
        }
    });
    if (!items.length) return null;
    const avg = items.reduce((a, b) => a + b.total, 0) / items.length;
    const og = getGrade(avg);
    return { items, avg, grade: og.grade, remark: og.remark };
}

function renderBroadsheet() {
    const list = classStudents().map(s => {
        const p = studentPerf(s.id);
        const map = {};
        SUBJECTS.forEach(sub => {
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
                <thead><tr><th>Pos</th><th>Student</th>${SUBJECTS.map(s => `<th>${esc(s.split(' ')[0])}</th>`).join('')}<th>Total</th><th>Avg</th></tr></thead>
                <tbody>
                    ${list.map(r => `<tr>
                        <td><span class="badge ${r.rank < 4 ? 'rank' + r.rank : ''}">${r.rank}</span></td>
                        <td class="name">${esc(r.s.name)}</td>
                        ${SUBJECTS.map(sub => `<td>${r.map[sub] == null ? '—' : r.map[sub]}</td>`).join('')}
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
    const list = classStudents();
    const approved = list.filter(s => isApproved(s.id)).length;
    document.getElementById('tab-reports').innerHTML = `
        <div class="card">
            <p class="hint">Preview anytime. Download and WhatsApp stay locked until an admin approves the report.</p>
            <div class="actions">
                <button class="btn btn-primary" onclick="generateClassReports()"><i class="fas fa-magic"></i> Refresh class reports</button>
                <button class="btn btn-ok" ${approved ? '' : 'disabled'} onclick="bulkDownload()"><i class="fas fa-file-archive"></i> Download approved ZIP</button>
            </div>
            <div class="report-grid" style="margin-top:14px;">
                ${list.map(s => {
                    const p = studentPerf(s.id);
                    const ok = isApproved(s.id);
                    return `<div class="report-card">
                        <h4>${esc(s.name)}</h4>
                        <div class="muted">${p ? p.avg.toFixed(1) + '% · ' + p.grade : 'No complete scores'}</div>
                        <div style="margin-top:8px;"><span class="badge ${ok ? 'ok' : 'wait'}">${ok ? 'Approved' : 'Awaiting admin'}</span></div>
                        <div class="actions">
                            <button class="btn btn-ghost btn-sm" onclick="openRemarks(${s.id})">Remarks</button>
                            <button class="btn btn-ghost btn-sm" onclick="previewReport(${s.id})">Preview</button>
                            <button class="btn btn-ok btn-sm" ${ok ? '' : 'disabled'} onclick="downloadReport(${s.id})">${ok ? 'Download' : 'Locked'}</button>
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

function openRemarks(id) {
    const s = students.find(x => x.id === id);
    const d = studentReportDetails[id] || {};
    const attText = (typeof Attendance !== 'undefined' && Attendance.label(id)) || d.attendance || '—';
    openModal(`<h3>Remarks — ${esc(s.name)}</h3>
        <div class="field"><label>Attendance</label><div class="readonly-box">${esc(attText)}</div>
            <p class="hint">Taken from the Attendance register. Only admin can change the “OUT OF” school days.</p></div>
        <div class="row">
            <div class="field"><label>Promotion</label>
                <select id="rmPromo"><option value="">—</option><option ${d.promotionStatus === 'Promoted' ? 'selected' : ''}>Promoted</option><option ${d.promotionStatus === 'Repeated' ? 'selected' : ''}>Repeated</option></select>
            </div>
            <div class="field"><label>To / in</label><input id="rmTarget" value="${esc(d.promotionTarget || '')}" placeholder="Basic 7"></div>
        </div>
        <div class="field"><label>Conduct</label><input id="rmConduct" value="${esc(d.conduct || '')}"></div>
        <div class="field"><label>Interest</label><input id="rmInterest" value="${esc(d.interest || '')}"></div>
        <div class="field"><label>Teacher remarks</label><textarea id="rmTeach" rows="3">${esc(d.teacherRemarks || '')}</textarea></div>
        <div class="actions">
            <button class="btn btn-ghost btn-sm" onclick="smartRemarks(${id})">Smart remarks</button>
            <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveRemarks(${id})">Save</button>
        </div>`);
}

function smartRemarks(id) {
    const p = studentPerf(id);
    const avg = p ? p.avg : 0;
    const best = p && p.items.slice().sort((a, b) => b.total - a.total)[0];
    const weak = p && p.items.slice().sort((a, b) => a.total - b.total)[0];
    let teacher = 'Good performance with steady progress';
    if (avg >= 80) teacher = 'An outstanding student who excels across subjects' + (best ? ', especially ' + best.subject : '') + '.';
    else if (avg >= 68) teacher = 'Very good performance' + (best ? ' with strength in ' + best.subject : '') + '.';
    else if (avg >= 54) teacher = 'Satisfactory work. Extra focus needed' + (weak ? ' in ' + weak.subject : '') + '.';
    else teacher = 'Requires additional support to build core concepts.';
    document.getElementById('rmTeach').value = teacher;
    document.getElementById('rmConduct').value = avg >= 70 ? 'Very well behaved and courteous' : 'Generally well-behaved';
    document.getElementById('rmInterest').value = best ? best.subject : 'Shows interest in class activities';
}

function saveRemarks(id) {
    studentReportDetails[id] = {
        attendance: (typeof Attendance !== 'undefined' && Attendance.label(id)) || (studentReportDetails[id] || {}).attendance || '',
        promotionStatus: document.getElementById('rmPromo').value,
        promotionTarget: document.getElementById('rmTarget').value.trim(),
        conduct: document.getElementById('rmConduct').value.trim(),
        interest: document.getElementById('rmInterest').value.trim(),
        teacherRemarks: document.getElementById('rmTeach').value.trim()
    };
    persistDetails();
    closeModal();
    toast('Remarks saved.', 'ok');
}

function reportHTML(id) {
    const s = students.find(x => x.id === id);
    if (!s) return '';
    const p = studentPerf(id);
    const d = studentReportDetails[id] || {};
    const logo = schoolLogoSrc();
    const logoBox = logo ? `<img src="${logo}" alt="" style="width:100%;height:100%;object-fit:contain;">` : '';
    let rows = SUBJECTS.map(sub => {
        const e = getScoreEntry(sub, id);
        if (e && e.classScore !== '' && e.examScore !== '') {
            const tot = totalScore(e.classScore, e.examScore);
            const g = getGrade(tot);
            return `<tr><td>${esc(sub)}</td><td>${fifty(e.classScore)}</td><td>${fifty(e.examScore)}</td><td>${tot}</td><td class="grade-${g.grade}">${g.grade}</td><td>${g.remark}</td></tr>`;
        }
        return `<tr><td>${esc(sub)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>No scores</td></tr>`;
    }).join('');
    return `<div class="report-preview">
        <div class="school-header">
            <div class="school-header-with-logos">
                <div class="school-logo">${logoBox}</div>
                <div>
                    <h1>${esc(schoolName())}</h1>
                    <p>${esc(schoolSettings.address || 'P.O.BOX 16493 K.I.A ACCRA')}</p>
                    <p><strong>Motto:</strong> ${esc(schoolSettings.motto || 'Drink deep or taste not the spring of knowledge')}</p>
                    <h2>END OF ${esc(termHeading().toUpperCase())} REPORT SHEET</h2>
                </div>
                <div class="school-logo">${logoBox}</div>
            </div>
        </div>
        <div class="student-info-grid">
            <div><span class="info-label">CLASS</span><div>${esc(s.class)} · Term ${esc(schoolInfo.term || '')}</div></div>
            <div><span class="info-label">NAME OF LEARNER</span><div>${esc(s.name)}</div></div>
            <div><span class="info-label">ACADEMIC YEAR</span><div>${esc(schoolInfo.academicYear || '')}</div></div>
            <div><span class="info-label">NUMBER ON ROLL</span><div>${classStudents().length}</div></div>
            <div><span class="info-label">DATE OF VACATION</span><div>${esc(schoolInfo.closingDate || '')}</div></div>
            <div><span class="info-label">RE-OPENING DATE</span><div>${esc(schoolInfo.reopeningDate || '')}</div></div>
        </div>
        <table><thead><tr><th>SUBJECT</th><th>CLASS 50%</th><th>EXAM 50%</th><th>TOTAL</th><th>GRADE</th><th>REMARKS</th></tr></thead><tbody>${rows}</tbody></table>
        ${p ? `<div class="student-info-grid"><div><span class="info-label">AVERAGE</span><div>${p.avg.toFixed(1)}%</div></div><div><span class="info-label">OVERALL</span><div>${p.grade} · ${p.remark}</div></div><div><span class="info-label">SUBJECTS</span><div>${p.items.length}/${SUBJECTS.length}</div></div></div>` : ''}
        <div class="attendance-section">
            <div><span class="info-label">ATTENDANCE</span><div>${esc(attendanceLabel(id, d))}</div></div>
            <div><span class="info-label">PROMOTED TO</span><div>${d.promotionStatus === 'Promoted' ? esc(d.promotionTarget || '') : '—'}</div></div>
            <div><span class="info-label">REPEATED IN</span><div>${d.promotionStatus === 'Repeated' ? esc(d.promotionTarget || '') : '—'}</div></div>
        </div>
        <p><strong>Conduct:</strong> ${esc(d.conduct || '—')}</p>
        <p><strong>Interest:</strong> ${esc(d.interest || '—')}</p>
        <p><strong>Class teacher's remarks:</strong> ${esc(d.teacherRemarks || '—')}</p>
        <p style="margin-top:12px;"><strong>Class teacher:</strong> ${esc(classTeacherName(s.class) || '—')} &nbsp; <strong>Headteacher:</strong> ${esc(headTeacherName() || '—')}</p>
        <div class="footer-message">Have a wonderful holiday!</div>
    </div>`;
}

function previewReport(id) {
    document.getElementById('previewBody').innerHTML = reportHTML(id);
    document.getElementById('previewModal').style.display = 'flex';
}
function closePreview() { document.getElementById('previewModal').style.display = 'none'; }

function generatePdfBlob(id) {
    return new Promise((resolve, reject) => {
        try {
            const s = students.find(x => x.id === id);
            if (!s) return reject(new Error('missing'));
            const p = studentPerf(id);
            const d = studentReportDetails[id] || {};
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'pt', 'a4');
            const W = doc.internal.pageSize.getWidth();
            const margin = 40;
            let y = 48;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(79, 70, 229);
            doc.text(schoolName().toUpperCase(), W / 2, y, { align: 'center' }); y += 16;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
            doc.text(schoolSettings.address || 'P.O.BOX 16493 K.I.A ACCRA', W / 2, y, { align: 'center' }); y += 14;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
            doc.text('END OF ' + termHeading().toUpperCase() + ' REPORT SHEET', W / 2, y, { align: 'center' }); y += 22;
            doc.setFontSize(10); doc.setFont('helvetica', 'normal');
            doc.text('Name: ' + s.name, margin, y);
            doc.text('Class: ' + s.class + '   Term ' + (schoolInfo.term || ''), W / 2, y); y += 14;
            doc.text('Year: ' + (schoolInfo.academicYear || ''), margin, y);
            doc.text('On roll: ' + classStudents().length, W / 2, y); y += 18;
            const cols = [130, 70, 70, 55, 50, 140];
            const heads = ['SUBJECT', 'CLASS 50%', 'EXAM 50%', 'TOTAL', 'GRADE', 'REMARK'];
            doc.setFillColor(79, 70, 229); doc.rect(margin, y, cols.reduce((a, b) => a + b, 0), 18, 'F');
            doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
            let x = margin;
            heads.forEach((h, i) => { doc.text(h, x + 4, y + 12); x += cols[i]; });
            y += 18; doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20);
            SUBJECTS.forEach((sub, ri) => {
                const e = getScoreEntry(sub, id);
                let vals = [sub, '—', '—', '—', '—', 'No scores'];
                if (e && e.classScore !== '' && e.examScore !== '') {
                    const tot = totalScore(e.classScore, e.examScore);
                    const g = getGrade(tot);
                    vals = [sub, String(fifty(e.classScore)), String(fifty(e.examScore)), String(tot), g.grade, g.remark];
                }
                if (ri % 2) { doc.setFillColor(248, 250, 252); doc.rect(margin, y, cols.reduce((a, b) => a + b, 0), 16, 'F'); }
                x = margin;
                vals.forEach((v, i) => { doc.text(String(v).slice(0, 22), x + 4, y + 12); x += cols[i]; });
                y += 16;
            });
            y += 14;
            if (p) {
                doc.setFont('helvetica', 'bold');
                doc.text('Average: ' + p.avg.toFixed(1) + '%     Overall: ' + p.grade + ' ' + p.remark, margin, y);
                y += 16;
            }
            doc.setFont('helvetica', 'normal');
            doc.text('Attendance: ' + ((typeof Attendance !== 'undefined' && Attendance.label(id)) || d.attendance || '—'), margin, y); y += 14;
            if (d.promotionStatus) { doc.text(d.promotionStatus + ' to/in: ' + (d.promotionTarget || ''), margin, y); y += 14; }
            doc.text('Conduct: ' + (d.conduct || '—'), margin, y); y += 14;
            doc.text('Interest: ' + (d.interest || '—'), margin, y); y += 14;
            const remarks = doc.splitTextToSize('Teacher: ' + (d.teacherRemarks || '—'), W - margin * 2);
            doc.text(remarks, margin, y); y += remarks.length * 12 + 16;
            doc.text('Class teacher: ' + (classTeacherName(s.class) || '_______________'), margin, y);
            doc.text('Headteacher: ' + (headTeacherName() || '_______________'), W / 2, y);
            resolve(doc.output('blob'));
        } catch (err) { reject(err); }
    });
}

async function downloadReport(id) {
    if (!isApproved(id)) return toast('Admin must approve this report first.', 'bad');
    if (window.OneRealFiles) OneRealFiles.arm();
    const s = students.find(x => x.id === id);
    try {
        const blob = await generatePdfBlob(id);
        const name = (s.name.replace(/[^a-z0-9]/gi, '_') || 'report') + '_report.pdf';
        await downloadBlobFile(blob, name, 'application/pdf');
        toast('PDF is ready. Use Save file or the phone share sheet.', 'ok');
    } catch (e) { toast('Could not build PDF.', 'bad'); }
}

async function bulkDownload() {
    const list = classStudents().filter(s => isApproved(s.id));
    if (!list.length) return toast('No approved reports yet.', 'bad');
    if (window.OneRealFiles) OneRealFiles.arm();
    if (typeof JSZip === 'undefined') return toast('ZIP library missing.', 'bad');
    const zip = new JSZip();
    for (const s of list) {
        try { zip.file(s.name.replace(/[^a-z0-9]/gi, '_') + '.pdf', await generatePdfBlob(s.id)); } catch (e) {}
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const name = (currentClass || 'class').replace(/\s/g, '_') + '_approved_reports.zip';
    await downloadBlobFile(blob, name, 'application/zip');
    toast('ZIP saved to your Downloads folder.', 'ok');
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
                            <button class="btn btn-ghost btn-sm" onclick="editParent(${s.id})">Parent</button>
                            <button class="btn btn-wa btn-sm" ${ok && p.phone ? '' : 'disabled'} onclick="sendWa(${s.id})">Send</button>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
}

function editParent(id) {
    const s = students.find(x => x.id === id);
    const p = parentContacts[id] || {};
    openModal(`<h3>Parent — ${esc(s.name)}</h3>
        <div class="field"><label>Name</label><input id="pName" value="${esc(p.name || '')}"></div>
        <div class="field"><label>WhatsApp</label><input id="pPhone" value="${esc(p.phone || '+233')}"></div>
        <div class="actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveParent(${id})">Save</button></div>`);
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
    const s = students.find(x => x.id === id);
    const p = parentContacts[id];
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

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('teacherDark') === '1') document.body.classList.add('dark');
    loadAll();
    if (sessionStorage.getItem('teacherUnlocked') === 'true') openApp();
});

;

