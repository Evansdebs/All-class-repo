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
    const student = activeStudentData;
    const rows = collectStudentResultRows(student);
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    const schoolInfo = JSON.parse(localStorage.getItem('schoolInfo') || '{}');
    const school = settings.schoolName || 'The Living Spring School';
    const filename = String(student.name || 'student').replace(/[^\w]+/g, '_') + '_report.pdf';

    const details = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const d = details[student.id] || details[String(student.id)] || {};
    const logoSrc = settings.schoolLogo || schoolInfo.schoolLogo || null;
    const yr = schoolInfo.academicYear || '';
    const tm = schoolInfo.term ? ('Term ' + schoolInfo.term) : '';

    let totalScoreSum = 0, scoredCount = 0;
    const rowsHtml = rows.map(r => {
        const tot = Number(r.Total) || 0;
        if (r.Total !== '') { totalScoreSum += tot; scoredCount++; }
        return `<tr>
            <td style="text-align:left;font-weight:600;padding:8px 10px;border:1px solid #cbd5e1;">${r.Subject}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${r['Class Score'] ?? '—'}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${r['Exam Score'] ?? '—'}</td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;"><strong>${r.Total || '—'}</strong></td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:rgba(79,70,229,.1);color:#4338ca;">${r.Grade || '—'}</span></td>
            <td style="padding:8px 10px;border:1px solid #cbd5e1;">${r.Remark || '—'}</td>
        </tr>`;
    }).join('');

    const avg = scoredCount > 0 ? (totalScoreSum / scoredCount) : 0;

    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;font-family:Inter,sans-serif;padding:28px;z-index:-1;';
    container.innerHTML = `
        <div style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;border:1px solid #e2e8f0;font-family:'Inter',sans-serif;">
            <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #4f46e5;padding-bottom:14px;margin-bottom:18px;">
                ${logoSrc ? `<img src="${logoSrc}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo">` : '<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>'}
                <div style="text-align:center;flex:1;padding:0 12px;">
                    <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;">${school}</h2>
                    <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${settings.address || ''}</p>
                    <p style="font-size:11.5px;color:#4f46e5;font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${settings.motto || 'Drink deep or taste not the spring of knowledge'}&rdquo;</em></p>
                    <div style="display:inline-block;background:#4f46e5;color:#fff;font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;">END OF ${tm.toUpperCase() || 'TERM'} REPORT SHEET</div>
                </div>
                ${logoSrc ? `<img src="${logoSrc}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo">` : '<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>'}
            </div>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;background:#f8fafc;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;border:1px solid #e2e8f0;">
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">NAME OF LEARNER</span><strong>${student.name || ''}</strong></div>
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">CLASS</span><strong>${student.class || ''}</strong></div>
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">ACADEMIC YEAR</span><strong>${yr}</strong></div>
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">TERM</span><strong>${tm}</strong></div>
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">DATE OF VACATION</span><strong>${settings.closingDate || schoolInfo.closingDate || '—'}</strong></div>
                <div><span style="color:#64748b;font-size:11px;display:block;font-weight:600;">RE-OPENING DATE</span><strong>${settings.reopeningDate || schoolInfo.reopeningDate || '—'}</strong></div>
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
                <tbody>${rowsHtml || '<tr><td colspan="6" style="padding:16px;color:#94a3b8;">No results recorded</td></tr>'}</tbody>
            </table>
            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;background:#eef2ff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;border:1px solid #c7d2fe;">
                <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
                <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount} / ${rows.length}</strong></div>
                <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">ATTENDANCE</span><strong style="font-size:15px;color:#1e1b4b;">${d.attendance || '—'}</strong></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:12.5px;">
                <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
                    <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Conduct:</span> ${d.conduct || '—'}</div>
                    <div><span style="color:#64748b;font-weight:600;">Interest:</span> ${d.interest || '—'}</div>
                </div>
                <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
                    <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Promoted to / In:</span> ${d.promotionTarget || d.promotionStatus || '—'}</div>
                    <div><span style="color:#64748b;font-weight:600;">Teacher Remarks:</span> <em>${d.teacherRemarks || '—'}</em></div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px dashed #cbd5e1;font-size:12px;color:#475569;">
                <div><strong>Class Teacher:</strong> ____________________</div>
                <div><strong>Headteacher:</strong> ${settings.headTeacher || '____________________'}</div>
            </div>
        </div>
    `;
    document.body.appendChild(container);

    try {
        if (typeof html2canvas !== 'undefined' && window.jspdf) {
            const canvas = await html2canvas(container.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            document.body.removeChild(container);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const W = doc.internal.pageSize.getWidth();
            const imgData = canvas.toDataURL('image/png');
            const ratio = canvas.height / canvas.width;
            const imgH = W * ratio;
            doc.addImage(imgData, 'PNG', 0, 0, W, imgH);
            const blob = doc.output('blob');
            if (window.OneRealFiles) await OneRealFiles.download(filename, blob, 'application/pdf');
            return;
        }
    } catch(e) {
        if (container.parentNode) document.body.removeChild(container);
    }
    if (container.parentNode) document.body.removeChild(container);

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + school + '</title></head><body>' +
        '<h1>' + school + '</h1><h2>' + (student.name || '') + '</h2><p>' + (student.class || '') + '</p>' +
        '<table border="1" cellpadding="6"><tr><th>Subject</th><th>Class</th><th>Exam</th><th>Total</th><th>Grade</th></tr>' +
        rows.map(r => '<tr><td>' + r.Subject + '</td><td>' + r['Class Score'] + '</td><td>' + r['Exam Score'] + '</td><td>' + r.Total + '</td><td>' + r.Grade + '</td></tr>').join('') +
        '</table></body></html>';
    if (window.OneRealFiles) OneRealFiles.download(filename.replace('.pdf', '.html'), html, 'text/html;charset=utf-8');
}
