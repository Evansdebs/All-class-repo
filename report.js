// Define subjects for Primary School (Corrected)
const subjects = [
    "English Language", 
    "Mathematics", 
    "Science", 
    "RME", 
    "History", 
    "Creative Arts",
    "Computing",
    "French", 
    "Asante Twi",
    "Career Technology"
];

// // Primary School Grading System - BASED ON TOTAL SCORE
// This is the default fallback. The active grading scale is loaded
// dynamically from Firebase / Admin Dashboard configuration.
const DEFAULT_GRADING_SYSTEM = [
    { min: 80, max: 100, grade: "A",  remark: "ADVANCE" },
    { min: 68, max: 79,  grade: "P",  remark: "PROFICIENCY" },
    { min: 54, max: 67,  grade: "AP", remark: "APPROACHING PROFICIENCY" },
    { min: 40, max: 53,  grade: "D",  remark: "DEVELOPING" },
    { min: 0,  max: 39,  grade: "B",  remark: "BEGINNER" }
];
// gradingSystem always reflects the latest active scale:
let gradingSystem = DEFAULT_GRADING_SYSTEM;
function refreshGradingSystem() {
    // Try to use the dynamic scale from firebase-config.js
    if (typeof getActiveGradingScale === 'function') {
        const scale = getActiveGradingScale();
        if (scale && scale.length) {
            gradingSystem = scale;
            return;
        }
    }
    // Fallback: read from localStorage (set by Admin Dashboard)
    const cached = localStorage.getItem('activeGradingScale');
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.length) { gradingSystem = parsed; return; }
        } catch (e) {}
    }
    gradingSystem = DEFAULT_GRADING_SYSTEM;
}

// Initialize data
let students = JSON.parse(localStorage.getItem('students')) || [];
let scores = JSON.parse(localStorage.getItem('scores')) || {};
let schoolInfo = JSON.parse(localStorage.getItem('schoolInfo')) || {
    academicYear: "2024/2025",
    term: "1",
    closingDate: "19th DEC, 2024",
    reopeningDate: "13th JAN, 2025",
    numberOnRoll: "18",
    numberOnRollMode: "manual",
    numberOnRollClass: "Class 6",
    numberOnRollByClass: {},
    basicLevel: "6",
    classTeacher: "",
    schoolLogo: null
};
let parentContacts = JSON.parse(localStorage.getItem('parentContacts')) || {};
let studentReportDetails = JSON.parse(localStorage.getItem('studentReportDetails')) || {};
let currentEditingStudentId = null; // tracks student being edited in the Edit Report modal


// DOM Elements
const splashScreen = document.getElementById('splash-screen');
const tapInBtn = document.getElementById('tapInBtn');
const app = document.getElementById('app');
const tabs = document.querySelectorAll('.tab');
const summaryDashboard = document.getElementById('summaryDashboard');
const tabContents = document.querySelectorAll('.tab-content');
const notificationArea = document.getElementById('notification-area');

// School Info Elements
const academicYearInput = document.getElementById('academicYear');
const termSelect = document.getElementById('term');
const closingDateInput = document.getElementById('closingDate');
const reopeningDateInput = document.getElementById('reopeningDate');
const numberOnRollInput = document.getElementById('numberOnRoll');
const numberOnRollModeSelect = document.getElementById('numberOnRollMode');
const numberOnRollClassSelect = document.getElementById('numberOnRollClass');
const basicLevelSelect = document.getElementById('basicLevel');
const classTeacherInput = document.getElementById('classTeacher');
const saveSchoolInfoBtn = document.getElementById('saveSchoolInfo');
const logoUpload = document.getElementById('logoUpload');
const logoPreview = document.getElementById('logoPreview');
const exportDataBtn = document.getElementById('exportData');
const exportCsvBtn = document.getElementById('exportCsv');
const importDataBtn = document.getElementById('importData');
const importFileInput = document.getElementById('importFile');
const clearDataBtn = document.getElementById('clearData');
const darkModeToggle = document.getElementById('darkModeToggle');

// Student Management Elements
const studentNameInput = document.getElementById('studentName');
const studentClassSelect = document.getElementById('studentClass');
const addStudentBtn = document.getElementById('addStudent');
const studentsList = document.getElementById('studentsList');
const studentSearchInput = document.getElementById('studentSearch');

// Score Entry Elements
const scoreClassSelect = document.getElementById('scoreClass');
const subjectsGrid = document.getElementById('subjectsGrid');
const scoreEntryCard = document.getElementById('scoreEntryCard');
const currentSubject = document.getElementById('currentSubject');
const scoreEntry = document.getElementById('scoreEntry');
const saveScoresBtn = document.getElementById('saveScores');
const cancelScoresBtn = document.getElementById('cancelScores');

// Individual Report Elements
const individualClassSelect = document.getElementById('individualClass');
const generateAllReportsBtn = document.getElementById('generateAllReports');
const applyPromotionToClassBtn = document.getElementById('applyPromotionToClass');
const bulkDownloadReportsBtn = document.getElementById('bulkDownloadReports');
const studentsReportsGrid = document.getElementById('studentsReportsGrid');
const individualReportContainer = document.getElementById('individualReportContainer');

// Performance Elements
const performanceClassSelect = document.getElementById('performanceClass');
const generatePerformanceBtn = document.getElementById('generatePerformance');
const performanceContainer = document.getElementById('performanceContainer');

// WhatsApp Integration Elements
const whatsappClassSelect = document.getElementById('whatsappClass');
const whatsappStudentSelect = document.getElementById('whatsappStudent');
const parentNameInput = document.getElementById('parentName');
const whatsappNumberInput = document.getElementById('whatsappNumber');
const saveParentInfoBtn = document.getElementById('saveParentInfo');
const sendWhatsAppBtn = document.getElementById('sendWhatsApp');
const bulkSendWhatsAppBtn = document.getElementById('bulkSendWhatsApp');
const parentsList = document.getElementById('parentsList');
const bulkSendStatus = document.getElementById('bulkSendStatus');

// Edit Modal Elements
const editStudentModal = document.getElementById('editStudentModal');
const editStudentModalTitle = document.getElementById('editStudentModalTitle');
const editStudentNameInput = document.getElementById('editStudentName');
const editStudentClassSelect = document.getElementById('editStudentClass');
const closeEditStudentModalBtn = document.getElementById('closeEditStudentModal');
const cancelEditStudentBtn = document.getElementById('cancelEditStudent');
const saveStudentEditBtn = document.getElementById('saveStudentEdit');
const editReportModal = document.getElementById('editReportModal');
const editModalTitle = document.getElementById('editModalTitle');
const editAttendanceInput = document.getElementById('editAttendance');
const editPromotionStatusSelect = document.getElementById('editPromotionStatus');
const editPromotionTargetSelect = document.getElementById('editPromotionTarget');
const editConductInput = document.getElementById('editConduct');
const editInterestInput = document.getElementById('editInterest');
const editTeacherRemarksInput = document.getElementById('editTeacherRemarks');
const closeEditModalBtn = document.getElementById('closeEditModal');
const cancelEditBtn = document.getElementById('cancelEdit');
const saveEditBtn = document.getElementById('saveEdit');

// Subject icons for Primary School
const subjectIcons = {
    "English Language": "fa-language",
    "Mathematics": "fa-calculator",
    "Science": "fa-flask",
    "RME": "fa-pray",
    "History": "fa-history",
    "Creative Arts": "fa-palette",
    "Computing": "fa-laptop-code",
    "French": "fa-flag",
    "Asante Twi": "fa-comments"
};

// Toggle dark mode feature
function initDarkMode() {
    if (localStorage.getItem('darkMode') === 'on') {
        document.body.classList.add('dark-mode');
    }
    updateDarkModeButton();
}

function updateDarkModeButton() {
    const isDark = document.body.classList.contains('dark-mode');
    darkModeToggle.innerHTML = isDark
        ? '<i class="fas fa-sun"></i> Light Mode'
        : '<i class="fas fa-moon"></i> Dark Mode';
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', isDark ? 'on' : 'off');
    updateDarkModeButton();
}

// Initialize the app
function init() {
    initDarkMode();

    const supportModal = document.getElementById('supportContactModal');
    const closeSupportModalBtn = document.getElementById('closeSupportModal');
    let supportModalTimer = null;

    const hideSupportModal = () => {
        if (supportModal) {
            supportModal.style.display = 'none';
            supportModal.classList.remove('show');
        }
        if (supportModalTimer) {
            clearTimeout(supportModalTimer);
            supportModalTimer = null;
        }
    };

    const showSupportModal = () => {
        if (!supportModal) return;
        supportModal.style.display = 'flex';
        supportModal.classList.add('show');
        supportModalTimer = setTimeout(hideSupportModal, 4000);
    };

    if (closeSupportModalBtn) {
        closeSupportModalBtn.addEventListener('click', hideSupportModal);
    }

    const enterApp = () => {
        splashScreen.style.display = 'none';
        app.style.display = 'block';
        showSupportModal();
    };

    if (tapInBtn) {
        tapInBtn.addEventListener('click', enterApp);
    }

    // Load school info
    loadSchoolInfo();
    
    // Initialize subjects grid
    renderSubjectsGrid();
    
    // Initialize students list
    renderStudentsList();
    renderSummaryDashboard();
    
    // Set up event listeners
    setupEventListeners();
}

// Set up event listeners
function setupEventListeners() {
    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // Save school info
    saveSchoolInfoBtn.addEventListener('click', saveSchoolInfo);
    numberOnRollModeSelect.addEventListener('change', updateNumberOnRollField);
    numberOnRollClassSelect.addEventListener('change', updateNumberOnRollField);

    // Logo upload
    logoUpload.addEventListener('change', handleLogoUpload);

    // Class selectors
    scoreClassSelect.addEventListener('change', renderSubjectsGrid);
    individualClassSelect.addEventListener('change', () => {
        studentsReportsGrid.style.display = 'none';
        bulkDownloadReportsBtn.style.display = 'none';
    });
    performanceClassSelect.addEventListener('change', () => {
        performanceContainer.innerHTML = '';
    });
    whatsappClassSelect.addEventListener('change', () => {
        updateWhatsappStudentSelect();
        renderParentsList();
    });

    // WhatsApp student select change
    whatsappStudentSelect.addEventListener('change', loadParentInfo);

    // Add student
    addStudentBtn.addEventListener('click', addStudent);

    // Student search
    studentSearchInput.addEventListener('input', renderStudentsList);

    // Save scores
    saveScoresBtn.addEventListener('click', saveScores);
    cancelScoresBtn.addEventListener('click', cancelScoreEntry);

    // Generate all reports
    generateAllReportsBtn.addEventListener('click', generateAllClassReports);
    applyPromotionToClassBtn.addEventListener('click', applyPromotionToClass);
    
    // Bulk download reports
    bulkDownloadReportsBtn.addEventListener('click', bulkDownloadAllReports);

    // Generate performance analysis
    generatePerformanceBtn.addEventListener('click', generatePerformanceAnalysis);

    // WhatsApp integration
    saveParentInfoBtn.addEventListener('click', saveParentInfo);
    sendWhatsAppBtn.addEventListener('click', sendWhatsAppReport);
    bulkSendWhatsAppBtn.addEventListener('click', bulkSendWhatsAppReports);

    // Data export/import
    exportDataBtn.addEventListener('click', exportAllData);
    exportCsvBtn.addEventListener('click', exportAllDataCsv);
    importDataBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', importData);
    clearDataBtn.addEventListener('click', clearData);
    darkModeToggle.addEventListener('click', toggleDarkMode);
    
    // Firebase Controls
    const openFirebaseConfigBtn = document.getElementById('openFirebaseConfigBtn');
    const closeFirebaseConfigModal = document.getElementById('closeFirebaseConfigModal');
    const cancelFirebaseConfig = document.getElementById('cancelFirebaseConfig');
    const saveFirebaseConfigBtn = document.getElementById('saveFirebaseConfigBtn');
    const openAuthModalBtn = document.getElementById('openAuthModalBtn');
    const closeAuthModal = document.getElementById('closeAuthModal');
    const toggleAuthModeBtn = document.getElementById('toggleAuthModeBtn');
    const submitAuthBtn = document.getElementById('submitAuthBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const signatureUpload = document.getElementById('signatureUpload');

    if (openFirebaseConfigBtn) openFirebaseConfigBtn.addEventListener('click', openFirebaseConfigModal);
    if (closeFirebaseConfigModal) closeFirebaseConfigModal.addEventListener('click', () => document.getElementById('firebaseConfigModal').style.display = 'none');
    if (cancelFirebaseConfig) cancelFirebaseConfig.addEventListener('click', () => document.getElementById('firebaseConfigModal').style.display = 'none');
    if (saveFirebaseConfigBtn) saveFirebaseConfigBtn.addEventListener('click', handleSaveFirebaseConfig);
    
    if (openAuthModalBtn) openAuthModalBtn.addEventListener('click', openAuthModal);
    if (closeAuthModal) closeAuthModal.addEventListener('click', () => document.getElementById('authModal').style.display = 'none');
    if (toggleAuthModeBtn) toggleAuthModeBtn.addEventListener('click', toggleAuthMode);
    if (submitAuthBtn) submitAuthBtn.addEventListener('click', handleAuthSubmit);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    if (signatureUpload) signatureUpload.addEventListener('change', handleSignatureUpload);

    // Broadsheet controls
    const broadsheetClassSelect = document.getElementById('broadsheetClass');
    const exportBroadsheetCsvBtn = document.getElementById('exportBroadsheetCsv');
    const exportBroadsheetExcelBtn = document.getElementById('exportBroadsheetExcel');
    const printBroadsheetBtn = document.getElementById('printBroadsheetBtn');

    if (broadsheetClassSelect) broadsheetClassSelect.addEventListener('change', renderBroadsheet);
    if (exportBroadsheetCsvBtn) exportBroadsheetCsvBtn.addEventListener('click', exportBroadsheetCsv);
    if (exportBroadsheetExcelBtn) exportBroadsheetExcelBtn.addEventListener('click', exportBroadsheetExcel);
    if (printBroadsheetBtn) printBroadsheetBtn.addEventListener('click', window.print);

    // Excel Marks Upload
    const excelMarksFileInput = document.getElementById('excelMarksFile');
    const downloadExcelTemplateBtn = document.getElementById('downloadExcelTemplateBtn');
    if (excelMarksFileInput) excelMarksFileInput.addEventListener('change', handleExcelMarksUpload);
    if (downloadExcelTemplateBtn) downloadExcelTemplateBtn.addEventListener('click', downloadExcelTemplate);

    // Smart Remarks & Award Certificates
    const generateSmartRemarksBtn = document.getElementById('generateSmartRemarksBtn');
    const generateAwardCertificatesBtn = document.getElementById('generateAwardCertificatesBtn');
    const closeCertificateModal = document.getElementById('closeCertificateModal');
    const printCertificatesBtn = document.getElementById('printCertificatesBtn');

    if (generateSmartRemarksBtn) generateSmartRemarksBtn.addEventListener('click', applySmartRemarksToModal);
    if (generateAwardCertificatesBtn) generateAwardCertificatesBtn.addEventListener('click', renderAwardCertificates);
    if (closeCertificateModal) closeCertificateModal.addEventListener('click', () => document.getElementById('certificateModal').style.display = 'none');
    if (printCertificatesBtn) printCertificatesBtn.addEventListener('click', window.print);

    // Super Admin Dashboard Controls
    const refreshAdminDataBtn = document.getElementById('refreshAdminDataBtn');
    const clearAuditTrailBtn = document.getElementById('clearAuditTrailBtn');
    const adminClassFilter = document.getElementById('adminClassFilter');
    const adminStudentSearch = document.getElementById('adminStudentSearch');

    if (refreshAdminDataBtn) refreshAdminDataBtn.addEventListener('click', renderSuperAdminDashboard);
    if (clearAuditTrailBtn) clearAuditTrailBtn.addEventListener('click', () => {
        localStorage.removeItem('auditLogs');
        renderSuperAdminDashboard();
        showNotification('Cleared local audit logs.', 'info');
    });
    if (adminClassFilter) adminClassFilter.addEventListener('change', renderAdminMasterStudentsGrid);
    if (adminStudentSearch) adminStudentSearch.addEventListener('input', renderAdminMasterStudentsGrid);

    // Student edit modal
    closeEditStudentModalBtn.addEventListener('click', closeEditStudentModal);
    cancelEditStudentBtn.addEventListener('click', closeEditStudentModal);
    saveStudentEditBtn.addEventListener('click', saveStudentEdit);

    // Edit modal (Save/Cancel also wired via inline onclick in HTML for reliability)
    closeEditModalBtn.addEventListener('click', closeEditModal);
    editPromotionStatusSelect.addEventListener('change', autoFillPromotionTarget);
    
    // Handle custom dropdown options in edit modal
    [editConductInput, editInterestInput, editTeacherRemarksInput].forEach(select => {
        select.addEventListener('change', function() {
            if (this.value === 'Custom...') {
                const customValue = prompt('Enter custom value:');
                if (customValue) {
                    this.innerHTML += `<option value="${customValue}">${customValue}</option>`;
                    this.value = customValue;
                } else {
                    this.value = '';
                }
            }
        });
    });
    
    // Close modal when clicking outside
    editReportModal.addEventListener('click', (e) => {
        if (e.target === editReportModal) {
            closeEditModal();
        }
    });
}

// Show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notificationArea.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notificationArea.removeChild(notification);
        }, 300);
    }, 3000);
}

