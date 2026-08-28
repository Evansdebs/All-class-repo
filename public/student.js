// ════════════════════════════════════════════════════════════════════
// Student Portal Engine — OneReal School Management System
// Real-time, read-only performance viewer for students & parents
// ════════════════════════════════════════════════════════════════════

function safeLocalGet(key, fallback) {
    try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : fallback;
    } catch (e) {
        return fallback;
    }
}

function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon  = iconId ? document.getElementById(iconId) : null;
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
    } else {
        input.type = 'password';
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    }
}

let activeStudentData = null;
let realtimeUnsubscribers = [];

function getSystemSchoolName() {
    const settings = safeLocalGet('schoolSettings', {});
    const schoolInfo = safeLocalGet('schoolInfo', {});
    return settings.schoolName || schoolInfo.schoolName || 'OneReal School';
}

function syncStudentPortalBranding(customSettings) {
    const settings = customSettings || safeLocalGet('schoolSettings', {});
    const schoolInfo = safeLocalGet('schoolInfo', {});
    const schoolName = settings.schoolName || schoolInfo.schoolName || 'OneReal School';
    const schoolLogo = settings.schoolLogo || schoolInfo.schoolLogo || null;

    if (typeof applySystemTheme === 'function') {
        applySystemTheme(settings);
    }

    const schoolNameEl = document.getElementById('studentSchoolName');
    if (schoolNameEl) schoolNameEl.textContent = schoolName;

    const authSchoolNameEl = document.getElementById('studentAuthSchoolName');
    if (authSchoolNameEl) authSchoolNameEl.textContent = schoolName;

    const logoContainer = document.getElementById('studentSchoolLogo');
    if (logoContainer) {
        if (schoolLogo) {
            logoContainer.innerHTML = `<img src="${schoolLogo}" alt="${schoolName}" style="width:38px;height:38px;border-radius:8px;object-fit:cover;">`;
        } else {
            logoContainer.innerHTML = `<img src="/icon-or.svg" alt="OR Logo" style="width:38px;height:38px;border-radius:8px;object-fit:cover;">`;
        }
    }

    document.title = `${schoolName} — Student Portal`;
}

function logoutStudent() {
    activeStudentData = null;
    sessionStorage.removeItem('studentAuthId');
    sessionStorage.removeItem('studentTab');
    const overlayEl = document.getElementById('studentAuthOverlay');
    if (overlayEl) overlayEl.style.display = 'flex';
    const mainEl = document.getElementById('studentMainContent');
    if (mainEl) mainEl.style.display = 'none';
}

