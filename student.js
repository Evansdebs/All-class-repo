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
    // Pre-fill remembered student ID
    const savedId = sessionStorage.getItem('studentAuthId');
    if (savedId) {
        document.getElementById('studentLoginId').value = savedId;
        loadStudentDashboard(savedId);
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
    document.getElementById('studentDisplayTag').textContent = `Welcome, ${student.name.split(' ')[0]}`;

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
