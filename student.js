// ════════════════════════════════════════════════════════════════════
// Student Portal Engine — OneReal School Management System
// Real-time, read-only performance viewer for students & parents
// ════════════════════════════════════════════════════════════════════

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

document.addEventListener('DOMContentLoaded', () => {
    const savedId = sessionStorage.getItem('studentAuthId');
    if (savedId) {
        loadStudentDashboard(savedId).catch(() => {
            sessionStorage.removeItem('studentAuthId');
        });
    }
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
    const localStudents = JSON.parse(localStorage.getItem('students') || '[]');
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

    if (!student) {
        throw new Error(`Student with Admission Number "${admissionNo}" not found. Please check your card or contact your class teacher.`);
    }

    activeStudentData = student;

    // Hide Overlay & Display Main Content
    document.getElementById('studentAuthOverlay').style.display = 'none';
    document.getElementById('studentMainContent').style.display = 'block';

    // Populate Student Meta Info
    document.getElementById('st-name').textContent  = student.name || '—';
    document.getElementById('st-admNo').textContent = student.admissionNo || student.id || '—';
    document.getElementById('st-class').textContent = student.class || '—';

    const schoolInfo = JSON.parse(localStorage.getItem('schoolInfo') || '{}');
    document.getElementById('st-term').textContent = `${schoolInfo.academicYear || '2024/2025'} — Term ${schoolInfo.term || '1'}`;
    if (typeof Attendance !== 'undefined') {
        Attendance.load();
        const attEl = document.getElementById('st-attendance');
        if (attEl) attEl.textContent = Attendance.label(student.id) || '—';
    }
    document.getElementById('studentDisplayTag').textContent = `Welcome, ${student.name.split(' ')[0]}`;
    const excelBtn = document.getElementById('studentExcelBtn');
    if (excelBtn) {
        const key = encodeURIComponent(student.admissionNo || student.id || '');
        excelBtn.href = '/open?src=' + encodeURIComponent('/api/export/student.xlsx?admission=' + key);
        excelBtn.setAttribute('download', String(student.name || 'student').replace(/[^\w]+/g, '_') + '_results.xlsx');
        excelBtn.removeAttribute('target');
    }

    // Apply School Branding
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    if (settings.schoolName) document.getElementById('studentSchoolName').textContent = settings.schoolName;

    // Fetch Results for Student
    await renderStudentResults(student);

    // Setup Realtime Updates for Student Portal
    setupStudentRealtimeListener(student);
}

async function renderStudentResults(student) {
    const tbody = document.getElementById('studentResultsBody');
    const beceBanner = document.getElementById('beceAggregateBanner');
    if (!tbody) return;

    let resultsMap = {};
    const scores = JSON.parse(localStorage.getItem('scores') || '{}');

    // Extract student scores from local store
    Object.keys(scores).forEach(sub => {
        if (scores[sub] && scores[sub][student.id]) {
            resultsMap[sub] = scores[sub][student.id];
        }
    });

    // Also check Firestore results collection
    if (typeof isFirebaseActive !== 'undefined' && isFirebaseActive && typeof db !== 'undefined' && db) {
        try {
            const snap = await db.collection('results').where('studentId', '==', student.id.toString()).get();
            snap.docs.forEach(doc => {
                const r = doc.data();
                if (r.subjectId) {
                    resultsMap[r.subjectId] = {
                        classScore: r.classScore,
                        examScore: r.examScore,
                        totalScore: r.totalScore,
                        grade: r.grade,
                        remark: r.remark,
                        status: r.status,
                        locked: r.locked
                    };
                }
            });
        } catch (e) {}
    }

    const subjectsList = Object.keys(resultsMap);
    if (!subjectsList.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted-light);">No official results published for this term yet.</td></tr>`;
        if (beceBanner) beceBanner.style.display = 'none';
        return;
    }

    // Determine if student is in JHS
    const isJhs = (student.class || '').toLowerCase().includes('jhs') || student.level === 'JHS';

    if (isJhs && typeof calculateBECEAggregate === 'function') {
        const beceRes = calculateBECEAggregate(resultsMap);
        if (beceRes.isEligible && beceBanner) {
            document.getElementById('beceAggValue').textContent = beceRes.aggregate;
            document.getElementById('beceAggDetail').textContent = beceRes.summaryText;
            beceBanner.style.display = 'flex';
        } else if (beceBanner) {
            beceBanner.style.display = 'none';
        }
    } else if (beceBanner) {
        beceBanner.style.display = 'none';
    }

    // Render Table Rows
    const rowsHtml = subjectsList.map((subject, index) => {
        const entry = resultsMap[subject];
        const gradeClass = (entry.grade || '').toLowerCase().replace(/[^a-z]/g, '');

        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${subject}</strong></td>
                <td>${entry.classScore !== undefined ? entry.classScore : '—'}</td>
                <td>${entry.examScore  !== undefined ? entry.examScore  : '—'}</td>
                <td><strong>${entry.totalScore !== undefined ? entry.totalScore : '—'}</strong></td>
                <td><span class="grade-badge ${gradeClass}">${entry.grade || '—'}</span></td>
                <td>${entry.remark || '—'}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;
}

function setupStudentRealtimeListener(student) {
    if (typeof isFirebaseActive === 'undefined' || !isFirebaseActive || typeof db === 'undefined' || !db) return;

    // Listen for live result updates for this student
    const unsub = db.collection('results').where('studentId', '==', student.id.toString())
        .onSnapshot(snap => {
            renderStudentResults(student);
        });
    realtimeUnsubscribers.push(unsub);
}

function handleStudentLogout() {
    sessionStorage.removeItem('studentAuthId');
    realtimeUnsubscribers.forEach(unsub => unsub());
    realtimeUnsubscribers = [];
    document.getElementById('studentMainContent').style.display = 'none';
    document.getElementById('studentAuthOverlay').style.display = 'flex';
}

function collectStudentResultRows(student) {
    const scores = JSON.parse(localStorage.getItem('scores') || '{}');
    const rows = [];
    Object.keys(scores).forEach(sub => {
        const bag = scores[sub] || {};
        const entry = bag[student.id] || bag[String(student.id)];
        if (!entry) return;
        rows.push({
            Subject: sub,
            'Class Score': entry.classScore50 != null && entry.classScore50 !== '' ? entry.classScore50 : (entry.classScore ?? ''),
            'Exam Score': entry.examScore50 != null && entry.examScore50 !== '' ? entry.examScore50 : (entry.examScore ?? ''),
            Total: entry.totalScore ?? '',
            Grade: entry.grade || '',
            Remark: entry.remark || ''
        });
    });
    return rows;
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

async function downloadStudentReportFile() {
    if (!activeStudentData) return;
    /* overlay save path does not need a popup arm */
    const student = activeStudentData;
    const rows = collectStudentResultRows(student);
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    const school = settings.schoolName || 'The Living Spring School';
    const filename = String(student.name || 'student').replace(/[^\w]+/g, '_') + '_report.pdf';
    try {
        if (window.jspdf && window.jspdf.jsPDF) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'pt', 'a4');
            let y = 48;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
            doc.text(school.toUpperCase(), 297, y, { align: 'center' }); y += 20;
            doc.setFontSize(12);
            doc.text('END OF TERM REPORT SHEET', 297, y, { align: 'center' }); y += 24;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
            doc.text('Name: ' + (student.name || ''), 40, y);
            doc.text('Class: ' + (student.class || ''), 320, y); y += 16;
            doc.text('Admission: ' + (student.admissionNo || student.id || ''), 40, y); y += 22;
            doc.setFont('helvetica', 'bold');
            doc.text('Subject', 40, y); doc.text('Class', 240, y); doc.text('Exam', 310, y); doc.text('Total', 380, y); doc.text('Grade', 450, y);
            y += 14; doc.setFont('helvetica', 'normal');
            (rows.length ? rows : [{ Subject: 'No published results', Total: '', Grade: '' }]).forEach(r => {
                doc.text(String(r.Subject || '').slice(0, 28), 40, y);
                doc.text(String(r['Class Score'] ?? ''), 240, y);
                doc.text(String(r['Exam Score'] ?? ''), 310, y);
                doc.text(String(r.Total ?? ''), 380, y);
                doc.text(String(r.Grade ?? ''), 450, y);
                y += 14;
            });
            const blob = doc.output('blob');
            if (window.OneRealFiles) await OneRealFiles.download(filename, blob, 'application/pdf');
            return;
        }
    } catch (e) {}
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + school + '</title></head><body>' +
        '<h1>' + school + '</h1><h2>' + (student.name || '') + '</h2><p>' + (student.class || '') + '</p>' +
        '<table border="1" cellpadding="6"><tr><th>Subject</th><th>Class</th><th>Exam</th><th>Total</th><th>Grade</th></tr>' +
        rows.map(r => '<tr><td>' + r.Subject + '</td><td>' + r['Class Score'] + '</td><td>' + r['Exam Score'] + '</td><td>' + r.Total + '</td><td>' + r.Grade + '</td></tr>').join('') +
        '</table></body></html>';
    if (window.OneRealFiles) OneRealFiles.download(filename.replace('.pdf', '.html'), html, 'text/html;charset=utf-8');
}