// Handle logo upload
function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const logoData = e.target.result;
            schoolInfo.schoolLogo = logoData;
            
            // Update preview
            logoPreview.innerHTML = `<img src="${logoData}" alt="school logo">`;
            
            // Save to localStorage
            localStorage.setItem('schoolInfo', JSON.stringify(schoolInfo));
            showNotification('School logo uploaded successfully!', 'success');
        };
        reader.readAsDataURL(file);
    }
}

function renderSummaryDashboard() {
    if (!summaryDashboard) return;

    const totalStudents = students.length;
    const classes = [...new Set(students.map(student => student.class).filter(Boolean))];
    const subjectCount = Object.keys(scores).length;
    const scoreEntries = Object.values(scores).flatMap(subjectScores =>
        Object.values(subjectScores).filter(entry => entry && typeof entry === 'object' && entry.totalScore !== '')
    );
    const averageScore = scoreEntries.length
        ? (scoreEntries.reduce((sum, entry) => sum + Number(entry.totalScore), 0) / scoreEntries.length).toFixed(1)
        : '0.0';

    const subjectAverages = subjects
        .map(subject => {
            const entries = Object.values(scores[subject] || {}).filter(entry => entry && entry.totalScore !== '');
            const average = entries.length
                ? entries.reduce((sum, entry) => sum + Number(entry.totalScore), 0) / entries.length
                : 0;
            return { subject, average };
        })
        .filter(item => item.average > 0);

    const studentAverages = students.map(student => {
        const studentScores = Object.values(scores).flatMap(subjectScores => {
            const entry = subjectScores[student.id];
            return entry && entry.totalScore !== '' ? [Number(entry.totalScore)] : [];
        });
        const average = studentScores.length
            ? studentScores.reduce((sum, score) => sum + score, 0) / studentScores.length
            : 0;
        return { name: student.name, average };
    }).sort((a, b) => b.average - a.average);

    const topPerformer = studentAverages[0]?.average > 0 ? studentAverages[0].name : '--';

    summaryDashboard.innerHTML = `
        <div class="summary-header">
            <h2><i class="fas fa-chart-line"></i> Summary Dashboard</h2>
            <span class="summary-pill">Live overview</span>
        </div>
        <div class="summary-grid">
            <div class="summary-card">
                <i class="fas fa-user-graduate"></i>
                <div class="summary-value">${totalStudents}</div>
                <div class="summary-label">Students Added</div>
            </div>
            <div class="summary-card">
                <i class="fas fa-school"></i>
                <div class="summary-value">${classes.length}</div>
                <div class="summary-label">Classes</div>
            </div>
            <div class="summary-card">
                <i class="fas fa-book-open"></i>
                <div class="summary-value">${subjectCount}</div>
                <div class="summary-label">Subjects with Scores</div>
            </div>
            <div class="summary-card">
                <i class="fas fa-trophy"></i>
                <div class="summary-value">${topPerformer}</div>
                <div class="summary-label">Top Performer</div>
            </div>
        </div>
        <div class="summary-grid" style="margin-top: 12px;">
            <div class="summary-card">
                <div class="summary-value">${averageScore}</div>
                <div class="summary-label">Average Score</div>
            </div>
        </div>
        <div class="summary-chart-wrap">
            <canvas id="subjectAverageChart"></canvas>
        </div>
    `;

    if (typeof Chart !== 'undefined' && subjectAverages.length) {
        const ctx = document.getElementById('subjectAverageChart');
        if (ctx) {
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: subjectAverages.map(item => item.subject),
                    datasets: [{
                        label: 'Average Score',
                        data: subjectAverages.map(item => item.average),
                        backgroundColor: ['#4361ee', '#3a0ca3', '#4cc9f0', '#4bb543', '#ffcc00', '#dc3545', '#8b5cf6', '#0ea5e9', '#f97316'],
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: { color: '#6b7280' }
                        },
                        x: {
                            ticks: { color: '#6b7280' }
                        }
                    },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        }
    }
}

// Switch tabs
function switchTab(tabId) {
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('data-tab') === tabId) {
            tab.classList.add('active');
        }
    });

    tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) {
            content.classList.add('active');
        }
    });

    // Update WhatsApp student select when switching to WhatsApp tab
    if (tabId === 'whatsapp') {
        updateWhatsappStudentSelect();
        renderParentsList();
    }

    if (tabId === 'super-admin') {
        renderSuperAdminDashboard();
    }
}

function getStudentCountForClass(className) {
    return students.filter(student => student.class === className).length;
}

function getNumberOnRollForClass(className) {
    const classRoll = schoolInfo.numberOnRollByClass?.[className];
    if (classRoll !== undefined && classRoll !== null && classRoll !== '') {
        return classRoll;
    }
    if (schoolInfo.numberOnRoll !== undefined && schoolInfo.numberOnRoll !== null && schoolInfo.numberOnRoll !== '') {
        return schoolInfo.numberOnRoll;
    }
    return '';
}

function updateNumberOnRollField() {
    const selectedClass = numberOnRollClassSelect.value || 'Class 6';
    const mode = numberOnRollModeSelect.value || 'manual';

    if (mode === 'auto') {
        numberOnRollInput.value = getStudentCountForClass(selectedClass);
    } else {
        numberOnRollInput.value = getNumberOnRollForClass(selectedClass);
    }
}

// Load school information
function loadSchoolInfo() {
    academicYearInput.value = schoolInfo.academicYear || "2024/2025";
    termSelect.value = schoolInfo.term || "1";
    closingDateInput.value = schoolInfo.closingDate || "";
    reopeningDateInput.value = schoolInfo.reopeningDate || "";
    numberOnRollModeSelect.value = schoolInfo.numberOnRollMode || 'manual';
    numberOnRollClassSelect.value = schoolInfo.numberOnRollClass || 'Class 6';
    basicLevelSelect.value = schoolInfo.basicLevel || '6';
    classTeacherInput.value = schoolInfo.classTeacher || '';
    
    const headTeacherInput = document.getElementById('headTeacher');
    const gradingSchemeSelect = document.getElementById('gradingSchemeSelect');
    if (headTeacherInput) headTeacherInput.value = schoolInfo.headTeacher || '';
    if (gradingSchemeSelect) gradingSchemeSelect.value = schoolInfo.gradingScheme || 'primary';

    updateNumberOnRollField();

    // Load logo
    if (schoolInfo.schoolLogo) {
        logoPreview.innerHTML = `<img src="${schoolInfo.schoolLogo}" alt="school logo">`;
    }
    // Load signature
    const signaturePreview = document.getElementById('signaturePreview');
    if (signaturePreview && schoolInfo.digitalSignature) {
        signaturePreview.innerHTML = `<img src="${schoolInfo.digitalSignature}" alt="headteacher signature">`;
    }
}

// Save school information
function saveSchoolInfo() {
    const selectedClass = numberOnRollClassSelect.value || 'Class 6';
    const mode = numberOnRollModeSelect.value || 'manual';
    const rollValue = mode === 'auto'
        ? String(getStudentCountForClass(selectedClass))
        : String(numberOnRollInput.value || '');

    const numberOnRollByClass = {
        ...(schoolInfo.numberOnRollByClass || {})
    };
    numberOnRollByClass[selectedClass] = rollValue;

    const headTeacherInput = document.getElementById('headTeacher');
    const gradingSchemeSelect = document.getElementById('gradingSchemeSelect');

    schoolInfo = {
        academicYear: academicYearInput.value,
        term: termSelect.value,
        closingDate: closingDateInput.value,
        reopeningDate: reopeningDateInput.value,
        numberOnRoll: rollValue,
        numberOnRollMode: mode,
        numberOnRollClass: selectedClass,
        numberOnRollByClass: numberOnRollByClass,
        basicLevel: basicLevelSelect.value,
        classTeacher: classTeacherInput.value.trim(),
        headTeacher: headTeacherInput ? headTeacherInput.value.trim() : '',
        gradingScheme: gradingSchemeSelect ? gradingSchemeSelect.value : 'primary',
        schoolLogo: schoolInfo.schoolLogo,
        digitalSignature: schoolInfo.digitalSignature
    };
    
    localStorage.setItem('schoolInfo', JSON.stringify(schoolInfo));
    if (typeof syncSaveCollection === 'function') syncSaveCollection('schoolInfo', schoolInfo);
    renderSummaryDashboard();
    showNotification('School information saved successfully!', 'success');
}

// Add student
function addStudent() {
    const name = studentNameInput.value.trim();
    const studentClass = studentClassSelect.value;
    
    if (!name) {
        showNotification('Please enter a student name', 'error');
        return;
    }

    const student = {
        id: Date.now(),
        name: name,
        class: studentClass
    };

    students.push(student);
    saveStudents();
    renderStudentsList();
    renderSummaryDashboard();
    updateNumberOnRollField();
    studentNameInput.value = '';
    studentNameInput.focus();
    showNotification('Student added successfully!', 'success');
}

// Open student edit modal
function editStudent(id) {
    const student = students.find(s => s.id === id);
    if (!student) return;

    currentEditingStudentId = student.id;
    editStudentModalTitle.textContent = `Edit Student - ${student.name}`;
    editStudentNameInput.value = student.name;
    editStudentClassSelect.value = student.class;
    editStudentModal.style.display = 'flex';
    editStudentNameInput.focus();
}

function closeEditStudentModal() {
    editStudentModal.style.display = 'none';
    currentEditingStudentId = null;
}

function saveStudentEdit() {
    if (!currentEditingStudentId) {
        showNotification('No student selected for editing.', 'error');
        return;
    }

    const student = students.find(s => s.id === currentEditingStudentId);
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    const newName = editStudentNameInput.value.trim();
    const newClass = editStudentClassSelect.value;

    if (!newName) {
        showNotification('Please enter a student name.', 'error');
        return;
    }

    student.name = newName;
    student.class = newClass;
    saveStudents();
    renderStudentsList();
    renderSummaryDashboard();
    closeEditStudentModal();
    showNotification('Student updated successfully!', 'success');
}

// Delete student
function deleteStudent(id) {
    if (confirm('Are you sure you want to delete this student? This will also delete all their scores, parent contacts, and report details.')) {
        students = students.filter(student => student.id !== id);
        
        // Remove student scores from all subjects
        Object.keys(scores).forEach(subject => {
            if (scores[subject][id]) {
                delete scores[subject][id];
            }
        });
        
        // Remove parent contacts
        if (parentContacts[id]) {
            delete parentContacts[id];
            saveParentContacts();
        }
        
        // Remove report details
        if (studentReportDetails[id]) {
            delete studentReportDetails[id];
            saveReportDetailsToStorage();
        }
        
        saveStudents();
        saveScoresToStorage();
        renderStudentsList();
        renderSummaryDashboard();
        updateNumberOnRollField();
        renderParentsList();
        showNotification('Student deleted successfully!', 'success');
    }
}

// Save students to localStorage and Firebase
function saveStudents() {
    localStorage.setItem('students', JSON.stringify(students));
    if (typeof syncSaveCollection === 'function') syncSaveCollection('students', students);
}

// Save scores to localStorage and Firebase
function saveScoresToStorage() {
    localStorage.setItem('scores', JSON.stringify(scores));
    if (typeof syncSaveCollection === 'function') syncSaveCollection('scores', scores);
}

// Save parent contacts to localStorage and Firebase
function saveParentContacts() {
    localStorage.setItem('parentContacts', JSON.stringify(parentContacts));
    if (typeof syncSaveCollection === 'function') syncSaveCollection('parentContacts', parentContacts);
}

// Save report details to localStorage and Firebase
function saveReportDetailsToStorage() {
    localStorage.setItem('studentReportDetails', JSON.stringify(studentReportDetails));
    if (typeof syncSaveCollection === 'function') syncSaveCollection('studentReportDetails', studentReportDetails);
}

