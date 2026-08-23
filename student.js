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
    const container = document.getElementById('studentReportCardContainer');
    if (!container) return;

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

function buildUnifiedStudentReportHTML(student) {
    if (!student) return '';
    const settings = JSON.parse(localStorage.getItem('schoolSettings') || '{}');
    const schoolInfo = JSON.parse(localStorage.getItem('schoolInfo') || '{}');
    const school = settings.schoolName || schoolInfo.schoolName || 'The Living Spring School';
    const details = JSON.parse(localStorage.getItem('studentReportDetails') || '{}');
    const d = details[student.id] || details[String(student.id)] || {};
    const logoSrc = settings.schoolLogo || schoolInfo.schoolLogo || null;
    const yr = schoolInfo.academicYear || '';
    const tm = schoolInfo.term ? ('Term ' + schoolInfo.term) : '';

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
            <td style="padding:8px 10px;border:1px solid #cbd5e1;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;background:rgba(79,70,229,.1);color:#4338ca;">${g.grade}</span></td>
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
        const aggSubjects = allAgg.map(r => `${r.sub}: Grade ${r.grade}`).join(' | ');
        const coreLabel = useFallback ? 'Core' : `Core (${coreResults.length}/4)`;

        jhsAggregateHTML = `
        <div style="background:#1e1b4b;color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">JHS TOTAL AGGREGATE</div>
            <div style="font-size:22px;font-weight:800;letter-spacing:-1px;">${totalAgg}</div>
            <div style="font-size:11px;margin-top:4px;opacity:0.85;">${aggSubjects}</div>
            <div style="font-size:10.5px;margin-top:4px;opacity:0.65;">${coreLabel} + Best ${bestTwo.length} Elective(s)</div>
            ${allAgg.length < 6 ? '<div style="font-size:11px;margin-top:4px;color:#fbbf24;">⚠ Not all 6 aggregate subjects have scores</div>' : ''}
        </div>`;
    }

    const logoEl = logoSrc
        ? `<img src="${logoSrc}" style="width:70px;height:70px;object-fit:contain;border-radius:8px;" alt="Logo">`
        : `<div style="width:70px;height:70px;border:2px dashed #cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-align:center;">No Logo</div>`;

    const attText = (typeof Attendance !== 'undefined' && Attendance.label(student.id)) || d.attendance || '—';

    return `
    <div id="printableReportCard" style="background:#fff;color:#1e293b;padding:28px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.08);font-family:'Inter',sans-serif;max-width:800px;margin:0 auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #4f46e5;padding-bottom:14px;margin-bottom:18px;">
            ${logoEl}
            <div style="text-align:center;flex:1;padding:0 12px;">
                <h2 style="font-size:20px;font-weight:800;color:#1e1b4b;margin:0 0 4px 0;letter-spacing:-0.5px;">${school}</h2>
                <p style="font-size:12px;color:#64748b;margin:0 0 2px 0;">${settings.address || ''}</p>
                <p style="font-size:11.5px;color:#4f46e5;font-weight:600;margin:0 0 6px 0;"><em>&ldquo;${settings.motto || 'Drink deep or taste not the spring of knowledge'}&rdquo;</em></p>
                <div style="display:inline-block;background:#4f46e5;color:#fff;font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;letter-spacing:0.5px;">
                    END OF ${tm.toUpperCase() || 'TERM'} REPORT SHEET
                </div>
            </div>
            ${logoEl}
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

        ${jhsAggregateHTML}

        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;background:#eef2ff;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:12.5px;border:1px solid #c7d2fe;">
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">AVERAGE SCORE</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount ? avg.toFixed(1) + '%' : '—'}</strong></div>
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">OVERALL GRADE</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount ? overallGrade.grade + ' (' + overallGrade.remark + ')' : '—'}</strong></div>
            <div><span style="color:#4338ca;font-size:11px;display:block;font-weight:600;">RECORDED SUBJECTS</span><strong style="font-size:15px;color:#1e1b4b;">${scoredCount} / ${rows.length}</strong></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:12.5px;">
            <div style="background:#f8fafc;padding:10px 14px;border-radius:8px;border:1px solid #e2e8f0;">
                <div style="margin-bottom:6px;"><span style="color:#64748b;font-weight:600;">Attendance:</span> ${attText}</div>
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
    </div>`;
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
