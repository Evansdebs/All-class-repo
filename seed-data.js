/* OneReal live bootstrap — school shell only. No demo students or staff. */
(function seedOneRealLive() {
    'use strict';
    var LIVE_VERSION = '2026-08-19-live1';
    try {
        if (localStorage.getItem('onerealSeedVersion') === LIVE_VERSION) return;
    } catch (e) { return; }

    function read(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) { return fallback; }
    }
    function set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    var prev = localStorage.getItem('onerealSeedVersion') || '';
    var wipingDemo = prev.indexOf('2026-08-19') === 0 && prev.indexOf('live') === -1;

    var subjects = [
        'English Language', 'Mathematics', 'Science', 'RME', 'History',
        'Creative Arts', 'Computing', 'French', 'Asante Twi', 'Career Technology'
    ];
    var classes = [
        { id: 'cls1', name: 'Class 1', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' },
        { id: 'cls2', name: 'Class 2', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' },
        { id: 'cls3', name: 'Class 3', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' },
        { id: 'cls4', name: 'Class 4', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' },
        { id: 'cls5', name: 'Class 5', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' },
        { id: 'cls6', name: 'Class 6', level: 'Primary', gradingScaleId: 'preset_ghana_primary', classTeacherId: '', classTeacherName: '', status: 'active' }
    ];
    var subjectDocs = subjects.map(function (name, i) {
        return {
            id: 'sub' + (i + 1),
            code: name.slice(0, 4).toUpperCase().replace(/\s/g, ''),
            name: name,
            classIds: ['cls1', 'cls2', 'cls3', 'cls4', 'cls5', 'cls6'],
            status: 'active'
        };
    });
    var academicYears = [{ id: 'ay2025', name: '2025/2026', isActive: true, isArchived: false }];
    var terms = [
        { id: 'term1', name: 'First Term', yearId: 'ay2025', termNumber: 1, isActive: true, isClosed: false },
        { id: 'term2', name: 'Second Term', yearId: 'ay2025', termNumber: 2, isActive: false, isClosed: false },
        { id: 'term3', name: 'Third Term', yearId: 'ay2025', termNumber: 3, isActive: false, isClosed: false }
    ];
    var gradingScales = [{
        id: 'gs-primary',
        name: 'Ghana Primary Grading System',
        isActive: true,
        items: [
            { min: 80, max: 100, grade: 'A', remark: 'ADVANCE' },
            { min: 68, max: 79, grade: 'P', remark: 'PROFICIENCY' },
            { min: 54, max: 67, grade: 'AP', remark: 'APPROACHING PROFICIENCY' },
            { min: 40, max: 53, grade: 'D', remark: 'DEVELOPING' },
            { min: 0, max: 39, grade: 'B', remark: 'BEGINNER' }
        ]
    }];
    var existingSettings = read('schoolSettings', {});
    var schoolSettings = {
        schoolName: existingSettings.schoolName || 'The Living Spring School',
        motto: existingSettings.motto || 'Drink deep or taste not the spring of knowledge',
        address: existingSettings.address || 'P.O. Box 16493 K.I.A, Accra',
        phone: existingSettings.phone || '',
        email: existingSettings.email || '',
        reportTitle: existingSettings.reportTitle || 'END OF TERM REPORT SHEET',
        closingDate: existingSettings.closingDate || '',
        reopeningDate: existingSettings.reopeningDate || '',
        headTeacher: existingSettings.headTeacher || '',
        primaryColor: existingSettings.primaryColor || '#1a56db',
        secondaryColor: existingSettings.secondaryColor || '#7e3af2',
        headerTextColor: existingSettings.headerTextColor || '#ffffff',
        schoolLogo: existingSettings.schoolLogo || null,
        signature: existingSettings.signature || null,
        fieldToggles: existingSettings.fieldToggles || {}
    };
    var schoolInfo = {
        academicYear: '2025/2026',
        term: '1',
        closingDate: schoolSettings.closingDate || '',
        reopeningDate: schoolSettings.reopeningDate || '',
        classTeacher: '',
        headTeacher: schoolSettings.headTeacher || '',
        schoolLogo: schoolSettings.schoolLogo || null,
        numberOnRollByClass: {}
    };

    // Always replace demo people / marks. Keep school shell.
    set('students', []);
    set('teachers', []);
    set('users', []);
    set('results', []);
    set('reports', []);
    set('scores', {});
    set('studentReportDetails', {});
    set('parentContacts', {});
    set('attendanceMarks', {});
    set('attendanceSettings', { defaultDays: {}, studentDays: {}, studentPresentOverride: {}, updatedAt: new Date().toISOString() });
    set('auditLogs', [{
        id: 'log-live-start',
        user: 'System',
        role: 'Admin',
        action: wipingDemo ? 'Demo Data Cleared' : 'Live School Started',
        details: 'Ready for real students, teachers and scores',
        timestamp: new Date().toISOString(),
        formattedTime: new Date().toLocaleString()
    }]);

    if (!read('classes', []).length || wipingDemo) set('classes', classes);
    if (!read('subjects', []).length || wipingDemo) set('subjects', subjectDocs);
    if (!read('academicYears', []).length || wipingDemo) set('academicYears', academicYears);
    if (!read('terms', []).length || wipingDemo) set('terms', terms);
    if (!read('gradingScales', []).length || wipingDemo) set('gradingScales', gradingScales);
    set('activeGradingScale', gradingScales[0].items);
    set('activeAcademicYear', academicYears[0]);
    set('activeTerm', terms[0]);
    set('schoolSettings', schoolSettings);
    set('schoolInfo', schoolInfo);
    localStorage.setItem('onerealSeedVersion', LIVE_VERSION);

    try {
        fetch('/api/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                students: [],
                teachers: [],
                users: [],
                classes: read('classes', classes),
                subjects: read('subjects', subjectDocs),
                academicYears: academicYears,
                terms: terms,
                gradingScales: gradingScales,
                results: [],
                reports: [],
                scores: {},
                schoolInfo: schoolInfo,
                schoolSettings: schoolSettings,
                studentReportDetails: {},
                parentContacts: {},
                attendanceMarks: {},
                attendanceSettings: read('attendanceSettings', {}),
                auditLogs: read('auditLogs', [])
            })
        }).catch(function () {});
    } catch (e) {}

    console.log('OneReal live school ready — add real teachers and students.');
})();