// Render students list
function renderStudentsList() {
    studentsList.innerHTML = '';
    
    const searchTerm = studentSearchInput.value.toLowerCase();
    let filteredStudents = students;
    
    if (searchTerm) {
        filteredStudents = students.filter(student => 
            student.name.toLowerCase().includes(searchTerm)
        );
    }
    
    if (filteredStudents.length === 0) {
        studentsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-user-graduate"></i>
                <p>${searchTerm ? 'No students found matching your search' : 'No students added yet'}</p>
            </div>
        `;
        return;
    }

    renderSummaryDashboard();

    filteredStudents.forEach(student => {
        const studentItem = document.createElement('div');
        studentItem.className = 'student-item';
        studentItem.innerHTML = `
            <div>
                <div class="student-name">${student.name}</div>
                <div class="student-class">${student.class}</div>
            </div>
            <div class="student-actions">
                <button class="btn btn-warning edit-student-btn" type="button">Edit</button>
                <button class="btn btn-danger delete-student-btn" type="button">Delete</button>
            </div>
        `;

        const editButton = studentItem.querySelector('.edit-student-btn');
        const deleteButton = studentItem.querySelector('.delete-student-btn');
        editButton.addEventListener('click', () => editStudent(student.id));
        deleteButton.addEventListener('click', () => deleteStudent(student.id));

        studentsList.appendChild(studentItem);
    });
}

// Update WhatsApp student select dropdown
function updateWhatsappStudentSelect() {
    const selectedClass = whatsappClassSelect.value;
    whatsappStudentSelect.innerHTML = '<option value="">-- Select a student --</option>';
    
    if (selectedClass) {
        const classStudents = students.filter(student => student.class === selectedClass);
        classStudents.forEach(student => {
            const option = document.createElement('option');
            option.value = student.id;
            option.textContent = student.name;
            whatsappStudentSelect.appendChild(option);
        });
    }
}

// Load parent information for selected student
function loadParentInfo() {
    const studentId = parseInt(whatsappStudentSelect.value);
    if (!studentId) {
        parentNameInput.value = '';
        whatsappNumberInput.value = '';
        return;
    }

    const parentInfo = parentContacts[studentId];
    if (parentInfo) {
        parentNameInput.value = parentInfo.name || '';
        whatsappNumberInput.value = parentInfo.phone || '';
    } else {
        parentNameInput.value = '';
        whatsappNumberInput.value = '';
    }
}

// Save parent information
function saveParentInfo() {
    const studentId = parseInt(whatsappStudentSelect.value);
    if (!studentId) {
        showNotification('Please select a student first.', 'error');
        return;
    }

    const parentName = parentNameInput.value.trim();
    const whatsappNumber = whatsappNumberInput.value.trim();

    if (!parentName) {
        showNotification('Please enter parent/guardian name.', 'error');
        return;
    }

    if (!whatsappNumber) {
        showNotification('Please enter WhatsApp number.', 'error');
        return;
    }

    // Basic phone number validation
    if (!whatsappNumber.startsWith('+')) {
        showNotification('Please include country code (e.g., +233XXXXXXXXX).', 'error');
        return;
    }

    parentContacts[studentId] = {
        name: parentName,
        phone: whatsappNumber,
        sent: false
    };

    saveParentContacts();
    renderParentsList();
    showNotification('Parent information saved successfully!', 'success');
}

// Render parents list
function renderParentsList() {
    parentsList.innerHTML = '';
    
    const selectedClass = whatsappClassSelect.value;
    if (!selectedClass) {
        parentsList.innerHTML = '<p>Please select a class first.</p>';
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        parentsList.innerHTML = '<p>No students found in this class.</p>';
        return;
    }

    let hasParents = false;
    classStudents.forEach(student => {
        const parentInfo = parentContacts[student.id];
        if (parentInfo) {
            hasParents = true;
            const parentItem = document.createElement('div');
            parentItem.className = 'parent-item';
            parentItem.innerHTML = `
                <div class="parent-info">
                    <div class="parent-name">${student.name}</div>
                    <div class="parent-phone">Parent: ${parentInfo.name} | ${parentInfo.phone}</div>
                </div>
                <div class="whatsapp-actions">
                    <span class="whatsapp-status ${parentInfo.sent ? 'status-sent' : 'status-pending'}">
                        ${parentInfo.sent ? '✓ Sent' : 'Pending'}
                    </span>
                    <button class="btn btn-whatsapp btn-send-individual" data-student-id="${student.id}">
                        <i class="fab fa-whatsapp"></i> Send
                    </button>
                </div>
            `;
            parentsList.appendChild(parentItem);
        }
    });

    if (!hasParents) {
        parentsList.innerHTML = '<p>No parent information saved for this class yet.</p>';
    } else {
        // Add event listeners to individual send buttons
        document.querySelectorAll('.btn-send-individual').forEach(button => {
            button.addEventListener('click', function() {
                const studentId = parseInt(this.getAttribute('data-student-id'));
                sendIndividualWhatsAppReport(studentId);
            });
        });
    }
}

// Render subjects grid
function renderSubjectsGrid() {
    subjectsGrid.innerHTML = '';
    
    const selectedClass = scoreClassSelect.value;
    if (!selectedClass) {
        subjectsGrid.innerHTML = '<p>Please select a class first</p>';
        return;
    }
    
    subjects.forEach(subject => {
        const subjectCard = document.createElement('div');
        subjectCard.className = 'subject-card';
        subjectCard.setAttribute('data-subject', subject);
        subjectCard.innerHTML = `
            <i class="fas ${subjectIcons[subject]}"></i>
            <h3>${subject}</h3>
            <p>Click to enter scores</p>
        `;
        subjectCard.addEventListener('click', () => openScoreEntry(subject));
        subjectsGrid.appendChild(subjectCard);
    });
}

// Calculate 50% of a score
function calculateFiftyPercent(score) {
    return Math.round((score / 100) * 50 * 10) / 10;
}

// Calculate total score from class score and exam score
function calculateTotalScore(classScore, examScore) {
    const classScore50 = calculateFiftyPercent(classScore);
    const examScore50 = calculateFiftyPercent(examScore);
    return Math.round((classScore50 + examScore50) * 10) / 10;
}

/// Get grade for a score - BASED ON TOTAL SCORE (Dynamic grading scale & custom class scheme)
function getGrade(totalScore, classIdOrName) {
    // Ensure totalScore is between 0-100
    if (totalScore < 0) totalScore = 0;
    if (totalScore > 100) totalScore = 100;

    const targetClass = classIdOrName || (typeof currentClass !== 'undefined' ? currentClass : null);

    if (typeof getGradingScaleForClass === 'function' && targetClass) {
        const clsScale = getGradingScaleForClass(targetClass);
        if (clsScale && Array.isArray(clsScale) && clsScale.length > 0) {
            for (const grade of clsScale) {
                if (totalScore >= grade.min && totalScore <= grade.max) {
                    return grade;
                }
            }
            return clsScale[clsScale.length - 1];
        }
    }

    // Prefer firebase-config.js dynamic lookup if available
    if (typeof getGradeForScore === 'function') {
        return getGradeForScore(totalScore, targetClass);
    }

    // Use the local gradingSystem (default or cached active scale)
    refreshGradingSystem();
    for (const grade of gradingSystem) {
        if (totalScore >= grade.min && totalScore <= grade.max) {
            return grade;
        }
    }
    // Return lowest grade if no match (shouldn't happen with 0-39 range)
    return gradingSystem[gradingSystem.length - 1];
}

// ──────────────────────────────────────────────────────────────────────────────
// TEACHER AUTH HELPERS
// ──────────────────────────────────────────────────────────────────────────────

function hideTeacherOverlay() {
    const overlay = document.getElementById('teacherAuthOverlay');
    if (overlay) overlay.style.display = 'none';
    // Hide splash screen and go straight to the working app
    const splash = document.getElementById('splash-screen');
    if (splash) splash.style.display = 'none';
    const app = document.getElementById('app');
    if (app) app.style.display = 'block';
}

function showTeacherOverlay() {
    const overlay = document.getElementById('teacherAuthOverlay');
    if (overlay) overlay.style.display = 'flex';
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    const splash = document.getElementById('splash-screen');
    if (splash) splash.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────────────────────
// GLOBAL PASSWORD VISIBILITY TOGGLE
// ──────────────────────────────────────────────────────────────────────────────
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

function updateTeacherHeaderUI(userProfile) {
    const userDisplay = document.getElementById('currentUserDisplay');
    if (!userProfile) {
        if (userDisplay) userDisplay.style.display = 'none';
        return;
    }
    if (userDisplay) {
        const name = userProfile.displayName || userProfile.name || userProfile.email || 'Teacher';
        userDisplay.textContent = String.fromCodePoint(0x1F464) + ' ' + name;
        userDisplay.style.display = 'inline-block';
    }
}

// Sign out: clears session and re-locks the portal to the login screen
function handleTeacherSignOut() {
    sessionStorage.removeItem('teacherUnlocked');
    sessionStorage.removeItem('teacherEmail');
    if (typeof logoutFirebaseUser === 'function') {
        logoutFirebaseUser().catch(() => {});
    }
    const userDisplay = document.getElementById('currentUserDisplay');
    if (userDisplay) userDisplay.style.display = 'none';
    showTeacherOverlay();
    // Clear login form for next login
    const emailEl = document.getElementById('teacherLoginEmail');
    const passEl  = document.getElementById('teacherLoginPassword');
    const errEl   = document.getElementById('teacherAuthError');
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';
    if (errEl)   errEl.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────────────────────
// SCORE SUBMISSION WORKFLOW
// Allows teachers to submit scores for admin/headteacher approval
// ──────────────────────────────────────────────────────────────────────────────

async function submitScoresForApproval(className) {
    if (!className) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(s => s.class === className);
    if (!classStudents.length) {
        showNotification('No students in this class.', 'error');
        return;
    }

    // Build result documents from current scores
    const activeYear = JSON.parse(localStorage.getItem('activeAcademicYear') || 'null');
    const activeTerm = JSON.parse(localStorage.getItem('activeTerm')         || 'null');
    const resultIds  = [];

    for (const subject of gradingSystem.length ? Object.keys(scores) : []) {
        for (const student of approvedStudents) {
            const entry = scores[subject]?.[student.id];
            if (!entry || entry.totalScore === '') continue;

            const resultData = {
                studentId:      student.id,
                studentName:    student.name,
                classId:        className,
                subjectId:      subject,
                academicYearId: activeYear?.id   || schoolInfo.academicYear || '',
                termId:         activeTerm?.id   || schoolInfo.term         || '',
                classScore:     parseFloat(entry.classScore) || 0,
                examScore:      parseFloat(entry.examScore)  || 0,
                totalScore:     parseFloat(entry.totalScore) || 0,
                grade:          entry.grade  || '',
                remark:         entry.remark || '',
                status:         'Draft',
                locked:         false,
            };

            if (typeof saveResult === 'function') {
                const saved = await saveResult(resultData);
                if (saved?.id) resultIds.push(saved.id);
            }
        }
    }

    if (!resultIds.length) {
        showNotification('No scores found to submit for this class.', 'warning');
        return;
    }

    if (typeof submitResultsForApproval === 'function') {
        await submitResultsForApproval(resultIds);
    }

    showNotification(`✅ ${resultIds.length} score(s) submitted for approval!`, 'success');
    if (typeof logActivity === 'function') {
        await logActivity('Scores Submitted', `${resultIds.length} scores for class ${className} submitted for approval`);
    }
}

// Open score entry for a subject
function openScoreEntry(subject) {
    const selectedClass = scoreClassSelect.value;
    if (!selectedClass) {
        showNotification('Please select a class first', 'error');
        return;
    }

    if (students.length === 0) {
        showNotification('Please add students first', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification(`No students found in ${selectedClass}`, 'error');
        return;
    }

    currentSubject.textContent = subject;
    scoreEntry.innerHTML = '';
    
    // Add header row
    const headerRow = document.createElement('div');
    headerRow.className = 'score-header';
    headerRow.innerHTML = `
        <div>Student Name</div>
        <div>Class Score (50%)</div>
        <div>Exam Score (50%)</div>
        <div>Total Score</div>
        <div>Grade</div>
    `;
    scoreEntry.appendChild(headerRow);
    
    classStudents.forEach(student => {
        const scoreRow = document.createElement('div');
        scoreRow.className = 'score-row';
        
        // Get existing scores if available
        const studentScores = scores[subject] && scores[subject][student.id] ? scores[subject][student.id] : { classScore: '', examScore: '' };
        const classScore = studentScores.classScore || '';
        const examScore = studentScores.examScore || '';
        const isLocked = studentScores.locked || studentScores.status === 'Approved' || studentScores.status === 'Published';
        
        let totalScore = '';
        let grade = '';
        
        // Calculate total and grade if both scores are available
        if (classScore !== '' && examScore !== '') {
            totalScore = calculateTotalScore(parseFloat(classScore), parseFloat(examScore));
            const gradeInfo = getGrade(totalScore);
            grade = gradeInfo.grade;
        }
        
        scoreRow.innerHTML = `
            <div class="student-name">
                ${student.name}
                ${isLocked ? '<span style="color:#dc2626;font-size:11px;margin-left:6px;"><i class="fas fa-lock"></i> Approved/Locked</span>' : ''}
            </div>
            <div>
                <input type="number" class="score-input class-score" min="0" max="100" 
                       value="${classScore}" 
                       data-student-id="${student.id}" 
                       placeholder="0-100" step="0.1" ${isLocked ? 'disabled title="Locked by Administrator"' : ''}>
            </div>
            <div>
                <input type="number" class="score-input exam-score" min="0" max="100" 
                       value="${examScore}" 
                       data-student-id="${student.id}" 
                       placeholder="0-100" step="0.1" ${isLocked ? 'disabled title="Locked by Administrator"' : ''}>
            </div>
            <div class="total-score-display">${totalScore !== '' ? totalScore : ''}</div>
            <div class="grade-display">${grade}</div>
            <div class="score-actions">
                <button class="btn btn-small btn-warning" type="button" data-action="reset" data-student-id="${student.id}">Reset</button>
                <button class="btn btn-small btn-danger" type="button" data-action="delete" data-student-id="${student.id}">Delete</button>
            </div>
        `;
        scoreEntry.appendChild(scoreRow);
        
        // Add event listeners for real-time calculation
        const classScoreInput = scoreRow.querySelector('.class-score');
        const examScoreInput = scoreRow.querySelector('.exam-score');
        const resetButton = scoreRow.querySelector('[data-action="reset"]');
        const deleteButton = scoreRow.querySelector('[data-action="delete"]');
        
        resetButton.addEventListener('click', () => {
            classScoreInput.value = '';
            examScoreInput.value = '';
            scoreRow.querySelector('.total-score-display').textContent = '';
            scoreRow.querySelector('.grade-display').textContent = '';
            scoreRow.querySelector('.grade-display').className = 'grade-display';
        });

        deleteButton.addEventListener('click', () => {
            if (!scores[subject] || !scores[subject][student.id]) {
                showNotification('No saved score entry found for this student.', 'warning');
                return;
            }

            delete scores[subject][student.id];
            if (Object.keys(scores[subject]).length === 0) {
                delete scores[subject];
            }
            saveScoresToStorage();
            renderSummaryDashboard();
            openScoreEntry(subject);
            showNotification('Score entry deleted.', 'success');
        });
        
        const updateCalculations = () => {
            const classScoreVal = classScoreInput.value;
            const examScoreVal = examScoreInput.value;
            
            let total = '';
            let gradeText = '';
            
            if (classScoreVal !== '' && examScoreVal !== '') {
                total = calculateTotalScore(parseFloat(classScoreVal), parseFloat(examScoreVal));
                const gradeInfo = getGrade(total);
                gradeText = gradeInfo.grade;
                
                scoreRow.querySelector('.grade-display').className = `grade-display grade-${gradeInfo.grade}`;
            } else {
                scoreRow.querySelector('.grade-display').className = 'grade-display';
            }
            
            scoreRow.querySelector('.total-score-display').textContent = total !== '' ? total : '';
            scoreRow.querySelector('.grade-display').textContent = gradeText;
        };
        
        classScoreInput.addEventListener('input', updateCalculations);
        examScoreInput.addEventListener('input', updateCalculations);
    });

    scoreEntryCard.style.display = 'block';
    scoreEntryCard.scrollIntoView({ behavior: 'smooth' });
}

// Save scores for a subject - FIXED VERSION
function saveScores() {
    const subject = currentSubject.textContent;
    const classScoreInputs = document.querySelectorAll('.class-score');
    const examScoreInputs = document.querySelectorAll('.exam-score');
    
    if (!scores[subject]) {
        scores[subject] = {};
    }
    
    let hasValidScores = false;
    let hasInvalidScore = false;
    
    classScoreInputs.forEach((classInput, index) => {
        const studentId = parseInt(classInput.getAttribute('data-student-id'));
        const examInput = examScoreInputs[index];
        
        const classScore = classInput.value.trim();
        const examScore = examInput.value.trim();
        
        // Check if at least one score is provided
        if (classScore === '' && examScore === '') {
            // No scores for this student, skip
            return;
        }
        
        // Validate class score if provided
        if (classScore !== '') {
            const classScoreNum = parseFloat(classScore);
            if (isNaN(classScoreNum) || classScoreNum < 0 || classScoreNum > 100) {
                hasInvalidScore = true;
                classInput.style.borderColor = 'var(--danger)';
            } else {
                classInput.style.borderColor = '';
            }
        } else {
            classInput.style.borderColor = '';
        }
        
        // Validate exam score if provided
        if (examScore !== '') {
            const examScoreNum = parseFloat(examScore);
            if (isNaN(examScoreNum) || examScoreNum < 0 || examScoreNum > 100) {
                hasInvalidScore = true;
                examInput.style.borderColor = 'var(--danger)';
            } else {
                examInput.style.borderColor = '';
            }
        } else {
            examInput.style.borderColor = '';
        }
        
        // If no validation errors, save the scores
        if (!hasInvalidScore) {
            hasValidScores = true;
            
            // Initialize student scores if not exists
            if (!scores[subject][studentId]) {
                scores[subject][studentId] = { classScore: '', examScore: '', totalScore: '' };
            }
            
            // Update only the scores that are provided (don't overwrite existing ones with empty values)
            if (classScore !== '') {
                scores[subject][studentId].classScore = parseFloat(classScore);
            }
            
            if (examScore !== '') {
                scores[subject][studentId].examScore = parseFloat(examScore);
            }
            
            // Calculate total if both scores are available
            if (scores[subject][studentId].classScore !== '' && scores[subject][studentId].examScore !== '') {
                scores[subject][studentId].totalScore = calculateTotalScore(
                    scores[subject][studentId].classScore, 
                    scores[subject][studentId].examScore
                );
            } else {
                scores[subject][studentId].totalScore = '';
            }
        }
    });
    
    if (hasInvalidScore) {
        showNotification('Please enter valid scores between 0 and 100 for all students', 'error');
        return;
    }
    
    if (!hasValidScores) {
        showNotification('No scores to save. Please enter scores for at least one student.', 'warning');
        return;
    }
    
    saveScoresToStorage();
    renderSummaryDashboard();
    showNotification(`Scores for ${subject} saved successfully!`, 'success');
    cancelScoreEntry();
}

// Cancel score entry
function cancelScoreEntry() {
    scoreEntryCard.style.display = 'none';
}

// Calculate student performance metrics
function calculateStudentPerformance(studentId) {
    const studentScores = [];
    
    // Collect all subject scores for the student
    subjects.forEach(subject => {
        if (scores[subject] && scores[subject][studentId]) {
            const subjectData = scores[subject][studentId];
            
            // Only include subjects where both scores are available
            if (subjectData.classScore !== '' && subjectData.examScore !== '') {
                const totalScore = calculateTotalScore(subjectData.classScore, subjectData.examScore);
                const gradeInfo = getGrade(totalScore);
                
                studentScores.push({
                    subject: subject,
                    totalScore: totalScore,
                    grade: gradeInfo.grade,
                    remark: gradeInfo.remark
                });
            }
        }
    });
    
    if (studentScores.length === 0) {
        return null; // No complete scores available
    }
    
    // Calculate average score
    const total = studentScores.reduce((sum, score) => sum + score.totalScore, 0);
    const average = total / studentScores.length;
    
    // Count grades
    const gradeCounts = {};
    studentScores.forEach(score => {
        gradeCounts[score.grade] = (gradeCounts[score.grade] || 0) + 1;
    });
    
    // Calculate overall grade based on average
    const overallGradeInfo = getGrade(average);
    
    return {
        studentId: studentId,
        average: average,
        overallGrade: overallGradeInfo.grade,
        overallRemark: overallGradeInfo.remark,
        gradeCounts: gradeCounts,
        totalSubjects: studentScores.length,
        scores: studentScores
    };
}


// ── Report approval (admin must approve before download) ──
function getReportApprovalKey(studentId) {
    const year = (schoolInfo && schoolInfo.academicYear) || '';
    const term = (schoolInfo && schoolInfo.term) || '';
    return String(studentId) + '|' + year + '|' + term;
}

function loadReportRecords() {
    try { return JSON.parse(localStorage.getItem('reports') || '[]'); }
    catch (e) { return []; }
}

function saveReportRecords(list) {
    localStorage.setItem('reports', JSON.stringify(list));
    if (typeof syncSaveCollection === 'function') {
        try { syncSaveCollection('reports', list); } catch (e) {}
    }
}

function getReportRecord(studentId) {
    const key = getReportApprovalKey(studentId);
    const stuId = String(studentId);
    return loadReportRecords().find(r => r.approvalKey === key || String(r.studentId) === stuId || (r.approvalKey && String(r.approvalKey).split('|')[0] === stuId));
}

function isReportApproved(studentId) {
    const rec = getReportRecord(studentId);
    if (!rec) return false;
    const status = String(rec.status || '').toLowerCase();
    return status === 'approved' || status === 'published';
}

function upsertPendingReports(studentList) {
    const list = loadReportRecords();
    const year = (schoolInfo && schoolInfo.academicYear) || '';
    const term = (schoolInfo && schoolInfo.term) || '';
    studentList.forEach(student => {
        const key = getReportApprovalKey(student.id);
        const existing = list.find(r => r.approvalKey === key);
        if (existing) {
            if (String(existing.status).toLowerCase() !== 'approved' && String(existing.status).toLowerCase() !== 'published') {
                existing.status = 'Pending';
                existing.generatedAt = new Date().toISOString();
                existing.studentName = student.name;
                existing.classId = student.class;
            }
        } else {
            list.push({
                id: 'rpt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                approvalKey: key,
                studentId: student.id,
                studentName: student.name,
                classId: student.class,
                academicYearId: year,
                termId: term,
                status: 'Pending',
                generatedAt: new Date().toISOString(),
                generatedBy: sessionStorage.getItem('teacherEmail') || 'teacher'
            });
        }
    });
    saveReportRecords(list);
}


// Generate reports for all students in a class
function generateAllClassReports() {
    const selectedClass = individualClassSelect.value;
    
    if (!selectedClass) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification(`No students found in ${selectedClass}`, 'error');
        return;
    }

    upsertPendingReports(classStudents);

    // Show the students grid
    studentsReportsGrid.style.display = 'grid';
    const approvedCount = classStudents.filter(s => isReportApproved(s.id)).length;
    bulkDownloadReportsBtn.style.display = approvedCount ? 'inline-block' : 'none';
    if (!approvedCount) {
        bulkDownloadReportsBtn.title = 'Admin must approve reports before they can be downloaded';
    }
    
    // Clear existing content
    studentsReportsGrid.innerHTML = '';
    individualReportContainer.innerHTML = '';
    
    // Generate report cards for each student
    classStudents.forEach(student => {
        const reportCard = document.createElement('div');
        reportCard.className = 'student-report-card';
        reportCard.id = `report-card-${student.id}`;
        
        const performance = calculateStudentPerformance(student.id);
        const hasCompleteScores = performance !== null;
        const hasReportDetails = studentReportDetails[student.id] !== undefined;
        
        // Check if student has any scores at all
        let hasAnyScores = false;
        subjects.forEach(subject => {
            if (scores[subject] && scores[subject][student.id]) {
                hasAnyScores = true;
            }
        });
        
        reportCard.innerHTML = `
            <div class="student-report-header">
                <div class="student-report-name">${student.name}</div>
                <div class="student-report-status ${hasCompleteScores ? 'status-ready' : hasAnyScores ? 'status-pending' : 'status-pending'}">
                    <i class="fas ${hasCompleteScores ? 'fa-check-circle' : hasAnyScores ? 'fa-clock' : 'fa-clock'}"></i>
                    ${hasCompleteScores ? 'Ready' : hasAnyScores ? 'Partial Scores' : 'No Scores'}
                </div>
            </div>
            <div class="student-report-class">${student.class}</div>
            ${hasReportDetails ? '<div class="student-report-status status-ready"><i class="fas fa-edit"></i> Customized</div>' : ''}
            <div class="student-report-status ${isReportApproved(student.id) ? 'status-ready' : 'status-pending'}">
                <i class="fas ${isReportApproved(student.id) ? 'fa-check-circle' : 'fa-hourglass-half'}"></i>
                ${isReportApproved(student.id) ? 'Approved — ready to download' : 'Awaiting admin approval'}
            </div>
            <div class="student-report-actions">
                <button class="btn edit-btn" onclick="openEditModal('${student.id}')">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn preview-btn" onclick="previewStudentReport('${student.id}')">
                    <i class="fas fa-eye"></i> Preview
                </button>
                <button class="btn download-btn" onclick="downloadStudentReport('${student.id}')" ${isReportApproved(student.id) ? '' : 'disabled style="opacity:.45;cursor:not-allowed;" title="Admin must approve this report before download"'}>
                    <i class="fas fa-download"></i> ${isReportApproved(student.id) ? 'Download' : 'Locked'}
                </button>
            </div>
        `;
        
        studentsReportsGrid.appendChild(reportCard);
    });
    
    showNotification(`Generated ${classStudents.length} reports for ${selectedClass}. Download stays locked until the admin approves them.`, 'success');
}

// Open edit modal for a student
function openEditModal(studentId) {
    const student = students.find(s => String(s.id) === String(studentId));
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    editModalTitle.textContent = `Edit Report Details - ${student.name}`;
    
    // Load existing details if available
    const details = studentReportDetails[studentId] || {};
    editAttendanceInput.value = details.attendance || '';
    editPromotionStatusSelect.value = details.promotionStatus || '';
    editPromotionTargetSelect.value = details.promotionTarget || '';
    editConductInput.value = details.conduct || '';
    editInterestInput.value = details.interest || '';
    editTeacherRemarksInput.value = details.teacherRemarks || '';
    
    // Store current student ID
    editReportModal.dataset.studentId = studentId;
    currentEditingStudentId = studentId;
    
    // Show modal
    editReportModal.style.display = 'flex';
}

// Close edit modal
function closeEditModal() {
    editReportModal.style.display = 'none';
    delete editReportModal.dataset.studentId;
}

// Auto-fill the promotion target class based on status and current class
function autoFillPromotionTarget() {
    const studentId = parseInt(editReportModal.dataset.studentId);
    if (!studentId) return;

    const student = students.find(s => s.id === studentId);
    if (!student) return;

    const status = editPromotionStatusSelect.value;
    if (!status) {
        editPromotionTargetSelect.value = '';
        return;
    }

    const match = /Class\s*(\d+)/i.exec(student.class || '');
    let level = match ? parseInt(match[1], 10) : parseInt(schoolInfo.basicLevel || '6', 10);
    if (status === 'Promoted') level = level + 1;
    if (level > 9) level = 9;

    const target = 'Basic ' + level;
    const hasOption = Array.from(editPromotionTargetSelect.options).some(o => o.value === target);
    if (hasOption) {
        editPromotionTargetSelect.value = target;
    }
}

// Save report details
function saveReportDetails() {
    const studentId = parseInt(editReportModal.dataset.studentId);
    if (!studentId) {
        showNotification('Error: No student selected.', 'error');
        return;
    }

    const details = {
        attendance: editAttendanceInput.value.trim(),
        promotionStatus: editPromotionStatusSelect.value,
        promotionTarget: editPromotionTargetSelect.value,
        conduct: editConductInput.value,
        interest: editInterestInput.value,
        teacherRemarks: editTeacherRemarksInput.value
    };

    studentReportDetails[studentId] = details;
    saveReportDetailsToStorage();
    
    closeEditModal();
    showNotification('Report details saved successfully!', 'success');
    
    // Refresh the report card to show "Customized" status
    const reportCard = document.getElementById(`report-card-${studentId}`);
    if (reportCard) {
        const statusDiv = reportCard.querySelector('.student-report-status:last-child');
        if (statusDiv) {
            statusDiv.innerHTML = '<i class="fas fa-edit"></i> Customized';
            statusDiv.className = 'student-report-status status-ready';
        }
    }
}

function applyPromotionToClass() {
    const selectedClass = individualClassSelect.value;
    if (!selectedClass) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification(`No students found in ${selectedClass}`, 'error');
        return;
    }

    const status = prompt('Apply to all students in this class. Enter PROMOTED or REPEATED:', 'PROMOTED');
    if (!status) return;

    const normalizedStatus = status.trim().toLowerCase();
    if (normalizedStatus !== 'promoted' && normalizedStatus !== 'repeated') {
        showNotification('Please enter PROMOTED or REPEATED.', 'error');
        return;
    }

    const target = prompt('Enter the class/level to show on the report (for example: Basic 4):', 'Basic 4');
    const normalizedTarget = target ? target.trim() : '';

    classStudents.forEach(student => {
        const details = studentReportDetails[student.id] || {};
        details.promotionStatus = normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
        details.promotionTarget = normalizedTarget;
        studentReportDetails[student.id] = details;
    });

    saveReportDetailsToStorage();
    showNotification(`Applied ${normalizedStatus} status to ${classStudents.length} students in ${selectedClass}.`, 'success');
    generateAllClassReports();
}

// Preview student report
function previewStudentReport(studentId) {
    const student = students.find(s => String(s.id) === String(studentId));
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    // Generate and display the report
    generateIndividualReport(studentId);
    
    // Scroll to preview
    individualReportContainer.scrollIntoView({ behavior: 'smooth' });
}

// Generate individual report for a specific student
function generateIndividualReport(studentId) {
    const student = students.find(s => String(s.id) === String(studentId));
    
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    // Calculate performance
    const performance = calculateStudentPerformance(studentId);
    
    // Get report details
    const details = studentReportDetails[studentId] || {};

    let reportHTML = `
        <div class="school-header">
            <div class="school-header-with-logos">
                <div class="school-logo">
                    ${schoolInfo.schoolLogo ? `<img src="${schoolInfo.schoolLogo}" alt="School Logo" style="width: 100%; height: 100%; object-fit: contain;">` : 'School Logo'}
                </div>
                <div class="school-header-content">
                    <h1>THE LIVING SPRING SCHOOL</h1>
                    <p>P.O.BOX 16493 K.I.A ACCRA (0243438604)</p>
                    <p><strong>Motto:</strong> Drink deep or taste not the spring of knowledge</p>
                    <h2>END OF TERM ${schoolInfo.term} REPORT SHEET</h2>
                </div>
                <div class="school-logo">
                    ${schoolInfo.schoolLogo ? `<img src="${schoolInfo.schoolLogo}" alt="School Logo" style="width: 100%; height: 100%; object-fit: contain;">` : 'School Logo'}
                </div>
            </div>
        </div>

        <div class="student-info-grid">
            <div class="info-item">
                <span class="info-label">CLASS:</span>
                <span class="info-value">${student.class} &nbsp;&nbsp; TERM ${schoolInfo.term}</span>
            </div>
            <div class="info-item">
                <span class="info-label">NAME OF LEARNER:</span>
                <span class="info-value">${student.name}</span>
            </div>
            <div class="info-item">
                <span class="info-label">ACADEMIC YEAR:</span>
                <span class="info-value">${schoolInfo.academicYear}</span>
            </div>
            <div class="info-item">
                <span class="info-label">DATE OF VACATION:</span>
                <span class="info-value">${schoolInfo.closingDate}</span>
            </div>
            <div class="info-item">
                <span class="info-label">NUMBER ON ROLL:</span>
                <span class="info-value">${getNumberOnRollForClass(student.class)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">RE-OPENING DATE:</span>
                <span class="info-value">${schoolInfo.reopeningDate}</span>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>SUBJECT</th>
                    <th>CLASS SCORE (50%)</th>
                    <th>EXAMS SCORE (50%)</th>
                    <th>TOTAL SCORE</th>
                    <th>GRADE</th>
                    <th>REMARKS</th>
                </tr>
            </thead>
            <tbody>
    `;

    let hasScores = false;
    let completedSubjects = 0;
    
    subjects.forEach(subject => {
        if (scores[subject] && scores[subject][studentId]) {
            const subjectData = scores[subject][studentId];
            
            // Check if both scores are available
            if (subjectData.classScore !== '' && subjectData.examScore !== '') {
                hasScores = true;
                completedSubjects++;
                
                const classScore50 = calculateFiftyPercent(subjectData.classScore);
                const examScore50 = calculateFiftyPercent(subjectData.examScore);
                const totalScore = calculateTotalScore(subjectData.classScore, subjectData.examScore);
                const gradeInfo = getGrade(totalScore);
                
                reportHTML += `
                    <tr>
                        <td>${subject}</td>
                        <td>${classScore50}</td>
                        <td>${examScore50}</td>
                        <td>${totalScore}</td>
                        <td class="grade-${gradeInfo.grade}">${gradeInfo.grade}</td>
                        <td class="grade-${gradeInfo.grade}">${gradeInfo.remark}</td>
                    </tr>
                `;
            } else {
                // Show incomplete scores
                const classScoreDisplay = subjectData.classScore !== '' ? calculateFiftyPercent(subjectData.classScore) : '-';
                const examScoreDisplay = subjectData.examScore !== '' ? calculateFiftyPercent(subjectData.examScore) : '-';
                
                reportHTML += `
                    <tr>
                        <td>${subject}</td>
                        <td>${classScoreDisplay}</td>
                        <td>${examScoreDisplay}</td>
                        <td>-</td>
                        <td>-</td>
                        <td>Incomplete</td>
                    </tr>
                `;
            }
        } else {
            // No scores for this subject
            reportHTML += `
                <tr>
                    <td>${subject}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>No scores</td>
                </tr>
            `;
        }
    });

    reportHTML += `
            </tbody>
        </table>
    `;

    // Add performance summary if available
    if (performance) {
        reportHTML += `
            <div class="performance-summary">
                <div class="performance-item">
                    <div class="performance-value">${performance.average.toFixed(1)}%</div>
                    <div class="performance-label">AVERAGE SCORE</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${performance.overallGrade}</div>
                    <div class="performance-label">OVERALL AVERAGE GRADE</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${performance.overallRemark}</div>
                    <div class="performance-label">PERFORMANCE LEVEL</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${completedSubjects}/9</div>
                    <div class="performance-label">SUBJECTS COMPLETED</div>
                </div>
            </div>
        `;
    } else if (completedSubjects > 0) {
        reportHTML += `
            <div class="performance-summary">
                <div class="performance-item">
                    <div class="performance-value">${completedSubjects}</div>
                    <div class="performance-label">SUBJECTS WITH SCORES</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${9 - completedSubjects}</div>
                    <div class="performance-label">SUBJECTS PENDING</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">-</div>
                    <div class="performance-label">AVERAGE SCORE</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">-</div>
                    <div class="performance-label">OVERALL AVERAGE GRADE</div>
                </div>
            </div>
        `;
    }

    // Use saved details or defaults
    reportHTML += `
        <div class="attendance-section">
            <div class="info-item">
                <span class="info-label">:</span>
                <span class="info-value">${details.attendance || ''}</span>
            </div>
            <div class="info-item">
                <span class="info-label">PROMOTED TO:</span>
                <span class="info-value">${details.promotionStatus === 'Promoted' ? details.promotionTarget || '' : ''}</span>
            </div>
            <div class="info-item">
                <span class="info-label">REPEATED TO:</span>
                <span class="info-value">${details.promotionStatus === 'Repeated' ? details.promotionTarget || '' : ''}</span>
            </div>
        </div>

        <div class="conduct-section">
            <div class="info-item">
                <span class="info-label">CONDUCT:</span>
                <span class="info-value">${details.conduct || 'Not specified'}</span>
            </div>
        </div>

        <div class="interest-section">
            <div class="info-item">
                <span class="info-label">INTEREST:</span>
                <span class="info-value">${details.interest || 'Not specified'}</span>
            </div>
        </div>

        <div class="teacher-remarks-section">
            <div class="info-item">
                <span class="info-label">CLASS TEACHER'S REMARKS:</span>
                <span class="info-value">${details.teacherRemarks || 'Not specified'}</span>
            </div>
        </div>

        <div class="signature-section">
            <div class="info-item">
                <span class="info-label">CLASS TEACHER:</span>
                <span class="info-value">${schoolInfo.classTeacher || '_________________________'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">ADMINISTRATOR'S SIGNATURE:</span>
                <span class="info-value">_________________________</span>
            </div>
            <br>    </br>
            <div class="info-item">
                <span class="info-label">CLASS TEACHER'S SIGNATURE:</span>
                <span class="info-value">_________________________</span>
            </div>
        </div>

        <div class="footer-message">
            Have a wonderful holiday!
        </div>
    `;

    individualReportContainer.innerHTML = reportHTML;
    showNotification('Individual report generated successfully!', 'success');
    
    return reportHTML;
}

// Build a full HTML document for PDF export
function buildReportPdfDocument(studentId) {
    const student = students.find(s => s.id === studentId);
    if (!student) {
        return null;
    }

    const reportHTML = generateIndividualReport(studentId);
    const cleanName = student.name.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `Report_${cleanName}_Term${schoolInfo.term}_${schoolInfo.academicYear.replace('/', '_')}`;

    return {
        fileName,
        html: `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8" />
            <title>${fileName}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 15px; line-height: 1.3; color: #111; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
                th, td { border: 1px solid #000; padding: 6px; text-align: center; }
                th { background-color: #f0f0f0; font-weight: bold; }
                .school-header { text-align: center; margin-bottom: 15px; }
                .school-header-with-logos { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
                .school-logo { width: 80px; height: 80px; border: 2px solid #4361ee; border-radius: 10px; padding: 5px; background: white; }
                .student-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 11px; }
                .attendance-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 12px 0; font-size: 11px; }
                .conduct-section, .interest-section, .teacher-remarks-section { margin: 8px 0; padding: 8px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .signature-section { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; font-size: 11px; }
                .footer-message { text-align: center; margin-top: 15px; padding: 10px; background: #1e3a8a; color: white; border-radius: 5px; font-weight: bold; }
                .performance-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .performance-item { text-align: center; padding: 8px; background: white; border-radius: 5px; border: 1px solid #ddd; }
                .performance-value { font-size: 1.2rem; font-weight: bold; color: #4361ee; }
                .performance-label { font-size: 0.7rem; color: #666; }
                .grade-A { background-color: #d4edda; color: #155724; }
                .grade-P { background-color: #c3e6cb; color: #155724; }
                .grade-AP { background-color: #fff3cd; color: #856404; }
                .grade-D { background-color: #ffeaa7; color: #856404; }
                .grade-B { background-color: #f8d7da; color: #721c24; }
            </style>
        </head>
        <body>
            ${reportHTML}
        </body>
        </html>`
    };
}

// Convert a report HTML document into a PDF blob
function generateReportPdfBlob(studentId) {
    return new Promise((resolve, reject) => {
        try {
            const student = students.find(s => String(s.id) === String(studentId));
            if (!student) {
                reject(new Error('Student not found.'));
                return;
            }

            const performance = calculateStudentPerformance(studentId);
            const details = studentReportDetails[studentId] || {};
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'pt', 'a4');
            const pageW = doc.internal.pageSize.getWidth();
            const pageH = doc.internal.pageSize.getHeight();
            const margin = 40;
            const contentW = pageW - margin * 2;
            let y = margin;

            const PRIM = [67, 97, 238];
            const SECO = [58, 12, 163];
            const LIGHT = [248, 249, 250];
            const BORDER = [90, 100, 120];
            const TEXT = [33, 37, 41];
            const ALT = [245, 247, 250];
            const gradeRGB = { A: [21, 87, 36], P: [21, 87, 36], AP: [133, 100, 4], D: [133, 100, 4], B: [114, 28, 36] };

            function ensureSpace(h) {
                if (y + h > pageH - margin) {
                    doc.addPage();
                    y = margin;
                }
            }
            function box(x, yy, w, h, fill, border) {
                if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, yy, w, h, 'F'); }
                if (border) { doc.setDrawColor(border[0], border[1], border[2]); doc.rect(x, yy, w, h); }
            }
            function setT(c) { doc.setTextColor(c[0], c[1], c[2]); }

            // Top accent bar
            doc.setFillColor(PRIM[0], PRIM[1], PRIM[2]);
            doc.rect(0, 0, pageW, 6, 'F');
            y = margin + 8;

            if (schoolInfo.schoolLogo) {
                const logoSize = 80;
                const logoY = y - 20;
                let logoFormat = 'PNG';
                const src = String(schoolInfo.schoolLogo);
                if (/data:image\/jpeg|data:image\/jpg/.test(src)) logoFormat = 'JPEG';
                else if (/data:image\/gif/.test(src)) logoFormat = 'GIF';
                try {
                    doc.addImage(src, logoFormat, margin, logoY, logoSize, logoSize);
                    doc.addImage(src, logoFormat, pageW - margin - logoSize, logoY, logoSize, logoSize);
                } catch (e) {
                    console.error('Failed to add logo to PDF', e);
                }
            }

            // Header
            setT(PRIM); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
            doc.text('THE LIVING SPRING SCHOOL', pageW / 2, y, { align: 'center' });
            y += 18;
            setT(TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            doc.text('P.O.BOX 16493 K.I.A ACCRA (0243438604)', pageW / 2, y, { align: 'center' });
            y += 12;
            doc.setFontSize(9);
            doc.text('Motto: Drink deep or taste not the spring of knowledge', pageW / 2, y, { align: 'center' });
            y += 16;
            setT(SECO); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
            doc.text(`END OF TERM ${schoolInfo.term} REPORT SHEET`, pageW / 2, y, { align: 'center' });
            y += 14;

            // Student info box
            const halfItemW = (contentW - 20) / 2;
            const lineHeight = 14;
            const rowPadding = 8;

            const row1Left = ['NAME OF LEARNER:', student.name];
            const row1Right = ['CLASS:', `${student.class}        TERM ${schoolInfo.term}`];
            const row2Left = ['NUMBER ON ROLL:', String(getNumberOnRollForClass(student.class))];
            const row2Right = ['ACADEMIC YEAR:', schoolInfo.academicYear];
            const row3Left = ['DATE OF VACATION:', schoolInfo.closingDate];
            const row3Right = ['RE-OPENING DATE:', schoolInfo.reopeningDate];

            const row1LeftLines = doc.splitTextToSize(row1Left[1], halfItemW - 90 - 6);
            const row1RightLines = doc.splitTextToSize(row1Right[1], halfItemW - 50 - 6);
            const row1H = Math.max(16, Math.max(row1LeftLines.length, row1RightLines.length) * lineHeight + rowPadding);

            const row2LeftLines = doc.splitTextToSize(row2Left[1], halfItemW - 120 - 6);
            const row2RightLines = doc.splitTextToSize(row2Right[1], halfItemW - 120 - 6);
            const row2H = Math.max(16, Math.max(row2LeftLines.length, row2RightLines.length) * lineHeight + rowPadding);

            const row3LeftLines = [row3Left[1]];
            const row3RightLines = [row3Right[1]];
            const row3H = Math.max(16, lineHeight + rowPadding);

            const infoH = row1H + row2H + row3H + 10;
            ensureSpace(infoH + 12);
            box(margin, y, contentW, infoH, LIGHT, BORDER);
            doc.setFontSize(10);
            let rowY = y + 8;

            doc.setFont('helvetica', 'bold'); setT(TEXT);
            doc.text('NAME OF LEARNER:', margin + 10, rowY);
            doc.text('CLASS:', margin + 10 + halfItemW, rowY);
            doc.setFont('helvetica', 'normal');
            row1LeftLines.forEach((line, li) => doc.text(line, margin + 10 + 105, rowY + li * lineHeight));
            row1RightLines.forEach((line, li) => doc.text(line, margin + 10 + halfItemW + 50, rowY + li * lineHeight));
            rowY += row1H;

            doc.setFont('helvetica', 'bold'); setT(TEXT);
            doc.text('NUMBER ON ROLL:', margin + 10, rowY);
            doc.text('ACADEMIC YEAR:', margin + 10 + halfItemW, rowY);
            doc.setFont('helvetica', 'normal');
            row2LeftLines.forEach((line, li) => doc.text(line, margin + 10 + 120, rowY + li * lineHeight));
            row2RightLines.forEach((line, li) => doc.text(line, margin + 10 + halfItemW + 120, rowY + li * lineHeight));
            rowY += row2H;

            doc.setFont('helvetica', 'bold'); setT(TEXT);
            doc.text('DATE OF VACATION:', margin + 10, rowY);
            doc.text('RE-OPENING DATE:', margin + 10 + halfItemW, rowY);
            doc.setFont('helvetica', 'normal');
            row3LeftLines.forEach((line, li) => doc.text(line, margin + 10 + 120, rowY + li * lineHeight));
            row3RightLines.forEach((line, li) => doc.text(line, margin + 10 + halfItemW + 120, rowY + li * lineHeight));
            rowY += row3H;

            y += infoH + 14;

            // Scores table
            const colW = [140, 80, 80, 65, 60, contentW - 425];
            const headers = ['SUBJECT', 'CLASS(50%)', 'EXAM(50%)', 'TOTAL', 'GRADE', 'REMARKS'];
            const headH = 20, rowH = 18;
            function drawTableHeader() {
                ensureSpace(headH);
                const hY = y;
                doc.setFillColor(PRIM[0], PRIM[1], PRIM[2]);
                doc.rect(margin, hY, contentW, headH, 'F');
                setT([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
                let x = margin;
                headers.forEach((h, i) => { doc.text(h, x + 4, hY + 14); x += colW[i]; });
                doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
                doc.rect(margin, hY, contentW, headH);
                y = hY + headH;
            }
            drawTableHeader();
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            subjects.forEach((subject, ri) => {
                const before = y;
                const sd = scores[subject] && scores[subject][studentId];
                let classS = '-', examS = '-', total = '-', grade = '-', remark = '-';
                if (sd) {
                    if (sd.classScore !== '' && sd.examScore !== '') {
                        const cs = calculateFiftyPercent(parseFloat(sd.classScore));
                        const es = calculateFiftyPercent(parseFloat(sd.examScore));
                        total = calculateTotalScore(parseFloat(sd.classScore), parseFloat(sd.examScore));
                        const g = getGrade(total);
                        grade = g.grade; remark = g.remark;
                        classS = String(cs); examS = String(es);
                    } else {
                        classS = sd.classScore !== '' ? String(calculateFiftyPercent(parseFloat(sd.classScore))) : '-';
                        examS = sd.examScore !== '' ? String(calculateFiftyPercent(parseFloat(sd.examScore))) : '-';
                        remark = 'Incomplete';
                    }
                } else { remark = 'No scores'; }
                const vals = [subject, classS, examS, String(total), grade, remark];
                const remarkLines = doc.splitTextToSize(String(remark), colW[5] - 10);
                const rowH = Math.max(20, remarkLines.length * 20);
                ensureSpace(rowH + 2);
                if (y < before) drawTableHeader();
                if (ri % 2 === 1) { doc.setFillColor(ALT[0], ALT[1], ALT[2]); doc.rect(margin, y, contentW, rowH, 'F'); }
                doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
                doc.rect(margin, y, contentW, rowH);
                let vx = margin;
                colW.forEach(w => { vx += w; doc.line(vx, y, vx, y + rowH); });
                let tx = margin;
                vals.forEach((v, i) => {
                    if (i === 4 && gradeRGB[grade]) setT(gradeRGB[grade]); else setT(TEXT);
                    const text = String(v);
                    if (i === 5 && remarkLines.length > 1) {
                        remarkLines.forEach((line, li) => doc.text(line, tx + 4, y + 13 + li * 20));
                    } else if (i >= 1 && i <= 4) {
                        doc.text(text, tx + colW[i] / 2, y + 13, { align: 'center' });
                    } else {
                        doc.text(text, tx + 4, y + 13);
                    }
                    tx += colW[i];
                });
                setT(TEXT);
                y += rowH;
            });
            y += 10;

            // Performance summary box
            if (performance) {
                const ph = 52;
                ensureSpace(ph + 10);
                box(margin, y, contentW, ph, LIGHT, BORDER);
                setT(PRIM); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
                doc.text('                                                                       PERFORMANCE SUMMARY', margin + 8, y + 16);
                const stats = [
                    ['AVERAGE', performance.average.toFixed(1) + '%'],
                    ['GRADE', performance.overallGrade],
                    ['LEVEL', performance.overallRemark],
                    ['SUBJECTS', performance.totalSubjects + '/9']
                ];
                const cw = contentW / 4;
                stats.forEach((st, i) => {
                    const cx = margin + i * cw + cw / 2;
                setT(SECO); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
                doc.text(st[1], cx, y + 34, { align: 'center' });
                    setT(TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                    doc.text(st[0], cx, y + 46, { align: 'center' });
                });
                y += ph + 12;
            }

            // Attendance / promotion
            ensureSpace(40);
            doc.setFontSize(11);
            setT(TEXT); doc.setFont('helvetica', 'bold');
            doc.text(':', margin, y); //ATTENDANCE TEXT HERE//
            doc.setFont('helvetica', 'normal');
            doc.text(details.attendance || '', margin + 90, y);
            y += 16;
            if (details.promotionStatus === 'Promoted') {
                doc.setFont('helvetica', 'bold'); doc.text('PROMOTED TO:', margin, y);
                doc.setFont('helvetica', 'normal'); doc.text(details.promotionTarget || '', margin + 90, y);
                y += 16;
            } else if (details.promotionStatus === 'Repeated') {
                doc.setFont('helvetica', 'bold'); doc.text('REPEATED TO:', margin, y);
                doc.setFont('helvetica', 'normal'); doc.text(details.promotionTarget || '', margin + 90, y);
                y += 16;
            }
            y += 6;

            // Conduct / Interest / Remarks boxes
            function sectionBox(label, text) {
                const lines = doc.splitTextToSize(text || 'Not specified', contentW - 20);
                const h = 26 + lines.length * 14;
                ensureSpace(h);
                box(margin, y, contentW, h, LIGHT, BORDER);
                setT(PRIM); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
                doc.text(label, margin + 8, y + 16);
                setT(TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
                lines.forEach((l, i) => doc.text(l, margin + 8, y + 30 + i * 14));
                y += h + 8;
            }
            sectionBox('CONDUCT:', details.conduct);
            sectionBox('INTEREST:', details.interest);
            sectionBox("CLASS TEACHER'S REMARKS:", details.teacherRemarks);

            // Signature
            ensureSpace(80);
            y += 16;
            setT(TEXT); doc.setFont('helvetica', 'normal'); doc.setFontSize(11);

            // Headteacher digital signature image
            if (schoolInfo.digitalSignature) {
                try {
                    let sigFmt = 'PNG';
                    const sigSrc = String(schoolInfo.digitalSignature);
                    if (/data:image\/jpeg|data:image\/jpg/.test(sigSrc)) sigFmt = 'JPEG';
                    doc.addImage(sigSrc, sigFmt, margin, y, 80, 28);
                } catch(e) { console.warn('Signature image error:', e); }
            }
            doc.setFont('helvetica', 'bold');
            doc.text('HEADTEACHER: ' + (schoolInfo.headTeacher || '_______________'), margin, y + 34);
            doc.setFont('helvetica', 'normal');
            doc.text('SIGNATURE: _________________________', margin, y + 46);

            doc.setFont('helvetica', 'bold');
            doc.text('CLASS TEACHER: ' + (schoolInfo.classTeacher || ''), pageW / 2 + 10, y + 34);
            doc.setFont('helvetica', 'normal');
            doc.text('SIGNATURE: _________________________', pageW / 2 + 10, y + 46);
            y += 60;

            // Footer bar
            doc.setFillColor(PRIM[0], PRIM[1], PRIM[2]);
            doc.rect(0, pageH - 38, pageW, 38, 'F');
            setT([255, 255, 255]); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
            doc.text('Have a wonderful holiday!', pageW / 2, pageH - 14, { align: 'center' });

            resolve(doc.output('blob'));
        } catch (error) {
            reject(error);
        }
    });
}

// Download individual student report as PDF
function downloadStudentReport(studentId) {
    const student = students.find(s => String(s.id) === String(studentId));
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    if (!isReportApproved(studentId)) {
        showNotification('This report is waiting for admin approval. It cannot be downloaded yet.', 'error');
        return;
    }

    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        showNotification('PDF library not available. Please reload the page.', 'error');
        return;
    }

    generateReportPdfBlob(studentId).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `${student.name.replace(/[^a-zA-Z0-9]/g, '_')}_report.pdf`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 3000);
        showNotification('Report downloaded as PDF.', 'success');
    }).catch(() => {
        showNotification('Unable to generate PDF right now.', 'error');
    });
}

// Download individual report as PDF with custom filename
function downloadIndividualReportAsPDF(studentName, reportHTML) {
    if (!reportHTML) {
        showNotification('Please generate a report first.', 'error');
        return;
    }

    const printWindow = window.open('', '_blank');
    
    // Clean filename
    const cleanName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `Report_${cleanName}_Term${schoolInfo.term}_${schoolInfo.academicYear.replace('/', '_')}`;
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${fileName}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 15px; line-height: 1.3; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
                th, td { border: 1px solid #000; padding: 6px; text-align: center; }
                th { background-color: #f0f0f0; font-weight: bold; }
                .school-header { text-align: center; margin-bottom: 15px; }
                .school-header-with-logos { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
                .school-logo { width: 80px; height: 80px; border: 2px solid #4361ee; border-radius: 10px; padding: 5px; background: white; }
                .student-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 11px; }
                .attendance-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 12px 0; font-size: 11px; }
                .conduct-section, .interest-section, .teacher-remarks-section { margin: 8px 0; padding: 8px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .signature-section { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; font-size: 11px; }
                .footer-message { text-align: center; margin-top: 15px; padding: 10px; background: #1e3a8a; color: white; border-radius: 5px; font-weight: bold; }
                .performance-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .performance-item { text-align: center; padding: 8px; background: white; border-radius: 5px; border: 1px solid #ddd; }
                .performance-value { font-size: 1.2rem; font-weight: bold; color: #4361ee; }
                .performance-label { font-size: 0.7rem; color: #666; }
                .grade-A { background-color: #d4edda; color: #155724; }
                .grade-P { background-color: #c3e6cb; color: #155724; }
                .grade-AP { background-color: #fff3cd; color: #856404; }
                .grade-D { background-color: #ffeaa7; color: #856404; }
                .grade-B { background-color: #f8d7da; color: #721c24; }
                @media print {
                    body { margin: 0; padding: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            ${reportHTML}
            <div class="no-print" style="text-align: center; margin-top: 20px; padding: 10px; border-top: 1px solid #ccc;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #4361ee; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    <i class="fas fa-print"></i> Print/Save as PDF
                </button>
                <p style="margin-top: 10px; font-size: 12px; color: #666;">
                    File will be saved as: ${fileName}.pdf
                </p>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    
    showNotification(`Report for ${studentName} ready to download as PDF!`, 'success');
}

// Bulk download all reports as a ZIP file containing PDFs
async function bulkDownloadAllReports() {
    const selectedClass = individualClassSelect.value;
    if (!selectedClass) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification(`No students found in ${selectedClass}`, 'error');
        return;
    }

    const approvedStudents = classStudents.filter(s => isReportApproved(s.id));
    if (!approvedStudents.length) {
        showNotification('No approved reports in this class yet. Ask the admin to approve them first.', 'error');
        return;
    }
    if (approvedStudents.length < classStudents.length) {
        showNotification(`Only ${approvedStudents.length} of ${classStudents.length} reports are approved. Downloading approved ones only.`, 'warning');
    }

    showNotification(`Preparing ${approvedStudents.length} approved PDFs for download...`, 'info');

    if (typeof JSZip === 'undefined') {
        showNotification('ZIP library not available. Please reload the page.', 'error');
        return;
    }

    const zip = new JSZip();
    const progressMessage = `Creating ZIP archive for ${selectedClass}...`;
    showNotification(progressMessage, 'info');

    for (const student of classStudents) {
        try {
            const pdfBlob = await generateReportPdfBlob(student.id);
            const safeName = student.name.replace(/[^a-zA-Z0-9]/g, '_');
            const fileName = `${safeName}_Term${schoolInfo.term}_${schoolInfo.academicYear.replace('/', '_')}.pdf`;
            zip.file(fileName, pdfBlob);
        } catch (error) {
            console.error(`Failed to create PDF for ${student.name}`, error);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedClass.replace(/[^a-zA-Z0-9]/g, '_')}_reports.zip`;
    link.click();
    URL.revokeObjectURL(url);

    showNotification(`Downloaded ${selectedClass} reports as a ZIP file.`, 'success');
}

// Generate PDF report for WhatsApp - Returns the HTML content of the report
function generatePDFReportForWhatsApp(studentId) {
    const student = students.find(s => s.id === studentId);
    if (!student) return null;

    // Calculate performance
    const performance = calculateStudentPerformance(studentId);
    
    // Get report details
    const details = studentReportDetails[studentId] || {};

    let reportHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Report for ${student.name}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 15px; line-height: 1.3; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
                th, td { border: 1px solid #000; padding: 6px; text-align: center; }
                th { background-color: #f0f0f0; font-weight: bold; }
                .school-header { text-align: center; margin-bottom: 15px; }
                .school-header-with-logos { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
                .school-logo { width: 80px; height: 80px; border: 2px solid #4361ee; border-radius: 10px; padding: 5px; background: white; }
                .student-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 11px; }
                .attendance-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 12px 0; font-size: 11px; }
                .conduct-section, .interest-section, .teacher-remarks-section { margin: 8px 0; padding: 8px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .signature-section { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; font-size: 11px; }
                .footer-message { text-align: center; margin-top: 15px; padding: 10px; background: #1e3a8a; color: white; border-radius: 5px; font-weight: bold; }
                .performance-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 11px; }
                .performance-item { text-align: center; padding: 8px; background: white; border-radius: 5px; border: 1px solid #ddd; }
                .performance-value { font-size: 1.2rem; font-weight: bold; color: #4361ee; }
                .performance-label { font-size: 0.7rem; color: #666; }
                .grade-A { background-color: #d4edda; color: #155724; }
                .grade-P { background-color: #c3e6cb; color: #155724; }
                .grade-AP { background-color: #fff3cd; color: #856404; }
                .grade-D { background-color: #ffeaa7; color: #856404; }
                .grade-B { background-color: #f8d7da; color: #721c24; }
                @media print {
                    body { margin: 0; padding: 0; }
                }
            </style>
        </head>
        <body>
            <div class="school-header">
                <div class="school-header-with-logos">
                    <div class="school-logo">
                        ${schoolInfo.schoolLogo ? `<img src="${schoolInfo.schoolLogo}" alt="School Logo" style="width: 100%; height: 100%; object-fit: contain;">` : 'School Logo'}
                    </div>
                    <div class="school-header-content">
                        <h1>THE LIVING SPRING SCHOOL</h1>
                        <p>P.O.BOX 16493 K.I.A ACCRA (0243438604)</p>
                        <p><strong>Motto:</strong> Drink deep or taste not the spring of knowledge</p>
                        <h2>END OF TERM ${schoolInfo.term} REPORT SHEET</h2>
                    </div>
                    <div class="school-logo">
                        ${schoolInfo.schoolLogo ? `<img src="${schoolInfo.schoolLogo}" alt="School Logo" style="width: 100%; height: 100%; object-fit: contain;">` : 'School Logo'}
                    </div>
                </div>
            </div>

            <div class="student-info-grid">
                <div class="info-item">
                    <span class="info-label">CLASS:</span>
                    <span class="info-value">${student.class} &nbsp;&nbsp; TERM ${schoolInfo.term}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">NAME OF LEARNER:</span>
                    <span class="info-value">${student.name}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">ACADEMIC YEAR:</span>
                    <span class="info-value">${schoolInfo.academicYear}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">DATE OF VACATION:</span>
                    <span class="info-value">${schoolInfo.closingDate}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">NUMBER ON ROLL:</span>
                    <span class="info-value">${getNumberOnRollForClass(student.class)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">RE-OPENING DATE:</span>
                    <span class="info-value">${schoolInfo.reopeningDate}</span>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>SUBJECT</th>
                        <th>CLASS SCORE (50%)</th>
                        <th>EXAMS SCORE (50%)</th>
                        <th>TOTAL SCORE</th>
                        <th>GRADE</th>
                        <th>REMARKS</th>
                    </tr>
                </thead>
                <tbody>
    `;

    let completedSubjects = 0;
    
    subjects.forEach(subject => {
        if (scores[subject] && scores[subject][studentId]) {
            const subjectData = scores[subject][studentId];
            
            // Check if both scores are available
            if (subjectData.classScore !== '' && subjectData.examScore !== '') {
                completedSubjects++;
                
                const classScore50 = calculateFiftyPercent(subjectData.classScore);
                const examScore50 = calculateFiftyPercent(subjectData.examScore);
                const totalScore = calculateTotalScore(subjectData.classScore, subjectData.examScore);
                const gradeInfo = getGrade(totalScore);
                
                reportHTML += `
                    <tr>
                        <td>${subject}</td>
                        <td>${classScore50}</td>
                        <td>${examScore50}</td>
                        <td>${totalScore}</td>
                        <td class="grade-${gradeInfo.grade}">${gradeInfo.grade}</td>
                        <td class="grade-${gradeInfo.grade}">${gradeInfo.remark}</td>
                    </tr>
                `;
            } else {
                // Show incomplete scores
                const classScoreDisplay = subjectData.classScore !== '' ? calculateFiftyPercent(subjectData.classScore) : '-';
                const examScoreDisplay = subjectData.examScore !== '' ? calculateFiftyPercent(subjectData.examScore) : '-';
                
                reportHTML += `
                    <tr>
                        <td>${subject}</td>
                        <td>${classScoreDisplay}</td>
                        <td>${examScoreDisplay}</td>
                        <td>-</td>
                        <td>-</td>
                        <td>Incomplete</td>
                    </tr>
                `;
            }
        } else {
            // No scores for this subject
            reportHTML += `
                <tr>
                    <td>${subject}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>No scores</td>
                </tr>
            `;
        }
    });

    reportHTML += `
                </tbody>
            </table>
    `;

    // Add performance summary if available
    if (performance) {
        reportHTML += `
            <div class="performance-summary">
                <div class="performance-item">
                    <div class="performance-value">${performance.average.toFixed(1)}%</div>
                    <div class="performance-label">AVERAGE SCORE</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${performance.overallGrade}</div>
                    <div class="performance-label">OVERALL AVERAGE GRADE</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${performance.overallRemark}</div>
                    <div class="performance-label">PERFORMANCE LEVEL</div>
                </div>
                <div class="performance-item">
                    <div class="performance-value">${completedSubjects}/9</div>
                    <div class="performance-label">SUBJECTS COMPLETED</div>
                </div>
            </div>
        `;
    }

    // Use saved details or defaults
    reportHTML += `
        <div class="attendance-section">
            <div class="info-item">
                <span class="info-label">ATTENDANCE:</span>
                <span class="info-value">${details.attendance || 'Not specified'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">PROMOTED TO:</span>
                <span class="info-value">${details.promotionStatus === 'Promoted' ? details.promotionTarget || '' : ''}</span>
            </div>
            <div class="info-item">
                <span class="info-label">REPEATED TO:</span>
                <span class="info-value">${details.promotionStatus === 'Repeated' ? details.promotionTarget || '' : ''}</span>
            </div>
        </div>

        <div class="conduct-section">
            <div class="info-item">
                <span class="info-label">CONDUCT:</span>
                <span class="info-value">${details.conduct || 'Not specified'}</span>
            </div>
        </div>

        <div class="interest-section">
            <div class="info-item">
                <span class="info-label">INTEREST:</span>
                <span class="info-value">${details.interest || 'Not specified'}</span>
            </div>
        </div>

        <div class="teacher-remarks-section">
            <div class="info-item">
                <span class="info-label">CLASS TEACHER'S REMARKS:</span>
                <span class="info-value">${details.teacherRemarks || 'Not specified'}</span>
            </div>
        </div>

            <div class="signature-section">
                <div class="info-item">
                    <span class="info-label">CLASS TEACHER:</span>
                    <span class="info-value">${schoolInfo.classTeacher || '_________________________'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">ADMINISTRATOR'S SIGNATURE:</span>
                    <span class="info-value">_________________________</span>
                </div>
                <div class="info-item">
                    <span class="info-label">CLASS TEACHER'S SIGNATURE:</span>
                    <span class="info-value">_________________________</span>
                </div>
            </div>

            <div class="footer-message">
                Have a wonderful holiday!
            </div>
        </body>
    </html>
    `;
    
    return reportHTML;
}

function buildWhatsAppTextMessage(studentId) {
    const student = students.find(s => s.id === studentId);
    if (!student) return '';

    const details = studentReportDetails[studentId] || {};
    const performance = calculateStudentPerformance(studentId);
    const lines = [];
    const divider = '=================================';

    lines.push(divider);
    lines.push('END OF TERM REPORT');
    lines.push('THE LIVING SPRING SCHOOL');
    lines.push(`Term ${schoolInfo.term} | ${schoolInfo.academicYear}`);
    lines.push(divider);
    lines.push('');
    lines.push(`Student: ${student.name}`);
    lines.push(`Class: ${student.class}`);
    lines.push(`Attendance: ${details.attendance || 'Not specified'}`);
    lines.push(`Conduct: ${details.conduct || 'Not specified'}`);
    lines.push(`Interest: ${details.interest || 'Not specified'}`);
    lines.push(`Teacher Remarks: ${details.teacherRemarks || 'Not specified'}`);
    lines.push('');
    lines.push('Subject Summary');
    lines.push('');

    subjects.forEach(subject => {
        const subjectData = scores[subject] && scores[subject][studentId] ? scores[subject][studentId] : null;
        if (!subjectData) {
            lines.push(`${subject}: No score entered`);
            return;
        }

        const classScore = subjectData.classScore !== '' ? subjectData.classScore : '-';
        const examScore = subjectData.examScore !== '' ? subjectData.examScore : '-';
        const totalScore = subjectData.totalScore !== '' ? subjectData.totalScore : '-';
        const grade = subjectData.totalScore !== '' ? getGrade(subjectData.totalScore).grade : '-';
        lines.push(`${subject}: Class ${classScore} | Exam ${examScore} | Total ${totalScore} | Grade ${grade}`);
    });

    lines.push('');
    if (performance) {
        lines.push(`Average Score: ${performance.average.toFixed(1)}%`);
        lines.push(`Overall Average Grade: ${performance.overallGrade}`);
        lines.push(`Performance Level: ${performance.overallRemark}`);
    }
    lines.push('');
    lines.push('Please find the PDF and text report attached.');
    lines.push('Generated with OneReal Report Generator.');
    lines.push('');
    lines.push('Thank you.');

    return lines.join('\n');
}

async function shareReportToWhatsApp(studentId) {
    const student = students.find(s => s.id === studentId);
    if (!student) {
        showNotification('Student not found.', 'error');
        return;
    }

    if (!isReportApproved(studentId)) {
        showNotification('This report has not been approved by admin yet. Sharing is locked.', 'error');
        return;
    }

    const parentInfo = parentContacts[studentId];
    if (!parentInfo) {
        showNotification(`No parent information found for ${student.name}.`, 'error');
        return;
    }

    const message = buildWhatsAppTextMessage(studentId);
    const safeName = student.name.replace(/[^a-zA-Z0-9]/g, '_');
    const pdfFileName = `${safeName}_report.pdf`;
    const txtFileName = `${safeName}_report.txt`;

    try {
        const pdfBlob = await generateReportPdfBlob(studentId);
        const pdfFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' });
        const txtBlob = new Blob([message], { type: 'text/plain;charset=utf-8' });
        const txtFile = new File([txtBlob], txtFileName, { type: 'text/plain' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile, txtFile] })) {
            await navigator.share({
                title: `Report for ${student.name}`,
                text: message,
                files: [pdfFile, txtFile]
            });
        } else {
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const txtUrl = URL.createObjectURL(txtBlob);

            const pdfLink = document.createElement('a');
            pdfLink.href = pdfUrl;
            pdfLink.download = pdfFileName;
            pdfLink.click();

            const txtLink = document.createElement('a');
            txtLink.href = txtUrl;
            txtLink.download = txtFileName;
            txtLink.click();

            URL.revokeObjectURL(pdfUrl);
            URL.revokeObjectURL(txtUrl);

            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/${parentInfo.phone.replace(/\D/g, '')}?text=${encodedMessage}`;
            window.open(whatsappUrl, '_blank');
        }

        parentContacts[studentId].sent = true;
        saveParentContacts();
        renderParentsList();
        showNotification(`Report sent to ${student.name}'s parent with PDF and text summary.`, 'success');
    } catch (error) {
        console.error('WhatsApp share failed', error);
        showNotification('Unable to prepare the report for WhatsApp right now.', 'error');
    }
}

async function sendIndividualWhatsAppReport(studentId) {
    await shareReportToWhatsApp(studentId);
}

// Send WhatsApp report for selected student
async function sendWhatsAppReport() {
    const studentId = parseInt(whatsappStudentSelect.value);
    if (!studentId) {
        showNotification('Please select a student first.', 'error');
        return;
    }

    await sendIndividualWhatsAppReport(studentId);
}

// Bulk send WhatsApp reports for entire class
function bulkSendWhatsAppReports() {
    const selectedClass = whatsappClassSelect.value;
    if (!selectedClass) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification('No students found in this class.', 'error');
        return;
    }

    let sentCount = 0;
    let pendingCount = 0;
    let noParentCount = 0;

    bulkSendStatus.innerHTML = '<div class="loading" style="display: inline-block; margin-right: 10px;"></div> Preparing reports...';

    // Process each student
    classStudents.forEach((student, index) => {
        setTimeout(async () => {
            const parentInfo = parentContacts[student.id];
            if (parentInfo) {
                const performance = calculateStudentPerformance(student.id);
                if (performance) {
                    await shareReportToWhatsApp(student.id);
                    sentCount++;
                } else {
                    noParentCount++;
                }
            } else {
                noParentCount++;
            }

            // Update status
            bulkSendStatus.innerHTML = `
                <div style="color: var(--primary);">
                    <i class="fas fa-sync-alt fa-spin"></i> Processing: ${sentCount + noParentCount}/${classStudents.length}
                </div>
            `;

            // If all processed, save and show summary
            if (sentCount + noParentCount === classStudents.length) {
                saveParentContacts();
                renderParentsList();
                
                bulkSendStatus.innerHTML = `
                    <div style="color: var(--success); font-weight: bold;">
                        <i class="fas fa-check-circle"></i> Bulk send completed!
                    </div>
                    <div style="margin-top: 10px;">
                        <div>✓ Reports prepared: ${sentCount}</div>
                        <div>⚠ No parent info: ${noParentCount}</div>
                        <div style="margin-top: 10px; font-size: 0.9rem;">
                            <em>PDF and text files are prepared for each parent. On desktop, the files will download and WhatsApp will open with the message.</em>
                        </div>
                    </div>
                `;
                
                showNotification(`Bulk send completed: ${sentCount} reports prepared!`, 'success');
            }
        }, index * 3000); // Stagger requests to avoid overwhelming the browser
    });
}

// Download performance analysis as PDF
function downloadPerformanceAnalysis() {
    if (performanceContainer.innerHTML === '') {
        showNotification('Please generate performance analysis first.', 'error');
        return;
    }

    const selectedClass = performanceClassSelect.value;
    const fileName = `Performance_Analysis_${selectedClass}_Term${schoolInfo.term}_${schoolInfo.academicYear.replace('/', '_')}`;

    // Get the chart as image
    let chartImage = '';
    const chartCanvas = document.getElementById('performanceChart');
    if (chartCanvas) {
        chartImage = chartCanvas.toDataURL('image/png');
    }

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${fileName}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.4; }
                .performance-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; padding: 20px; background: #f8f9fa; border-radius: 10px; }
                .performance-item { text-align: center; padding: 15px; background: white; border-radius: 8px; border: 1px solid #ddd; }
                .performance-value { font-size: 1.5rem; font-weight: bold; color: #4361ee; }
                .performance-label { font-size: 0.9rem; color: #666; }
                .ranking-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .ranking-table th, .ranking-table td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                .ranking-table th { background-color: #f0f0f0; font-weight: bold; }
                .ranking-table tr:nth-child(even) { background-color: #f9f9f9; }
                .rank-1 { background-color: #ffd700 !important; }
                .rank-2 { background-color: #c0c0c0 !important; }
                .rank-3 { background-color: #cd7f32 !important; }
                .grade-A { background-color: #d4edda; color: #155724; }
                .grade-P { background-color: #c3e6cb; color: #155724; }
                .grade-AP { background-color: #fff3cd; color: #856404; }
                .grade-D { background-color: #ffeaa7; color: #856404; }
                .grade-B { background-color: #f8d7da; color: #721c24; }
                .chart-container { margin: 20px 0; text-align: center; }
                .chart-container img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; }
                h1, h2, h3 { color: #4361ee; }
                @media print {
                    body { margin: 0; padding: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <h1>Student Performance Analysis & Ranking</h1>
            <h2>${selectedClass} - Term ${schoolInfo.term}, ${schoolInfo.academicYear}</h2>

            ${performanceContainer.innerHTML}

            ${chartImage ? `<div class="chart-container"><img src="${chartImage}" alt="Performance Chart"></div>` : ''}

            <div class="no-print" style="text-align: center; margin-top: 30px; padding: 15px; border-top: 1px solid #ccc;">
                <button onclick="window.print()" style="padding: 12px 24px; background: #4361ee; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px;">
                    <i class="fas fa-print"></i> Print/Save as PDF
                </button>
                <p style="margin-top: 15px; font-size: 14px; color: #666;">
                    File will be saved as: ${fileName}.pdf
                </p>
            </div>
        </body>
        </html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showNotification('Performance analysis downloaded! Open the HTML file and use Print → Save as PDF.', 'success');
}

// Generate performance analysis
function generatePerformanceAnalysis() {
    const selectedClass = performanceClassSelect.value;
    
    if (!selectedClass) {
        showNotification('Please select a class first.', 'error');
        return;
    }

    const classStudents = students.filter(student => student.class === selectedClass);
    if (classStudents.length === 0) {
        showNotification(`No students found in ${selectedClass}`, 'error');
        return;
    }

    // Calculate performance for all students
    const performanceData = [];
    let totalStudentsWithScores = 0;
    
    classStudents.forEach(student => {
        const performance = calculateStudentPerformance(student.id);
        if (performance) {
            performanceData.push({
                studentId: student.id,
                name: student.name,
                ...performance
            });
            totalStudentsWithScores++;
        }
    });

    if (totalStudentsWithScores === 0) {
        showNotification('No complete scores available for this class.', 'error');
        return;
    }

    // Sort by average score (highest first)
    performanceData.sort((a, b) => b.average - a.average);

    // Add ranks
    performanceData.forEach((student, index) => {
        student.rank = index + 1;
    });

    // Calculate class statistics
    const classAverage = performanceData.reduce((sum, student) => sum + student.average, 0) / performanceData.length;
    
    // Count overall grades
    const overallGradeCounts = {
        'A': 0, 'P': 0, 'AP': 0, 'D': 0, 'B': 0
    };
    
    performanceData.forEach(student => {
        overallGradeCounts[student.overallGrade] = (overallGradeCounts[student.overallGrade] || 0) + 1;
    });

    // Generate HTML
    let performanceHTML = `
        <div class="performance-summary">
            <div class="performance-item">
                <div class="performance-value">${performanceData.length}</div>
                <div class="performance-label">TOTAL STUDENTS</div>
            </div>
            <div class="performance-item">
                <div class="performance-value">${classAverage.toFixed(1)}%</div>
                <div class="performance-label">CLASS AVERAGE</div>
            </div>
            <div class="performance-item">
                <div class="performance-value">${overallGradeCounts['A']}</div>
                <div class="performance-label">ADVANCED (A)</div>
            </div>
            <div class="performance-item">
                <div class="performance-value">${overallGradeCounts['B']}</div>
                <div class="performance-label">BEGINNERS (B)</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="performanceChart"></canvas>
        </div>

        <div class="ranking-section">
            <h3>Student Ranking - ${selectedClass}</h3>
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Student Name</th>
                        <th>Average Score</th>
                        <th>Overall Grade</th>
                        <th>Performance Level</th>
                    </tr>
                </thead>
                <tbody>
    `;

    performanceData.forEach(student => {
        const rankClass = student.rank <= 3 ? `rank-${student.rank}` : '';
        performanceHTML += `
            <tr class="${rankClass}">
                <td>${student.rank}</td>
                <td>${student.name}</td>
                <td>${student.average.toFixed(1)}%</td>
                <td class="grade-${student.overallGrade}">${student.overallGrade}</td>
                <td>${student.overallRemark}</td>
            </tr>
        `;
    });

    performanceHTML += `
                </tbody>
            </table>
        </div>
        
        <div class="performance-download-container">
            <button class="btn btn-success" id="downloadPerformanceAnalysis">
                <i class="fas fa-download"></i> Download Performance Analysis as PDF
            </button>
        </div>
    `;

    performanceContainer.innerHTML = performanceHTML;

    // Create performance chart
    const ctx = document.getElementById('performanceChart').getContext('2d');
    
    // Prepare data for chart
    const gradeLabels = ['ADVANCE (A)', 'PROFICIENCY (P)', 'APPROACHING PROFICIENCY (AP)', 'DEVELOPING (D)', 'BEGINNER (B)'];
    const gradeValues = [
        overallGradeCounts['A'],
        overallGradeCounts['P'],
        overallGradeCounts['AP'],
        overallGradeCounts['D'],
        overallGradeCounts['B']
    ];
    
    const gradeColors = [
        'rgba(75, 192, 192, 0.7)',  // Green for Advance
        'rgba(54, 162, 235, 0.7)',  // Blue for Proficiency
        'rgba(255, 206, 86, 0.7)',  // Yellow for Approaching
        'rgba(255, 159, 64, 0.7)',  // Orange for Developing
        'rgba(255, 99, 132, 0.7)'   // Red for Beginner
    ];

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: gradeLabels,
            datasets: [{
                label: 'Number of Students',
                data: gradeValues,
                backgroundColor: gradeColors,
                borderColor: gradeColors.map(color => color.replace('0.7', '1')),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Students'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Performance Levels'
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: `Class Performance Distribution - ${selectedClass}`,
                    font: {
                        size: 16
                    }
                },
                legend: {
                    display: false
                }
            }
        }
    });

    // Add event listener for the download button
    document.getElementById('downloadPerformanceAnalysis').addEventListener('click', downloadPerformanceAnalysis);

    showNotification('Performance analysis generated successfully!', 'success');
}

// Export all data
function exportAllData() {
    const data = {
        students: students,
        scores: scores,
        schoolInfo: schoolInfo,
        parentContacts: parentContacts,
        studentReportDetails: studentReportDetails
    };
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OneReal_Primary_Report_Data_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showNotification('All data exported successfully!', 'success');
}

// Escape a single CSV cell
function csvCell(value) {
    const str = (value === null || value === undefined) ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Export all student data to a flat CSV file
function exportAllDataCsv() {
    if (students.length === 0) {
        showNotification('No student data to export.', 'warning');
        return;
    }

    const header = [
        'Student ID', 'Name', 'Class', 'Attendance',
        'Promotion Status', 'Promotion Target', 'Conduct', 'Interest',
        'Teacher Remarks', 'Parent Name', 'Parent Phone',
        'Average Score', 'Overall Grade', 'Overall Remark'
    ].concat(subjects.map(s => s + ' Score'));

    const rows = students.map(student => {
        const details = studentReportDetails[student.id] || {};
        const parent = parentContacts[student.id] || {};
        const performance = calculateStudentPerformance(student.id);

        const base = [
            student.id,
            student.name,
            student.class,
            details.attendance || '',
            details.promotionStatus || '',
            details.promotionTarget || '',
            details.conduct || '',
            details.interest || '',
            details.teacherRemarks || '',
            parent.name || '',
            parent.phone || '',
            performance ? performance.average.toFixed(1) : '',
            performance ? performance.overallGrade : '',
            performance ? performance.overallRemark : ''
        ];

        const subjectScores = subjects.map(subject => {
            const sd = scores[subject] && scores[subject][student.id];
            if (sd && sd.classScore !== '' && sd.examScore !== '') {
                return calculateTotalScore(sd.classScore, sd.examScore);
            }
            return '';
        });

        return base.concat(subjectScores);
    });

    const csv = [header].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OneReal_Primary_Report_Data_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showNotification('All data exported to CSV successfully!', 'success');
}

// Clear all stored data (with backup reminder)
function clearAllData() {
    if (confirm('WARNING: This will permanently delete ALL students, scores, and settings.\n\nWe strongly recommend exporting your data first (JSON or CSV).\n\nAre you sure you want to clear everything?')) {
        localStorage.clear();
        showNotification('All data has been cleared.', 'info');
        setTimeout(() => location.reload(), 800);
    }
}

// Import data
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (confirm('This will replace all current data. Are you sure?')) {
                if (data.students) students = data.students;
                if (data.scores) scores = data.scores;
                if (data.schoolInfo) schoolInfo = data.schoolInfo;
                if (data.parentContacts) parentContacts = data.parentContacts;
                if (data.studentReportDetails) studentReportDetails = data.studentReportDetails;
                
                saveStudents();
                saveScoresToStorage();
                saveParentContacts();
                saveReportDetailsToStorage();
                localStorage.setItem('schoolInfo', JSON.stringify(schoolInfo));
                
                loadSchoolInfo();
                renderStudentsList();
                renderParentsList();
                
                showNotification('Data imported successfully!', 'success');
            }
        } catch (error) {
            showNotification('Error importing data. Please check the file format.', 'error');
            console.error('Import error:', error);
        }
    };
    reader.readAsText(file);
    
    // Reset file input
    event.target.value = '';
}

// --- DIGITAL SIGNATURE HANDLER ---
async function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file) {
        try {
            const signatureUrl = await uploadImageToCloud(file, 'signatures');
            schoolInfo.digitalSignature = signatureUrl;
            const signaturePreview = document.getElementById('signaturePreview');
            if (signaturePreview) {
                signaturePreview.innerHTML = `<img src="${signatureUrl}" alt="headteacher signature">`;
            }
            saveSchoolInfo();
            showNotification('Digital Signature uploaded successfully!', 'success');
        } catch (err) {
            console.error("Signature upload failed:", err);
            showNotification('Failed to upload digital signature.', 'error');
        }
    }
}

// --- FIREBASE CONFIG & AUTH HANDLERS ---
function openFirebaseConfigModal() {
    const modal = document.getElementById('firebaseConfigModal');
    if (!modal) return;
    const config = getStoredFirebaseConfig();
    document.getElementById('fbApiKey').value = config.apiKey || '';
    document.getElementById('fbAuthDomain').value = config.authDomain || '';
    document.getElementById('fbProjectId').value = config.projectId || '';
    document.getElementById('fbStorageBucket').value = config.storageBucket || '';
    document.getElementById('fbMessagingSenderId').value = config.messagingSenderId || '';
    document.getElementById('fbAppId').value = config.appId || '';
    modal.style.display = 'flex';
}

function handleSaveFirebaseConfig() {
    const config = {
        apiKey: document.getElementById('fbApiKey').value.trim(),
        authDomain: document.getElementById('fbAuthDomain').value.trim(),
        projectId: document.getElementById('fbProjectId').value.trim(),
        storageBucket: document.getElementById('fbStorageBucket').value.trim(),
        messagingSenderId: document.getElementById('fbMessagingSenderId').value.trim(),
        appId: document.getElementById('fbAppId').value.trim()
    };
    saveFirebaseConfig(config);
    document.getElementById('firebaseConfigModal').style.display = 'none';
    showNotification('Firebase Configuration saved!', 'success');
}

let isAuthRegisterMode = false;

function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'flex';
}

function toggleAuthMode() {
    isAuthRegisterMode = !isAuthRegisterMode;
    const title = document.getElementById('authModalTitle');
    const submitBtn = document.getElementById('submitAuthBtn');
    const toggleBtn = document.getElementById('toggleAuthModeBtn');

    if (isAuthRegisterMode) {
        title.innerHTML = '<i class="fas fa-user-plus"></i> Register Teacher Account';
        submitBtn.textContent = 'Register';
        toggleBtn.textContent = 'Already have an account? Login';
    } else {
        title.innerHTML = '<i class="fas fa-user-lock"></i> Teacher / Admin Login';
        submitBtn.textContent = 'Login';
        toggleBtn.textContent = 'Need an account? Register';
    }
}

async function handleAuthSubmit() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorMsg = document.getElementById('authErrorMsg');
    errorMsg.style.display = 'none';

    if (!email || !password) {
        errorMsg.textContent = 'Please enter email and password.';
        errorMsg.style.display = 'block';
        return;
    }

    try {
        if (isAuthRegisterMode) {
            await registerFirebaseUser(email, password);
            showNotification('Registered and logged in successfully!', 'success');
        } else {
            await loginFirebaseUser(email, password);
            showNotification('Logged in successfully!', 'success');
        }
        document.getElementById('authModal').style.display = 'none';
    } catch (err) {
        errorMsg.textContent = err.message || 'Authentication failed.';
        errorMsg.style.display = 'block';
    }
}

async function handleLogout() {
    await logoutFirebaseUser();
    showNotification('Logged out successfully.', 'info');
}

// --- CLASS BROADSHEET (MASTER SHEET) GENERATOR ---
function renderBroadsheet() {
    const broadsheetClassSelect = document.getElementById('broadsheetClass');
    if (!broadsheetClassSelect) return;
    const broadsheetClass = broadsheetClassSelect.value;
    const container = document.getElementById('broadsheetContainer');

    if (!broadsheetClass) {
        container.innerHTML = '<p style="color: #666;">Select a class above to load the master broadsheet.</p>';
        return;
    }

    const classStudents = students.filter(s => s.class === broadsheetClass);
    if (classStudents.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No students found in ${broadsheetClass}.</p></div>`;
        return;
    }

    // Compute Student Aggregates for Ranks & Averages
    const studentStats = classStudents.map(student => {
        let totalScoreSum = 0;
        let subjectsCount = 0;
        const subjectScoresList = {};

        subjects.forEach(subject => {
            const entry = scores[subject] && scores[subject][student.id];
            if (entry && entry.totalScore !== '' && !isNaN(entry.totalScore)) {
                const total = Number(entry.totalScore);
                totalScoreSum += total;
                subjectsCount++;
                subjectScoresList[subject] = total;
            } else {
                subjectScoresList[subject] = null;
            }
        });

        const overallAvg = subjectsCount > 0 ? (totalScoreSum / subjectsCount) : 0;
        return {
            id: student.id,
            name: student.name,
            totalScoreSum,
            subjectsCount,
            overallAvg,
            subjectScoresList
        };
    });

    // Sort by Total Score Sum descending to compute ranks
    studentStats.sort((a, b) => b.totalScoreSum - a.totalScoreSum);
    studentStats.forEach((stat, idx) => {
        stat.rank = idx + 1;
    });

    // Compute Subject Averages
    const subjectClassAverages = {};
    subjects.forEach(subject => {
        const validScores = studentStats.map(s => s.subjectScoresList[subject]).filter(val => val !== null);
        subjectClassAverages[subject] = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : '-';
    });

    // Build Broadsheet Table HTML
    let tableHtml = `
        <table class="broadsheet-table">
            <thead>
                <tr>
                    <th style="width: 40px;">Pos</th>
                    <th class="student-name-col">Student Name</th>
                    ${subjects.map(sub => `<th>${sub}</th>`).join('')}
                    <th>Total</th>
                    <th>Average</th>
                </tr>
            </thead>
            <tbody>
    `;

    studentStats.forEach(stat => {
        let rankBadgeClass = '';
        if (stat.rank === 1) rankBadgeClass = 'rank-badge rank-1';
        else if (stat.rank === 2) rankBadgeClass = 'rank-badge rank-2';
        else if (stat.rank === 3) rankBadgeClass = 'rank-badge rank-3';
        else rankBadgeClass = 'rank-badge';

        tableHtml += `
            <tr>
                <td><span class="${rankBadgeClass}">${stat.rank}</span></td>
                <td class="student-name-col">${stat.name}</td>
                ${subjects.map(sub => {
                    const scoreVal = stat.subjectScoresList[sub];
                    return scoreVal !== null ? `<td>${scoreVal}</td>` : `<td style="color:#ccc;">-</td>`;
                }).join('')}
                <td><strong>${stat.totalScoreSum.toFixed(0)}</strong></td>
                <td><strong>${stat.overallAvg.toFixed(1)}%</strong></td>
            </tr>
        `;
    });

    // Footer row with Class Subject Averages
    tableHtml += `
            <tr style="background: rgba(67, 97, 238, 0.1); font-weight: bold;">
                <td colspan="2" style="text-align: right;">Class Subject Avg:</td>
                ${subjects.map(sub => `<td>${subjectClassAverages[sub]}</td>`).join('')}
                <td colspan="2">-</td>
            </tr>
        </tbody>
        </table>
    `;

    container.innerHTML = tableHtml;
}

// Broadsheet Export CSV
function exportBroadsheetCsv() {
    const broadsheetClass = document.getElementById('broadsheetClass').value;
    if (!broadsheetClass) return showNotification('Select a class to export.', 'error');
    
    const table = document.querySelector('.broadsheet-table');
    if (!table) return showNotification('Generate broadsheet first.', 'error');

    let csvContent = "data:text/csv;charset=utf-8,";
    const rows = table.querySelectorAll('tr');
    rows.forEach(row => {
        const cols = row.querySelectorAll('th, td');
        const rowData = Array.from(cols).map(c => `"${c.innerText.trim()}"`).join(',');
        csvContent += rowData + "\r\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${broadsheetClass}_Broadsheet_Master_Sheet.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Broadsheet Export Excel
function exportBroadsheetExcel() {
    const broadsheetClass = document.getElementById('broadsheetClass').value;
    if (!broadsheetClass) return showNotification('Select a class to export.', 'error');

    const table = document.querySelector('.broadsheet-table');
    if (!table || typeof XLSX === 'undefined') return showNotification('SheetJS Excel library not available.', 'error');

    const wb = XLSX.utils.table_to_book(table, { sheet: "Master Broadsheet" });
    XLSX.writeFile(wb, `${broadsheetClass}_Master_Broadsheet.xlsx`);
}

// --- EXCEL / CSV MARKS BULK UPLOAD ---
function handleExcelMarksUpload(event) {
    const file = event.target.files[0];
    if (!file || typeof XLSX === 'undefined') {
        return showNotification('Spreadsheet parser not ready.', 'error');
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonRows = XLSX.utils.sheet_to_json(worksheet);

            if (!jsonRows.length) {
                return showNotification('Excel sheet is empty.', 'error');
            }

            let importedCount = 0;
            jsonRows.forEach(row => {
                const name = row['Student Name'] || row['StudentName'] || row['Name'];
                const targetClass = row['Class'] || row['Student Class'] || scoreClassSelect.value || 'Class 6';
                const subject = row['Subject'];
                const classScore = row['Class Score'] || row['ClassScore'] || row['30%'] || 0;
                const examScore = row['Exam Score'] || row['ExamScore'] || row['70%'] || 0;

                if (name && subject) {
                    // Check if student exists or create
                    let student = students.find(s => s.name.toLowerCase() === String(name).toLowerCase() && s.class === targetClass);
                    if (!student) {
                        student = { id: Date.now() + Math.floor(Math.random() * 1000), name: name, class: targetClass };
                        students.push(student);
                    }

                    if (!scores[subject]) scores[subject] = {};

                    const total = (Number(classScore) || 0) + (Number(examScore) || 0);
                    const gradeInfo = typeof getGradeAndRemark === 'function' ? getGradeAndRemark(total) : { grade: 'A', remark: 'Good' };

                    scores[subject][student.id] = {
                        classScore: String(classScore),
                        examScore: String(examScore),
                        totalScore: String(total),
                        grade: gradeInfo.grade,
                        remark: gradeInfo.remark
                    };
                    importedCount++;
                }
            });

            saveStudents();
            saveScoresToStorage();
            renderStudentsList();
            renderSubjectsGrid();
            renderSummaryDashboard();

            showNotification(`Successfully imported marks for ${importedCount} student record(s)!`, 'success');
        } catch (err) {
            console.error("Excel import error:", err);
            showNotification('Error parsing Excel file. Please check column headers.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

function downloadExcelTemplate() {
    if (typeof XLSX === 'undefined') return;

    const sampleData = [
        { "Student Name": "Debrah Evans", "Class": "Class 6", "Subject": "Mathematics", "Class Score": 25, "Exam Score": 65 },
        { "Student Name": "Debrah Evans", "Class": "Class 6", "Subject": "Science", "Class Score": 28, "Exam Score": 60 },
        { "Student Name": "Ama Serwaa", "Class": "Class 6", "Subject": "English Language", "Class Score": 22, "Exam Score": 58 }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "MarksTemplate");
    XLSX.writeFile(workbook, "School_Marks_Import_Template.xlsx");
}

// --- SMART NARRATIVE REMARKS ENGINE ---
function generateSmartRemarks(studentId, options = {}) {
    const student = students.find(s => s.id === studentId);
    if (!student) return { teacher: "Good performance.", conduct: "Very well behaved.", interest: "Class activities" };

    let totalSum = 0;
    let count = 0;
    let highestSubject = null;
    let highestScore = -1;
    let lowestSubject = null;
    let lowestScore = 101;

    subjects.forEach(sub => {
        const entry = scores[sub] && scores[sub][studentId];
        if (entry && entry.totalScore !== '') {
            const scoreNum = Number(entry.totalScore);
            totalSum += scoreNum;
            count++;
            if (scoreNum > highestScore) {
                highestScore = scoreNum;
                highestSubject = sub;
            }
            if (scoreNum < lowestScore) {
                lowestScore = scoreNum;
                lowestSubject = sub;
            }
        }
    });

    const avg = count > 0 ? (totalSum / count) : 0;
    const conductTone = options.conductTone || (avg >= 68 ? 'positive' : (avg >= 50 ? 'middle' : 'negative'));
    const teacherTone = options.teacherTone || (avg >= 68 ? 'positive' : (avg >= 50 ? 'middle' : 'negative'));

    let conductRemark = "";
    if (conductTone === 'positive') {
        conductRemark = avg >= 80 ? "Exemplary behavior; very respectful, obedient, and highly disciplined at all times." : "Very well-behaved, courteous, and exhibits excellent cooperation with peers.";
    } else if (conductTone === 'negative') {
        conductRemark = avg < 45 ? "Conduct requires significant improvement. Easily distracted and requires supervision." : "Needs to improve self-discipline and pay closer attention to instructions.";
    } else {
        conductRemark = "Generally well-behaved and cooperative, though occasionally needs gentle guidance.";
    }

    let teacherRemark = "";
    if (teacherTone === 'positive') {
        teacherRemark = avg >= 80 
            ? `An outstanding student who excels across all subjects, particularly in ${highestSubject || 'academics'}. Keep up the brilliant performance!` 
            : `Commendable academic effort and steady progress with notable strength in ${highestSubject || 'class work'}. Continue to work diligently!`;
    } else if (teacherTone === 'negative') {
        teacherRemark = lowestSubject 
            ? `Academic performance is below expectations, particularly in ${lowestSubject}. Urgent remedial support and regular study habits are required.` 
            : `Needs significant academic improvement. Dedicated home study and active parental monitoring are strongly advised.`;
    } else {
        teacherRemark = (highestSubject && lowestSubject && highestSubject !== lowestSubject) 
            ? `A satisfactory performance overall. Shows good understanding in ${highestSubject}, but needs to devote extra study time to ${lowestSubject} for higher grades.` 
            : `A fair performance with promising aptitude in ${highestSubject || 'core subjects'}. Regular revision and practice recommended.`;
    }

    const interestRemark = highestSubject || "Class activities";

    return { teacher: teacherRemark, conduct: conductRemark, interest: interestRemark };
}

function applySmartRemarksToModal() {
    if (!currentEditingStudentId) return;
    const smart = generateSmartRemarks(currentEditingStudentId);
    
    if (typeof editTeacherRemarksInput !== 'undefined' && editTeacherRemarksInput) editTeacherRemarksInput.value = smart.teacher;
    if (typeof editConductInput !== 'undefined' && editConductInput) editConductInput.value = smart.conduct;
    if (typeof editInterestInput !== 'undefined' && editInterestInput) editInterestInput.value = smart.interest;

    showNotification('Generated smart narrative remarks based on student scores!', 'success');
}

// --- ACADEMIC AWARD CERTIFICATE GENERATOR ---
function renderAwardCertificates() {
    const className = document.getElementById('performanceClass').value;
    const container = document.getElementById('certificatesPreviewContainer');
    const modal = document.getElementById('certificateModal');

    if (!className) {
        return showNotification('Select a class in Performance & Ranking tab first.', 'error');
    }

    const classStudents = students.filter(s => s.class === className);
    if (!classStudents.length) {
        return showNotification(`No students found in ${className}.`, 'error');
    }

    // Rank top 3 students
    const studentAverages = classStudents.map(student => {
        const studentScores = subjects.map(sub => {
            const entry = scores[sub] && scores[sub][student.id];
            return entry && entry.totalScore !== '' ? Number(entry.totalScore) : null;
        }).filter(val => val !== null);

        const avg = studentScores.length ? (studentScores.reduce((a, b) => a + b, 0) / studentScores.length) : 0;
        return { student, avg };
    }).sort((a, b) => b.avg - a.avg);

    const topThree = studentAverages.slice(0, 3);
    const ordinals = ["1ST POSITION - OVERALL BEST STUDENT", "2ND POSITION - HIGH HONORS", "3RD POSITION - ACADEMIC HONORS"];

    let certHtml = '';
    topThree.forEach((item, index) => {
        certHtml += `
            <div class="certificate-card">
                <div class="certificate-header">
                    <h1>${schoolInfo.academicYear || '2024/2025'} ACADEMIC EXCELLENCE AWARD</h1>
                    <p>THE LIVING SPRING SCHOOL - ${className.toUpperCase()}</p>
                </div>
                <div class="certificate-body">
                    <div class="certificate-title">Certificate of Honor</div>
                    <p style="font-size: 1.1rem; color: #475569;">THIS CERTIFICATE IS PROUDLY PRESENTED TO</p>
                    <div class="certificate-student-name">${item.student.name}</div>
                    <div class="certificate-reason">
                        For achieving <strong>${ordinals[index]}</strong> with an overall aggregate average of 
                        <strong>${item.avg.toFixed(1)}%</strong> in Term ${schoolInfo.term || '1'} Examinations.
                    </div>
                </div>
                <div class="certificate-footer">
                    <div class="certificate-sign-box">
                        <div>${schoolInfo.classTeacher || 'Class Teacher'}</div>
                        <div class="certificate-sign-line">CLASS TEACHER</div>
                    </div>
                    <div class="certificate-seal">
                        <i class="fas fa-award"></i>
                    </div>
                    <div class="certificate-sign-box">
                        <div>
                            ${schoolInfo.digitalSignature ? `<img src="${schoolInfo.digitalSignature}" style="max-height: 40px;"><br>` : ''}
                            ${schoolInfo.headTeacher || 'Headteacher'}
                        </div>
                        <div class="certificate-sign-line">HEADTEACHER</div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = certHtml;
    modal.style.display = 'flex';
}

// Load data from Cloud Firestore if available
async function loadDataFromCloud() {
    if (typeof syncFetchCollection !== 'function') return;
    try {
        const fetchedStudents = await syncFetchCollection('students', students);
        if (fetchedStudents && Array.isArray(fetchedStudents) && fetchedStudents.length) {
            students = fetchedStudents;
            localStorage.setItem('students', JSON.stringify(students));
        }

        const fetchedScores = await syncFetchCollection('scores', scores);
        if (fetchedScores && typeof fetchedScores === 'object' && Object.keys(fetchedScores).length) {
            scores = fetchedScores;
            localStorage.setItem('scores', JSON.stringify(scores));
        }

        const fetchedSchoolInfo = await syncFetchCollection('schoolInfo', schoolInfo);
        if (fetchedSchoolInfo && typeof fetchedSchoolInfo === 'object' && Object.keys(fetchedSchoolInfo).length) {
            schoolInfo = fetchedSchoolInfo;
            localStorage.setItem('schoolInfo', JSON.stringify(schoolInfo));
        }

        const fetchedDetails = await syncFetchCollection('studentReportDetails', studentReportDetails);
        if (fetchedDetails && typeof fetchedDetails === 'object' && Object.keys(fetchedDetails).length) {
            studentReportDetails = fetchedDetails;
            localStorage.setItem('studentReportDetails', JSON.stringify(studentReportDetails));
        }

        const fetchedContacts = await syncFetchCollection('parentContacts', parentContacts);
        if (fetchedContacts && typeof fetchedContacts === 'object' && Object.keys(fetchedContacts).length) {
            parentContacts = fetchedContacts;
            localStorage.setItem('parentContacts', JSON.stringify(parentContacts));
        }

        loadSchoolInfo();
        renderStudentsList();
        renderSubjectsGrid();
        renderSummaryDashboard();
    } catch(e) {
        console.warn('Cloud sync load fallback:', e);
    }
}

// --- SUPER ADMIN DASHBOARD ENGINE ---
async function renderSuperAdminDashboard() {
    const cloudStatusEl = document.getElementById('adminStatCloudStatus');
    const totalStudentsEl = document.getElementById('adminStatTotalStudents');
    const totalScoresEl = document.getElementById('adminStatTotalScores');

    if (cloudStatusEl) {
        cloudStatusEl.textContent = (typeof isFirebaseActive !== 'undefined' && isFirebaseActive) ? 'ONLINE (CLOUD)' : 'LOCAL MODE';
        cloudStatusEl.style.color = (typeof isFirebaseActive !== 'undefined' && isFirebaseActive) ? '#10b981' : '#f59e0b';
    }

    if (totalStudentsEl) {
        totalStudentsEl.textContent = students ? students.length : 0;
    }

    if (totalScoresEl) {
        let scoreCount = 0;
        if (scores && typeof scores === 'object') {
            Object.keys(scores).forEach(sub => {
                scoreCount += Object.keys(scores[sub] || {}).length;
            });
        }
        totalScoresEl.textContent = scoreCount;
    }

    await renderAuditLogsTable();
    renderAdminMasterStudentsGrid();
}

async function renderAuditLogsTable() {
    const tableBody = document.getElementById('auditLogsTableBody');
    const totalLogsEl = document.getElementById('adminStatTotalLogs');
    if (!tableBody) return;

    let logs = [];
    if (typeof fetchAuditLogs === 'function') {
        logs = await fetchAuditLogs();
    } else {
        logs = JSON.parse(localStorage.getItem('auditLogs')) || [];
    }

    if (totalLogsEl) totalLogsEl.textContent = logs.length;

    if (!logs || !logs.length) {
        tableBody.innerHTML = `<tr><td colspan="4" style="padding: 15px; text-align: center; color: #94a3b8;">No audit logs registered yet. Actions like editing scores, managing learners, or configuring settings will stream here.</td></tr>`;
        return;
    }

    let rowsHtml = '';
    logs.forEach(log => {
        rowsHtml += `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px; font-size: 0.82rem; color: #64748b; white-space: nowrap;">${log.formattedTime || log.timestamp || 'Just now'}</td>
                <td style="padding: 10px; font-weight: 600; color: #334155;">${log.user || 'Teacher'}</td>
                <td style="padding: 10px;"><span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; background: rgba(124, 58, 237, 0.1); color: #7c3aed;">${log.action || 'System Event'}</span></td>
                <td style="padding: 10px; font-size: 0.85rem; color: #475569;">${log.details || '-'}</td>
            </tr>
        `;
    });
    tableBody.innerHTML = rowsHtml;
}

function renderAdminMasterStudentsGrid() {
    const grid = document.getElementById('adminMasterStudentsGrid');
    const classFilter = document.getElementById('adminClassFilter') ? document.getElementById('adminClassFilter').value : '';
    const searchFilter = document.getElementById('adminStudentSearch') ? document.getElementById('adminStudentSearch').value.toLowerCase().trim() : '';

    if (!grid) return;

    let filtered = students;
    if (classFilter) {
        filtered = filtered.filter(s => s.class === classFilter);
    }
    if (searchFilter) {
        filtered = filtered.filter(s => s.name.toLowerCase().includes(searchFilter));
    }

    if (!filtered.length) {
        grid.innerHTML = `<p style="padding: 15px; text-align: center; color: #94a3b8;">No learners found matching filters.</p>`;
        return;
    }

    let html = '';
    filtered.forEach(student => {
        let scoreCount = 0;
        subjects.forEach(sub => {
            if (scores[sub] && scores[sub][student.id] && scores[sub][student.id].totalScore !== '') {
                scoreCount++;
            }
        });

        html += `
            <div class="student-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; margin-bottom: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: #7c3aed; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        ${student.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #1e293b;">${student.name}</div>
                        <div style="font-size: 0.8rem; color: #64748b;">${student.class} &bull; ${scoreCount}/${subjects.length} Subjects Scored</div>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-sm" onclick="openEditModal(${student.id})" type="button" title="Edit Student Report & Remarks"><i class="fas fa-edit"></i> Edit Report</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteStudent(${student.id})" type="button" title="Super Admin Override Delete"><i class="fas fa-trash"></i> Delete</button>
                </div>
            </div>
        `;
    });
    grid.innerHTML = html;
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    // ── Lock the dashboard immediately — nothing shows before auth ──
    showTeacherOverlay();

    // Pre-load dynamic grading scale from cache
    refreshGradingSystem();

    if (typeof initFirebase === 'function') {
        const active = initFirebase();

        if (active && typeof firebase !== 'undefined' && firebase.auth) {
            // Firebase is configured — enforce authentication
            firebase.auth().onAuthStateChanged(async (user) => {
                if (user) {
                    // Authenticated — load user profile and proceed
                    if (typeof loadUserProfile === 'function') {
                        await loadUserProfile(user.uid);
                    }
                    const profile = typeof getCurrentUserProfile === 'function' ? getCurrentUserProfile() : null;
                    updateTeacherHeaderUI(profile || { email: user.email });

                    // Hide teacher auth overlay
                    hideTeacherOverlay();

                    // Fetch latest grading scale from Firestore
                    if (typeof fetchActiveGradingScale === 'function') {
                        await fetchActiveGradingScale();
                        refreshGradingSystem();
                    }

                    // Load school settings (field toggles etc.)
                    if (typeof fetchSchoolSettings === 'function') {
                        const settings = await fetchSchoolSettings();
                        if (settings) applySchoolSettings(settings);
                    }

                    // Initialize app UI
                    init();

                    // Sync cloud data
                    if (active) {
                        await loadDataFromCloud();
                        if (typeof setupRealtimeListeners === 'function') {
                            setupRealtimeListeners((colName, data) => {
                                loadSchoolInfo();
                                renderStudentsList();
                                renderSubjectsGrid();
                                renderSummaryDashboard();
                                refreshGradingSystem();
                            });
                        }
                    }

                    // Wire up logout button
                    const logoutBtn = document.getElementById('logoutBtn');
                    if (logoutBtn) {
                        logoutBtn.onclick = async () => {
                            if (typeof logoutFirebaseUser === 'function') await logoutFirebaseUser();
                            showTeacherOverlay();
                        };
                    }

                } else {
                    // Not authenticated — show login overlay
                    showTeacherOverlay();
                }
            });

        } else {
            // Firebase not configured / offline mode — check local session status
            const unlocked = sessionStorage.getItem('teacherUnlocked') === 'true';
            if (unlocked) {
                hideTeacherOverlay();
                init();
            } else {
                showTeacherOverlay();
            }
        }
    } else {
        // firebase-config.js not loaded — check local session status
        const unlocked = sessionStorage.getItem('teacherUnlocked') === 'true';
        if (unlocked) {
            hideTeacherOverlay();
            init();
        } else {
            showTeacherOverlay();
        }
    }
});

// Apply school settings (field toggles, logo, colors etc.) loaded from Admin Dashboard
function applySchoolSettings(settings) {
    if (!settings) return;

    if (typeof applySystemTheme === 'function') {
        applySystemTheme(settings);
    }

    // Apply school logo if set in Admin and not already in schoolInfo
    if (settings.schoolLogo && !schoolInfo.schoolLogo) {
        schoolInfo.schoolLogo = settings.schoolLogo;
        const logoEl = document.getElementById('logoPreview');
        if (logoEl) logoEl.innerHTML = `<img src="${settings.schoolLogo}" alt="school logo">`;
    }

    // Apply school name
    if (settings.schoolName && !schoolInfo.schoolName) {
        schoolInfo.schoolName = settings.schoolName;
    }

    // Apply headteacher signature
    if (settings.signature && !schoolInfo.headteacherSignature) {
        schoolInfo.headteacherSignature = settings.signature;
    }

    // Store field toggles for use in PDF generation
    if (settings.fieldToggles) {
        window._reportFieldToggles = settings.fieldToggles;
    }
}

window.addEventListener('storage', (e) => {
    if (e.key === 'schoolSettings') {
        try {
            const s = JSON.parse(e.newValue || '{}');
            applySchoolSettings(s);
        } catch (err) {}
    }
});

window.addEventListener('schoolSettingsUpdated', (e) => {
    applySchoolSettings(e.detail);
});

// Helper: check if a report field should be displayed
// Usage: if (reportFieldEnabled('showAttendance')) { ... }
function reportFieldEnabled(key, defaultValue = true) {
    const toggles = window._reportFieldToggles || {};
    return key in toggles ? toggles[key] : defaultValue;
}