function handleStudentSyncUpdate() {
    syncStudentPortalBranding();
    if (activeStudentData) {
        const students = safeLocalGet('students', []);
        const current = students.find(s => String(s.id) === String(activeStudentData.id) || (s.admissionNo && activeStudentData.admissionNo && s.admissionNo.toLowerCase() === activeStudentData.admissionNo.toLowerCase()));
        if (!current || current.isDeleted || current.status === 'deleted' || current.status === 'inactive') {
            logoutStudent();
            const err = document.getElementById('studentAuthError');
            if (err) {
                err.textContent = 'This student record has been deactivated or removed by administration.';
                err.style.display = 'block';
            }
            return;
        }
        activeStudentData = current;
        renderStudentResults(activeStudentData);
        if (typeof activeStudentTab !== 'undefined') {
            if (activeStudentTab === 'timetable') renderStudentTimetable(activeStudentData);
            else if (activeStudentTab === 'exams') renderStudentExams(activeStudentData);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    syncStudentPortalBranding();
    if (typeof fetchSchoolSettings === 'function') {
        try {
            const s = await fetchSchoolSettings();
            syncStudentPortalBranding(s);
        } catch (e) {}
    }
    const savedId = sessionStorage.getItem('studentAuthId');
    if (savedId) {
        loadStudentDashboard(savedId).catch(() => {
            sessionStorage.removeItem('studentAuthId');
        });
    }

    if (typeof registerSyncSubscriber === 'function') {
        registerSyncSubscriber((col, data) => {
            handleStudentSyncUpdate();
        });
    }
});

window.addEventListener('storage', (e) => {
    if (!e.key || e.key === 'schoolSettings' || e.key === 'schoolInfo' || (typeof ALL_SYNC_COLLECTIONS !== 'undefined' && ALL_SYNC_COLLECTIONS.includes(e.key))) {
        try {
            handleStudentSyncUpdate();
        } catch (err) {}
    }
});

window.addEventListener('onerealDataSynced', () => {
    handleStudentSyncUpdate();
});

window.addEventListener('schoolSettingsUpdated', (e) => {
    syncStudentPortalBranding(e.detail);
    if (activeStudentData) renderStudentResults(activeStudentData);
});

async function handleStudentLogin() {
    const studentIdInput = document.getElementById('studentLoginId')?.value?.trim() || '';
    const errorEl = document.getElementById('studentAuthError');
    const btn     = document.getElementById('studentLoginBtn');

    if (errorEl) errorEl.style.display = 'none';

    if (!studentIdInput) {
        if (errorEl) { errorEl.textContent = 'Please enter your Admission Number or Student ID.'; errorEl.style.display = 'block'; }
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating…'; }

    try {
        await loadStudentDashboard(studentIdInput);
        sessionStorage.setItem('studentAuthId', studentIdInput);
    } catch (e) {
        if (errorEl) { errorEl.textContent = e.message || 'No record found for this Admission Number.'; errorEl.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Access Report'; }
    }
}

async function loadStudentDashboard(admissionNo) {
    let student = null;
    let studentsList = [];

    // Initialize Firebase if present
    if (typeof initFirebase === 'function') initFirebase();
    if (typeof pullSchoolFromFirebase === 'function') {
        try { await pullSchoolFromFirebase(); } catch (e) {}
    }

    // 1. Search in local / cloud students
    const localStudents = safeLocalGet('students', []);
    studentsList = localStudents;

    if (typeof isFirebaseActive !== 'undefined' && isFirebaseActive && typeof db !== 'undefined' && db) {
        try {
            const snap = await db.collection('students').where('admissionNo', '==', admissionNo).get();
            if (!snap.empty) {
                student = { id: snap.docs[0].id, ...snap.docs[0].data() };
            }
        } catch (e) {}
    }

    if (!student) {
        student = studentsList.find(s =>
            (s.admissionNo && s.admissionNo.toLowerCase() === admissionNo.toLowerCase()) ||
            (s.id && s.id.toString() === admissionNo)
        );
    }

    if (!student || student.isDeleted || student.status === 'deleted' || student.status === 'inactive') {
        throw new Error(`Student record with Admission Number "${admissionNo}" is not active or has been removed.`);
    }

    activeStudentData = student;

    // Hide Overlay & Display Main Content
    const overlayEl = document.getElementById('studentAuthOverlay');
    if (overlayEl) overlayEl.style.display = 'none';
    const mainEl = document.getElementById('studentMainContent');
    if (mainEl) mainEl.style.display = 'block';

    // Populate Student Meta Info (if present in DOM)
    const stNameEl = document.getElementById('st-name');
    if (stNameEl) stNameEl.textContent = student.name || '—';
    const stAdmNoEl = document.getElementById('st-admNo');
    if (stAdmNoEl) stAdmNoEl.textContent = student.admissionNo || student.id || '—';
    const stClassEl = document.getElementById('st-class');
    if (stClassEl) stClassEl.textContent = student.class || '—';

    const schoolInfo = safeLocalGet('schoolInfo', {});
    const stTermEl = document.getElementById('st-term');
    if (stTermEl) stTermEl.textContent = `${schoolInfo.academicYear || '2024/2025'} — Term ${schoolInfo.term || '1'}`;
    if (typeof Attendance !== 'undefined') {
        Attendance.load();
        const attEl = document.getElementById('st-attendance');
        if (attEl) attEl.textContent = Attendance.label(student.id) || '—';
    }
    const displayTagEl = document.getElementById('studentDisplayTag');
    if (displayTagEl) displayTagEl.textContent = `Welcome, ${(student.name || 'Student').split(' ')[0]}`;
    const excelBtn = document.getElementById('studentExcelBtn');
    if (excelBtn) {
        const key = encodeURIComponent(student.admissionNo || student.id || '');
        excelBtn.href = '/open?src=' + encodeURIComponent('/api/export/student.xlsx?admission=' + key);
        excelBtn.setAttribute('download', String(student.name || 'student').replace(/[^\w]+/g, '_') + '_results.xlsx');
        excelBtn.removeAttribute('target');
    }

    // Apply School Branding
    const settings = safeLocalGet('schoolSettings', {});
    syncStudentPortalBranding(settings);

    // Fetch Results for Student
    await renderStudentResults(student);

    // Restore saved active tab on refresh if present
    const savedTab = sessionStorage.getItem('studentTab') || 'report';
    if (savedTab) switchStudentTab(savedTab);

    // Setup Realtime Updates for Student Portal
    setupStudentRealtimeListener(student);
}

async function renderStudentResults(student) {
    const summaryCardsEl = document.getElementById('studentResultsSummaryCards');
    const container = document.getElementById('studentReportCardContainer');
    if (!container) return;

    const rows = collectStudentResultRows(student);
    const details = safeLocalGet('studentReportDetails', {});
    const d = details[student.id] || details[String(student.id)] || {};
    const jhsKeywords = ['basic 7', 'basic 8', 'basic 9', 'jhs 1', 'jhs 2', 'jhs 3', 'jhs'];
    const className = String(student.class || '');
    const isJHS = jhsKeywords.some(k => className.toLowerCase().includes(k)) || student.level === 'JHS';

    let totalScoreSum = 0, scoredCount = 0;
    const jhsSubjectResults = [];

    const jhsScale = [
        { min: 80, max: 100, grade: '1', remark: 'EXCELLENT' },
        { min: 70, max: 79,  grade: '2', remark: 'VERY GOOD' },
        { min: 65, max: 69,  grade: '3', remark: 'GOOD' },
        { min: 60, max: 64,  grade: '4', remark: 'CREDIT' },
        { min: 55, max: 59,  grade: '5', remark: 'AVERAGE' },
        { min: 50, max: 54,  grade: '6', remark: 'PASS' },
        { min: 45, max: 49,  grade: '7', remark: 'WEAK PASS' },
        { min: 40, max: 44,  grade: '8', remark: 'FAIL' },
        { min: 0,  max: 39,  grade: '9', remark: 'FAIL' }
    ];
    const standardScale = [
        { min: 80, max: 100, grade: 'A',  remark: 'ADVANCED' },
        { min: 68, max: 79,  grade: 'P',  remark: 'PROFICIENT' },
        { min: 54, max: 67,  grade: 'AP', remark: 'APPROACHING PROFICIENCY' },
        { min: 40, max: 53,  grade: 'D',  remark: 'DEVELOPING' },
        { min: 0,  max: 39,  grade: 'B',  remark: 'BEGINNER' }
    ];
    function getSummaryGrade(tot) {
        if (typeof getGradingScaleForClass === 'function') {
            const clsScale = getGradingScaleForClass(student.classId || student.class);
            if (clsScale && Array.isArray(clsScale) && clsScale.length > 0) {
                const t = Math.max(0, Math.min(100, Number(tot) || 0));
                return clsScale.find(g => t >= g.min && t <= g.max) || clsScale[clsScale.length - 1];
            }
        }
        const sc = isJHS ? jhsScale : standardScale;
        const t = Math.max(0, Math.min(100, Number(tot) || 0));
        return sc.find(g => t >= g.min && t <= g.max) || sc[sc.length - 1];
    }

    rows.forEach(r => {
        const cs = r['Class Score'] !== '' && r['Class Score'] != null ? Number(r['Class Score']) : null;
        const es = r['Exam Score'] !== '' && r['Exam Score'] != null ? Number(r['Exam Score']) : null;
        const tot = r.Total !== '' && r.Total != null ? Number(r.Total) : (cs != null && es != null ? (cs + es) : null);
        if (tot != null) {
            totalScoreSum += tot;
            scoredCount++;
            const g = getSummaryGrade(tot);
            jhsSubjectResults.push({ sub: r.Subject, tot, grade: Number(g.grade) || 99 });
        }
    });

    const avg = scoredCount > 0 ? (totalScoreSum / scoredCount) : 0;
    const overallGrade = getSummaryGrade(avg);
    const attText = (typeof Attendance !== 'undefined' && Attendance.label(student.id)) || d.attendance || '—';

    // Build JHS Aggregate if applicable
    let aggCardHTML = '';
    if (isJHS && scoredCount > 0) {
        const allSubjects = JSON.parse(localStorage.getItem('subjects') || '[]');
        const adminCoreNames = new Set(allSubjects.filter(s => s.isCore).map(s => s.name.toLowerCase()));
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

        aggCardHTML = `
            <div style="background:#1e1b4b;color:#fff;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                <div style="font-size:11px;color:#a5b4fc;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"><i class="fas fa-award"></i> BECE Aggregate</div>
                <div style="font-size:24px;font-weight:800;margin:6px 0 2px 0;color:#38bdf8;">${totalAgg}</div>
                <div style="font-size:11px;color:#c7d2fe;">4 Cores + 2 Best Electives</div>
            </div>
        `;
    }

    if (summaryCardsEl) {
        summaryCardsEl.innerHTML = `
            <div style="background:#1e293b;color:#fff;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"><i class="fas fa-chart-line"></i> Average Score</div>
                <div style="font-size:24px;font-weight:800;margin:6px 0 2px 0;color:#60a5fa;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</div>
                <div style="font-size:11px;color:#94a3b8;">Terminal Average</div>
            </div>
            <div style="background:#1e293b;color:#fff;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"><i class="fas fa-medal"></i> Overall Average Grade</div>
                <div style="font-size:24px;font-weight:800;margin:6px 0 2px 0;color:#34d399;">${scoredCount ? overallGrade.grade : '—'}</div>
                <div style="font-size:11px;color:#94a3b8;">${scoredCount ? overallGrade.remark : 'No grades yet'}</div>
            </div>
            <div style="background:#1e293b;color:#fff;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"><i class="fas fa-book-reader"></i> Recorded Subjects</div>
                <div style="font-size:24px;font-weight:800;margin:6px 0 2px 0;color:#fbbf24;">${scoredCount} <span style="font-size:14px;font-weight:500;color:#94a3b8;">/ ${rows.length}</span></div>
                <div style="font-size:11px;color:#94a3b8;">Subjects with marks</div>
            </div>
            <div style="background:#1e293b;color:#fff;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:11px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"><i class="fas fa-user-check"></i> Attendance</div>
                <div style="font-size:20px;font-weight:800;margin:8px 0 2px 0;color:#c084fc;">${attText}</div>
                <div style="font-size:11px;color:#94a3b8;">Term register status</div>
            </div>
            ${aggCardHTML}
        `;
    }

    const reportMarkup = buildUnifiedStudentReportHTML(student);
    container.innerHTML = reportMarkup || `
        <div style="background:#fff;color:#1e293b;padding:32px;border-radius:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',sans-serif;">
            <i class="fas fa-info-circle" style="font-size:32px;color:#818cf8;margin-bottom:12px;"></i>
            <h3>No Official Results Published Yet</h3>
            <p style="color:#64748b;font-size:14px;margin-top:6px;">Your marks and terminal report for this academic period will appear here once finalized and approved by the administration.</p>
        </div>
    `;
}

function setupStudentRealtimeListener(student) {
    if (typeof isFirebaseActive === 'undefined' || !isFirebaseActive || typeof db === 'undefined' || !db) return;

    const unsub = db.collection('results').where('studentId', '==', student.id.toString())
        .onSnapshot(() => {
            renderStudentResults(student);
        });
    realtimeUnsubscribers.push(unsub);
}

function handleStudentLogout() {
    sessionStorage.removeItem('studentAuthId');
    sessionStorage.removeItem('studentClass');
    activeStudentData = null;
    if (Array.isArray(realtimeUnsubscribers)) {
        realtimeUnsubscribers.forEach(unsub => {
            try { if (typeof unsub === 'function') unsub(); } catch (e) {}
        });
        realtimeUnsubscribers = [];
    }
    const errEl = document.getElementById('studentAuthError');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    const input = document.getElementById('studentLoginId');
    if (input) input.value = '';
    const main = document.getElementById('studentMainContent');
    if (main) main.style.display = 'none';
    const overlay = document.getElementById('studentAuthOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function collectStudentResultRows(student) {
    const scores = safeLocalGet('scores', {});
    const results = safeLocalGet('results', []);
    const rowsMap = new Map();

    // 1. Load from scores
    Object.keys(scores).forEach(sub => {
        const bag = scores[sub] || {};
        const entry = bag[student.id] || bag[String(student.id)] || (!isNaN(Number(student.id)) ? bag[Number(student.id)] : null);
        if (!entry || (entry.classScore === '' && entry.examScore === '' && (entry.totalScore == null || entry.totalScore === ''))) return;
        rowsMap.set(sub.toLowerCase().trim(), {
            Subject: sub,
            'Class Score': entry.classScore50 != null && entry.classScore50 !== '' ? entry.classScore50 : (entry.classScore ?? ''),
            'Exam Score': entry.examScore50 != null && entry.examScore50 !== '' ? entry.examScore50 : (entry.examScore ?? ''),
            Total: entry.totalScore ?? '',
            Grade: entry.grade || '',
            Remark: entry.remark || ''
        });
    });

    // 2. Overwrite / merge from results array (has admin edits)
    results.filter(r => String(r.studentId) === String(student.id)).forEach(r => {
        const sub = r.subjectName || r.subjectId || 'Subject';
        if (r.classScore !== '' || r.examScore !== '' || (r.totalScore != null && r.totalScore !== '')) {
            rowsMap.set(sub.toLowerCase().trim(), {
                Subject: sub,
                'Class Score': r.classScore50 != null && r.classScore50 !== '' ? r.classScore50 : (r.classScore != null && r.classScore !== '' ? Math.round((Number(r.classScore)/100)*50*10)/10 : ''),
                'Exam Score': r.examScore50 != null && r.examScore50 !== '' ? r.examScore50 : (r.examScore != null && r.examScore !== '' ? Math.round((Number(r.examScore)/100)*50*10)/10 : ''),
                Total: r.totalScore ?? '',
                Grade: r.grade || '',
                Remark: r.remark || ''
            });
        }
    });

    return Array.from(rowsMap.values());
}

function downloadStudentResultsCsv() {
    if (!activeStudentData) return;
    const rows = collectStudentResultRows(activeStudentData);
    const name = String(activeStudentData.name || 'student').replace(/[^\w]+/g, '_') + '_results.csv';
    if (window.OneRealFiles) {
        const csv = OneRealFiles.toCsv(rows.length ? rows : [{ Subject: '', Total: '', Grade: '', Remark: 'No results yet' }]);
        OneRealFiles.download(name, csv, 'text/csv;charset=utf-8');
        return;
    }
    alert('Download helper missing. Hard-refresh the page.');
}

function formatOrdinal(n) {
    if (!n || isNaN(n)) return '';
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getStudentClassRank(student) {
    if (!student || !student.class) return null;
    const allStudents = safeLocalGet('students', []);
    const classMates = allStudents.filter(s => (s.class || '') === student.class && !s.isDeleted && s.status !== 'deleted');
    if (!classMates.length) return null;

    const allScores = safeLocalGet('scores', {});
    const allResults = safeLocalGet('results', []);

    const ranked = classMates.map(cm => {
        let total = 0, count = 0;
        Object.keys(allScores).forEach(sub => {
            const entry = allScores[sub] ? (allScores[sub][cm.id] || allScores[sub][String(cm.id)]) : null;
            if (entry) {
                if (entry.totalScore !== '' && entry.totalScore !== undefined && entry.totalScore !== null) {
                    total += Number(entry.totalScore);
                    count++;
                } else if (entry.classScore !== '' && entry.examScore !== '' && entry.classScore != null && entry.examScore != null) {
                    const cs50 = (Number(entry.classScore) / 100) * 50;
                    const es50 = (Number(entry.examScore) / 100) * 50;
                    total += (cs50 + es50);
                    count++;
                }
            }
        });
        if (count === 0 && allResults.length) {
            const stuResults = allResults.filter(r => (String(r.studentId) === String(cm.id) || String(r.admissionNo) === String(cm.admissionNo)) && r.totalScore !== '' && r.totalScore != null);
            if (stuResults.length) {
                stuResults.forEach(r => {
                    total += Number(r.totalScore);
                    count++;
                });
            }
        }
        return {
            id: String(cm.id),
            avg: count > 0 ? (total / count) : -1
        };
    }).sort((a, b) => b.avg - a.avg);

    const index = ranked.findIndex(r => r.id === String(student.id));
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

function buildUnifiedStudentReportHTML(student) {
    if (!student) return '';
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    const schoolInfo = JSON.parse(localStorage.getItem('schoolInfo') || '{}');
    const school = getSystemSchoolName();
    const details = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const d = details[student.id] || details[String(student.id)] || {};

    const fieldToggles = settings.fieldToggles || {};
    const showPosition = fieldToggles.showPosition !== false;
    const showLogo = fieldToggles.showSchoolLogo !== false;
    const showNextTerm = fieldToggles.showNextTerm !== false;

    let positionText = '—';
    if (showPosition) {
        const rankInfo = getStudentClassRank(student);
        if (rankInfo && rankInfo.formatted) {
            positionText = rankInfo.formatted;
        }
    }

    const logoSrc = (showLogo && (settings.schoolLogo || schoolInfo.schoolLogo)) || null;
    const yr = schoolInfo.academicYear || '';
    const tm = schoolInfo.term ? ('Term ' + schoolInfo.term) : '';

    const primaryColor = settings.primaryColor || '#4f46e5';
    const secondaryColor = settings.secondaryColor || '#7e3af2';
    const headerTextColor = settings.headerTextColor || '#ffffff';
    const primaryDark = (typeof adjustColorBrightness === 'function') ? adjustColorBrightness(primaryColor, -15) : '#4338ca';

    const jhsKeywords = ['basic 7', 'basic 8', 'basic 9', 'jhs 1', 'jhs 2', 'jhs 3', 'jhs'];
    const className = String(student.class || '');
    const isJHS = jhsKeywords.some(k => className.toLowerCase().includes(k)) || student.level === 'JHS';

    // JHS Stanine Scale
    const jhsScale = [
        { min: 80, max: 100, grade: '1', remark: 'EXCELLENT' },
        { min: 70, max: 79,  grade: '2', remark: 'VERY GOOD' },
        { min: 65, max: 69,  grade: '3', remark: 'GOOD' },
        { min: 60, max: 64,  grade: '4', remark: 'CREDIT' },
        { min: 55, max: 59,  grade: '5', remark: 'AVERAGE' },
        { min: 50, max: 54,  grade: '6', remark: 'PASS' },
        { min: 45, max: 49,  grade: '7', remark: 'WEAK PASS' },
        { min: 40, max: 44,  grade: '8', remark: 'FAIL' },
        { min: 0,  max: 39,  grade: '9', remark: 'FAIL' }
    ];

    const standardScale = [
        { min: 80, max: 100, grade: 'A',  remark: 'ADVANCED' },
        { min: 68, max: 79,  grade: 'P',  remark: 'PROFICIENT' },
        { min: 54, max: 67,  grade: 'AP', remark: 'APPROACHING PROFICIENCY' },
        { min: 40, max: 53,  grade: 'D',  remark: 'DEVELOPING' },
        { min: 0,  max: 39,  grade: 'B',  remark: 'BEGINNER' }
    ];

    function getGrade(tot) {
        if (typeof getGradingScaleForClass === 'function') {
            const clsScale = getGradingScaleForClass(student.classId || student.class);
            if (clsScale && Array.isArray(clsScale) && clsScale.length > 0) {
                const t = Math.max(0, Math.min(100, Number(tot) || 0));
                return clsScale.find(g => t >= g.min && t <= g.max) || clsScale[clsScale.length - 1];
            }
        }
        const sc = isJHS ? jhsScale : standardScale;
        const t = Math.max(0, Math.min(100, Number(tot) || 0));
        return sc.find(g => t >= g.min && t <= g.max) || sc[sc.length - 1];
    }

    const rows = collectStudentResultRows(student);
    let totalScoreSum = 0, scoredCount = 0;
    const jhsSubjectResults = [];

    const rowsHtml = rows.map(r => {
        const cs = r['Class Score'] !== '' && r['Class Score'] != null ? Number(r['Class Score']) : null;
        const es = r['Exam Score'] !== '' && r['Exam Score'] != null ? Number(r['Exam Score']) : null;
        const tot = r.Total !== '' && r.Total != null ? Number(r.Total) : (cs != null && es != null ? (cs + es) : null);
        const g = tot != null ? getGrade(tot) : { grade: '—', remark: 'No scores' };
        
        if (tot != null) {
            totalScoreSum += tot;
            scoredCount++;
            jhsSubjectResults.push({ sub: r.Subject, tot, grade: Number(g.grade) || 99 });
        } else {
            jhsSubjectResults.push({ sub: r.Subject, tot: null, grade: 99 });
        }

        return `<tr>
            <td style="text-align:left;font-weight:600;padding:8px 10px;border:1px solid #cbd5e1;">${r.Subject}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${cs != null ? cs : '—'}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${es != null ? es : '—'}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;"><strong>${tot != null ? tot : '—'}</strong></td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:${primaryColor}1a;color:${primaryDark};">${g.grade}</span></td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${g.remark}</td>
        </tr>`;
    }).join('');

    const avg = scoredCount > 0 ? (totalScoreSum / scoredCount) : 0;
    const overallGrade = getGrade(avg);

    // JHS Aggregate: 4 Core + 2 Best Electives
    let jhsAggregateHTML = '';
    if (isJHS) {
        const allSubjects = JSON.parse(localStorage.getItem('subjects') || '[]');
        const adminCoreNames = new Set(allSubjects.filter(s => s.isCore).map(s => s.name.toLowerCase()));
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

    const logoEl = logoSrc
        ? `<img src="${logoSrc}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo">`
        : `<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>`;

    const attText = (typeof Attendance !== 'undefined' && Attendance.label(student.id)) || d.attendance || '—';

    return `
    <div id="printableReportCard" style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',sans-serif;max-width:800px;margin:0 auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid ${primaryColor};padding-bottom:14px;margin-bottom:18px;">
            ${logoEl}
            <div style="text-align:center;flex:1;padding:0 12px;">
                <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;letter-spacing:-0.5px;">${school}</h2>
                <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${settings.address || ''}</p>
                <p style="font-size:11.5px;color:${primaryColor};font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${settings.motto || 'Drink deep or taste not the spring of knowledge'}&rdquo;</em></p>
                <div style="display:inline-block;background:${primaryColor};color:${headerTextColor};font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:0.5px;">
                    END OF ${tm.toUpperCase() || 'TERM'} REPORT SHEET
                </div>
            </div>
            ${logoEl}
        </div>

        <div class="report-meta-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#f8fafc;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #e2e8f0;">
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">NAME OF LEARNER</span><strong>${student.name || ''}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS</span><strong>${student.class || ''}</strong></div>
            ${showPosition ? `<div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="color:${primaryDark};font-size:13.5px;">${positionText}</strong></div>` : ''}
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">ACADEMIC YEAR</span><strong>${yr}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">TERM</span><strong>${tm}</strong></div>
            ${showNextTerm ? `
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">DATE OF VACATION</span><strong>${settings.closingDate || schoolInfo.closingDate || '—'}</strong></div>
            <div><span style="color:#64748b;font-size:10.5px;display:block;font-weight:600;">RE-OPENING DATE</span><strong>${settings.reopeningDate || schoolInfo.reopeningDate || '—'}</strong></div>
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
                <tbody>${rowsHtml || '<tr><td colspan="6" style="padding:16px;color:#94a3b8;">No results recorded</td></tr>'}</tbody>
            </table>
        </div>

        ${jhsAggregateHTML}

        <div class="report-perf-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:8px;background:#eef2ff;padding:12px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;border:1px solid #c7d2fe;">
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">OVERALL AVERAGE GRADE</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount ? overallGrade.grade + ' (' + overallGrade.remark + ')' : '—'}</strong></div>
            ${showPosition ? `<div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">CLASS POSITION</span><strong style="font-size:14px;color:#1e1b4b;">${positionText}</strong></div>` : ''}
            <div><span style="color:${primaryDark};font-size:10.5px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:14px;color:#1e1b4b;">${scoredCount} / ${rows.length}</strong></div>
        </div>

        <div class="report-conduct-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:10px;margin-bottom:14px;font-size:12px;">
            <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Attendance:</span> ${attText}</div>
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Conduct:</span> ${d.conduct || '—'}</div>
                <div><span style="color:#64748b;font-weight:600;">Interest:</span> ${d.interest || '—'}</div>
            </div>
            <div style="background:#f8fafc;padding:10px 12px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Promoted to / In:</span> ${d.promotionTarget || d.promotionStatus || '—'}</div>
                <div><span style="color:#64748b;font-weight:600;">Teacher Remarks:</span> <em>${d.teacherRemarks || '—'}</em></div>
            </div>
        </div>

        ${(() => {
            const allTeachers = JSON.parse(localStorage.getItem('teachers') || '[]');
            const tMatch = allTeachers.find(t => t.class === student.class || (Array.isArray(t.classes) && t.classes.includes(student.class)));
            const teacherName = tMatch ? (tMatch.name || tMatch.fullName) : (d.classTeacher || '—');
            const teacherSig = localStorage.getItem('teacherSignature_' + student.class) || (tMatch && tMatch.signature) || null;
            const headName = settings.headTeacher || schoolInfo.headTeacher || '—';
            const headSig = settings.headTeacherSignature || schoolInfo.headTeacherSignature || localStorage.getItem('headTeacherSignature') || null;

            return `
            <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569;gap:20px;">
                <div style="flex:1;">
                    <div><strong>Class Teacher:</strong> ${teacherName}</div>
                    ${teacherSig ? `<div style="height:28px;margin-top:2px;display:flex;align-items:flex-end;"><img src="${teacherSig}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Class Teacher Signature"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                    <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
                </div>
                <div style="flex:1;text-align:right;">
                    <div><strong>Headteacher:</strong> ${headName}</div>
                    ${headSig ? `<div style="height:28px;margin-top:2px;display:flex;justify-content:flex-end;align-items:flex-end;"><img src="${headSig}" style="max-height:26px;max-width:140px;object-fit:contain;" alt="Headteacher Signature"></div>` : '<div style="height:24px;margin-top:4px;"></div>'}
                    <div style="border-top:1px solid #94a3b8;padding-top:3px;font-size:10.5px;color:#94a3b8;">Signature</div>
                </div>
            </div>`;
        })()}
    </div>`;
}

let activeStudentTab = 'report';

function switchStudentTab(tab) {
    activeStudentTab = tab;
    sessionStorage.setItem('studentTab', tab);
    
    // Update button states
    ['report', 'timetable', 'exams'].forEach(t => {
        const btn = document.getElementById(`studentTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
        const sec = document.getElementById(`studentSection${t.charAt(0).toUpperCase() + t.slice(1)}`);
        if (btn) {
            if (t === tab) btn.classList.add('active');
            else btn.classList.remove('active');
        }
        if (sec) {
            sec.style.display = (t === tab) ? 'block' : 'none';
        }
    });

    if (tab === 'timetable' && activeStudentData) {
        renderStudentTimetable(activeStudentData);
    } else if (tab === 'exams' && activeStudentData) {
        renderStudentExams(activeStudentData);
    }
}

async function renderStudentTimetable(student) {
    const container = document.getElementById('studentTimetableContainer');
    if (!container || !student) return;

    container.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Loading class timetable…</p></div>';

    try {
        const [ttRes, cfgRes] = await Promise.all([
            fetch('/api/timetables'),
            fetch('/api/timetables/config')
        ]);

        const timetables = ttRes.ok ? await ttRes.json() : [];
        const config = cfgRes.ok ? await cfgRes.json() : {
            days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            periods: [
                { period: 1, time: '08:00 - 08:45' },
                { period: 2, time: '08:45 - 09:30' },
                { period: 3, time: '09:30 - 10:15' },
                { period: 4, time: '10:45 - 11:30' },
                { period: 5, time: '11:30 - 12:15' },
                { period: 6, time: '12:15 - 13:00' },
                { period: 7, time: '13:30 - 14:15' },
                { period: 8, time: '14:15 - 15:00' }
            ]
        };

        const studentClass = student.class || '';
        const classSlots = timetables.filter(t => (t.class || '').toLowerCase() === studentClass.toLowerCase());

        const ttSub = document.getElementById('studentTimetableSubtitle');
        if (ttSub) ttSub.textContent = `Official Weekly Schedule for ${studentClass} (Managed by Administration)`;

        if (!classSlots.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:#64748b;">
                    <div style="width:60px;height:60px;background:#f1f5f9;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;color:#94a3b8;">
                        <i class="fas fa-calendar-times"></i>
                    </div>
                    <h4 style="font-size:16px;color:#1e293b;margin:0 0 6px;font-weight:700;">No Timetable Published Yet</h4>
                    <p style="font-size:13px;max-width:420px;margin:0 auto;line-height:1.5;">The school administration has not published a timetable for <strong>${studentClass}</strong> yet. When it is ready, your weekly schedule will appear here automatically.</p>
                </div>
            `;
            return;
        }

        const days = config.days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const periods = config.periods || [];

        let tableHtml = `
            <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div>
                    <span style="font-size:16px;font-weight:800;color:#0f172a;">${studentClass} Timetable</span>
                    <span style="font-size:12px;background:#e0e7ff;color:#4338ca;padding:3px 10px;border-radius:12px;font-weight:700;margin-left:8px;">${classSlots.length} Slots Scheduled</span>
                </div>
                <div style="font-size:12px;color:#64748b;">
                    <i class="fas fa-lock"></i> Read-only portal view
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;min-width:650px;text-align:center;font-size:12px;">
                <thead>
                    <tr style="background:#0f172a;color:#ffffff;">
                        <th style="padding:10px;border:1px solid #1e293b;width:110px;text-align:center;">Period / Time</th>
                        ${days.map(d => `<th style="padding:10px;border:1px solid #1e293b;">${d}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        periods.forEach(p => {
            tableHtml += `<tr>`;
            tableHtml += `
                <td style="padding:10px 8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:700;color:#334155;">
                    <div>Period ${p.period}</div>
                    <div style="font-size:10.5px;color:#64748b;font-weight:normal;margin-top:2px;">${p.time}</div>
                </td>
            `;

            days.forEach(day => {
                const slot = classSlots.find(s => String(s.period) === String(p.period) && (s.day || '').toLowerCase() === day.toLowerCase());
                if (slot && slot.subject) {
                    tableHtml += `
                        <td style="padding:8px;border:1px solid #e2e8f0;background:#eef2ff;vertical-align:top;">
                            <div style="font-weight:700;color:#3730a3;font-size:13px;">${slot.subject}</div>
                            ${slot.teacher ? `<div style="font-size:11px;color:#4f46e5;margin-top:3px;"><i class="fas fa-user-tie"></i> ${slot.teacher}</div>` : ''}
                            ${slot.room ? `<div style="font-size:10.5px;color:#64748b;margin-top:2px;"><i class="fas fa-door-open"></i> ${slot.room}</div>` : ''}
                        </td>
                    `;
                } else {
                    tableHtml += `
                        <td style="padding:8px;border:1px solid #e2e8f0;background:#ffffff;color:#cbd5e1;">
                            —
                        </td>
                    `;
                }
            });

            tableHtml += `</tr>`;
        });

        tableHtml += `
                </tbody>
            </table>
        `;

        container.innerHTML = tableHtml;

    } catch (err) {
        container.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">Failed to load timetable: ${err.message}</div>`;
    }
}

async function renderStudentExams(student) {
    const container = document.getElementById('studentExamsContainer');
    if (!container || !student) return;

    container.innerHTML = '<div style="text-align:center;padding:30px;color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Loading examination schedule…</p></div>';

    try {
        const res = await fetch('/api/timetables/exams');
        const allExams = res.ok ? await res.json() : [];

        const studentClass = student.class || '';
        const classExams = allExams.filter(e => (e.class || '').toLowerCase() === studentClass.toLowerCase());

        const exSub = document.getElementById('studentExamsSubtitle');
        if (exSub) exSub.textContent = `Official Examinations Schedule for ${studentClass}`;

        if (!classExams.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:#64748b;">
                    <div style="width:60px;height:60px;background:#fdf4ff;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:24px;color:#c084fc;">
                        <i class="fas fa-clipboard-check"></i>
                    </div>
                    <h4 style="font-size:16px;color:#1e293b;margin:0 0 6px;font-weight:700;">No Examinations Scheduled</h4>
                    <p style="font-size:13px;max-width:420px;margin:0 auto;line-height:1.5;">There are currently no examinations scheduled for <strong>${studentClass}</strong>. Exam timetables set by administration will be shown here.</p>
                </div>
            `;
            return;
        }

        // Sort exams chronologically
        classExams.sort((a, b) => (a.examDate || '').localeCompare(b.examDate || ''));

        let tableHtml = `
            <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div>
                    <span style="font-size:16px;font-weight:800;color:#0f172a;">${studentClass} Examination Timetable</span>
                    <span style="font-size:12px;background:#f3e8ff;color:#7e22ce;padding:3px 10px;border-radius:12px;font-weight:700;margin-left:8px;">${classExams.length} Paper(s)</span>
                </div>
                <div style="font-size:12px;color:#64748b;">
                    <i class="fas fa-info-circle"></i> Please arrive 15 minutes before start time
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;min-width:600px;text-align:left;font-size:12.5px;">
                <thead>
                    <tr style="background:#1e1b4b;color:#ffffff;">
                        <th style="padding:10px 12px;border:1px solid #312e81;">Subject</th>
                        <th style="padding:10px 12px;border:1px solid #312e81;">Exam Title</th>
                        <th style="padding:10px 12px;border:1px solid #312e81;">Date & Time</th>
                        <th style="padding:10px 12px;border:1px solid #312e81;">Hall / Room</th>
                        <th style="padding:10px 12px;border:1px solid #312e81;">Invigilator</th>
                    </tr>
                </thead>
                <tbody>
        `;

        classExams.forEach(ex => {
            tableHtml += `
                <tr style="border-bottom:1px solid #e2e8f0;">
                    <td style="padding:12px;font-weight:700;color:#0f172a;">
                        <i class="fas fa-book" style="color:#7c3aed;margin-right:6px;"></i> ${ex.subject}
                    </td>
                    <td style="padding:12px;color:#334155;">${ex.examTitle || 'Term Exam'}</td>
                    <td style="padding:12px;">
                        <div style="font-weight:600;color:#0f172a;"><i class="fas fa-calendar-day" style="color:#6366f1;"></i> ${ex.examDate}</div>
                        <div style="font-size:11.5px;color:#64748b;">${ex.startTime || '09:00'} - ${ex.endTime || '11:00'}</div>
                    </td>
                    <td style="padding:12px;">
                        <span style="display:inline-block;padding:3px 8px;border-radius:6px;background:#f1f5f9;font-weight:700;color:#334155;border:1px solid #e2e8f0;">
                            ${ex.hall || 'Main Hall'}
                        </span>
                    </td>
                    <td style="padding:12px;color:#475569;font-size:12px;">
                        ${ex.chiefInvigilator ? `<div><i class="fas fa-user-check" style="color:#059669;"></i> ${ex.chiefInvigilator}</div>` : '<span style="color:#94a3b8;">Assigned by Admin</span>'}
                    </td>
                </tr>
            `;
        });

        tableHtml += `
                </tbody>
            </table>
        `;

        container.innerHTML = tableHtml;

    } catch (err) {
        container.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">Failed to load examination schedule: ${err.message}</div>`;
    }
}

function printStudentTimetable() {
    const el = document.getElementById('studentTimetableContainer');
    if (!el) return;
    const win = window.open('', '_blank', 'width=900,height=750');
    win.document.write(`<!DOCTYPE html><html><head><title>Class Timetable — ${activeStudentData ? activeStudentData.class : ''}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>body{margin:24px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5e1;padding:8px;}</style>
    </head><body><h2>Weekly Class Timetable — ${activeStudentData ? activeStudentData.class : ''}</h2>${el.innerHTML}<script>window.onload=function(){window.print();};<\/script></body></html>`);
    win.document.close();
}

function printStudentExams() {
    const el = document.getElementById('studentExamsContainer');
    if (!el) return;
    const win = window.open('', '_blank', 'width=900,height=750');
    win.document.write(`<!DOCTYPE html><html><head><title>Examination Timetable — ${activeStudentData ? activeStudentData.class : ''}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>body{margin:24px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #cbd5e1;padding:8px;}</style>
    </head><body><h2>Examination Timetable — ${activeStudentData ? activeStudentData.class : ''}</h2>${el.innerHTML}<script>window.onload=function(){window.print();};<\/script></body></html>`);
    win.document.close();
}

function printStudentReportSheet() {
    if (!activeStudentData) return;
    const markup = buildUnifiedStudentReportHTML(activeStudentData);
    const win = window.open('', '_blank', 'width=900,height=750');
    win.document.write(`<!DOCTYPE html><html><head><title>Official Report Sheet — ${activeStudentData.name || ''}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>body{margin:20px;font-family:'Inter',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}table th,table td{border:1px solid #cbd5e1;}</style>
    </head><body>${markup}<script>window.onload=function(){window.print();};<\/script></body></html>`);
    win.document.close();
}

async function downloadStudentReportFile() {
    if (!activeStudentData) return;
    const student = activeStudentData;
    const filename = String(student.name || 'student').replace(/[^\w]+/g, '_') + '_report.pdf';
    const reportMarkup = buildUnifiedStudentReportHTML(student);

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:0;left:0;width:800px;background:#fff;z-index:-9999;opacity:0.01;pointer-events:none;';
    container.innerHTML = reportMarkup;
    document.body.appendChild(container);

    await new Promise(r => setTimeout(r, 80));

    const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;

    try {
        if (typeof html2canvas !== 'undefined' && jsPDFConstructor) {
            const targetEl = container.querySelector('#printableReportCard') || container.firstElementChild || container;
            const canvas = await html2canvas(targetEl, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff'
            });
            if (container.parentNode) document.body.removeChild(container);

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
            const blob = doc.output('blob');
            downloadBlobDirect(blob, filename, 'application/pdf');
            return;
        }
    } catch (e) {
        console.warn('html2canvas render error in student portal:', e);
    }

    if (container.parentNode) document.body.removeChild(container);
    printStudentReportSheet();
}

function downloadBlobDirect(content, filename, mime) {
    try {
        if (window.OneRealFiles && typeof OneRealFiles.download === 'function') {
            const res = OneRealFiles.download(filename, content, mime);
            if (res !== undefined) return res;
        }
    } catch(e) {}

    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 3000);
}
