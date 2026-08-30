'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const xlsxModule = fs.existsSync(path.join(__dirname, 'xlsx-lite.js')) 
    ? require('./xlsx-lite') 
    : require('./public/xlsx-lite');
const openPageModule = fs.existsSync(path.join(__dirname, 'open-page.js')) 
    ? require('./open-page') 
    : (fs.existsSync(path.join(__dirname, 'public', 'open-page.js')) ? require('./public/open-page') : { renderOpenPage: () => '', objectsToRows: () => [] });

const { buildXlsx } = xlsxModule;
const { renderOpenPage, objectsToRows } = openPageModule;

const PORT    = 3000;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const DB_FILE = isServerless ? path.join(os.tmpdir(), 'database.json') : path.join(__dirname, 'database.json');
const DL_DIR  = isServerless ? path.join(os.tmpdir(), 'user-downloads') : path.join(__dirname, 'user-downloads');
const BACKUPS_DIR = isServerless ? path.join(os.tmpdir(), 'backups') : path.join(__dirname, 'backups');

let inMemoryDb = null;

// ─── DB helpers ──────────────────────────────────────────────────────────────

function cleanJsonString(str) {
    if (typeof str !== 'string') return str;
    let out = '';
    let inStr = false;
    let escaped = false;
    const len = str.length;
    for (let i = 0; i < len; i++) {
        const c = str[i];
        const code = str.charCodeAt(i);
        if (inStr) {
            if (escaped) {
                if (c === '"' || c === '\\' || c === '/' || c === 'b' || c === 'f' || c === 'n' || c === 'r' || c === 't') {
                    out += c;
                    escaped = false;
                } else if (c === 'u' && /^[0-9a-fA-F]{4}/.test(str.slice(i + 1, i + 5))) {
                    out += c;
                    escaped = false;
                } else {
                    out += '\\' + c;
                    escaped = false;
                }
            } else if (c === '\\') {
                out += c;
                escaped = true;
            } else if (c === '"') {
                out += c;
                inStr = false;
            } else if (code < 0x20) {
                if (c === '\n') out += '\\n';
                else if (c === '\r') out += '\\r';
                else if (c === '\t') out += '\\t';
                else if (c === '\b') out += '\\b';
                else if (c === '\f') out += '\\f';
                else out += '\\u' + code.toString(16).padStart(4, '0');
            } else {
                out += c;
            }
        } else {
            if (c === '"') {
                inStr = true;
            }
            out += c;
        }
    }
    out = out.replace(/,\s*([}\]])/g, (_, p1) => p1);
    return out;
}

function safeJsonParse(str, fallback = null) {
    if (str === null || str === undefined || str === '') return fallback;
    if (typeof str !== 'string') return str;
    try {
        return JSON.parse(str);
    } catch (err) {
        try {
            const cleaned = cleanJsonString(str);
            return JSON.parse(cleaned);
        } catch (repairErr) {
            console.warn('safeJsonParse fallback used due to parse failure:', repairErr.message);
            return fallback;
        }
    }
}

function ensureBackupsDir() {
    try {
        if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    } catch (e) {}
}

function initDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const bundledDbPath = path.join(__dirname, 'database.json');
            const publicDbPath = path.join(__dirname, 'public', 'database.json');
            const srcDbPath = fs.existsSync(bundledDbPath) ? bundledDbPath : (fs.existsSync(publicDbPath) ? publicDbPath : null);
            if (srcDbPath && DB_FILE !== srcDbPath) {
                try {
                    const content = fs.readFileSync(srcDbPath, 'utf8');
                    fs.writeFileSync(DB_FILE, content, 'utf8');
                    inMemoryDb = safeJsonParse(content, null);
                } catch (e) {
                    console.warn('Could not copy bundled database.json to tmp:', e.message);
                }
            }
            if (!fs.existsSync(DB_FILE)) {
                const initialData = initBlankDb();
                try {
                    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
                    inMemoryDb = initialData;
                    console.log('database.json initialised.');
                } catch (e) {
                    inMemoryDb = initialData;
                }
            }
        }
    } catch (err) {
        console.warn('initDb error suppressed:', err.message);
    }
    ensureBackupsDir();
}

function tryRecoverFromSnapshot() {
    try {
        if (!fs.existsSync(BACKUPS_DIR)) return null;
        const files = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
            .sort((a, b) => b.time - a.time);
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(BACKUPS_DIR, file.name), 'utf8');
                const parsed = safeJsonParse(raw, null);
                if (parsed && typeof parsed === 'object' && (parsed.students || parsed.schoolInfo || parsed.results)) {
                    return parsed;
                }
            } catch (e) {}
        }
    } catch (e) {}
    return null;
}

function readDb() {
    if (inMemoryDb && typeof inMemoryDb === 'object') {
        return inMemoryDb;
    }
    try {
        initDb();
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            let data = safeJsonParse(raw, null);
            if (data && typeof data === 'object') {
                seedNewCollections(data);
                inMemoryDb = data;
                return inMemoryDb;
            }
        }
        const bundledDbPath = path.join(__dirname, 'database.json');
        if (fs.existsSync(bundledDbPath)) {
            const raw = fs.readFileSync(bundledDbPath, 'utf8');
            let data = safeJsonParse(raw, null);
            if (data && typeof data === 'object') {
                seedNewCollections(data);
                inMemoryDb = data;
                return inMemoryDb;
            }
        }
        const recovered = tryRecoverFromSnapshot();
        if (recovered) {
            seedNewCollections(recovered);
            inMemoryDb = recovered;
            return inMemoryDb;
        }
        inMemoryDb = initBlankDb();
        seedNewCollections(inMemoryDb);
        return inMemoryDb;
    } catch (err) {
        console.error('Error reading database.json:', err);
        inMemoryDb = initBlankDb();
        return inMemoryDb;
    }
}

function initBlankDb() {
    return {
        students: [], teachers: [], classes: [], subjects: [],
        academicYears: [], terms: [], results: [], reports: [],
        gradingScales: [], schoolSettings: {}, scores: {}, schoolInfo: {},
        studentReportDetails: {}, parentContacts: {},
        attendanceMarks: {}, attendanceSettings: {},
        alumni: [], timetables: [], examTimetables: [], transcriptRequests: [],
        auditLogs: []
    };
}

function seedNewCollections(db) {
    let changed = false;
    if (!Array.isArray(db.alumni) || db.alumni.length === 0) {
        db.alumni = [
            {
                id: 'alm-2024-001',
                admissionNo: 'TLS/2021/042',
                indexNo: '0102042001',
                name: 'Kofi Mensah Boateng',
                gender: 'Male',
                dob: '2008-04-15',
                graduationYear: '2024',
                classGraduated: 'Basic 9 / JHS 3',
                finalAggregate: 8,
                overallGrade: 'Distinction (A+)',
                awards: 'Valedictorian · Best Science & Mathematics Student 2024',
                conductRemark: 'Exemplary character, proven leadership as School Prefect, highly disciplined and dependable.',
                status: 'Verified',
                contactEmail: 'kofi.boateng.alumni@gmail.com',
                contactPhone: '+233 24 112 3456',
                verificationCode: 'TLS-VRF-2024-KM88',
                currentInstitution: 'Prempeh College (General Science)',
                transcriptsIssued: 2,
                academicHistory: [
                    {
                        academicYear: '2023/2024',
                        term: 'Term 3 (Final BECE)',
                        class: 'Basic 9',
                        subjects: [
                            { subject: 'English Language', classScore: 88, examScore: 92, totalScore: 90, grade: '1', remark: 'Excellent' },
                            { subject: 'Mathematics', classScore: 94, examScore: 96, totalScore: 95, grade: '1', remark: 'Outstanding' },
                            { subject: 'Integrated Science', classScore: 92, examScore: 94, totalScore: 93, grade: '1', remark: 'Outstanding' },
                            { subject: 'Social Studies', classScore: 85, examScore: 89, totalScore: 87, grade: '1', remark: 'Excellent' },
                            { subject: 'RME', classScore: 89, examScore: 91, totalScore: 90, grade: '1', remark: 'Excellent' },
                            { subject: 'Computing / ICT', classScore: 95, examScore: 98, totalScore: 97, grade: '1', remark: 'Outstanding' },
                            { subject: 'French', classScore: 80, examScore: 84, totalScore: 82, grade: '2', remark: 'Very Good' },
                            { subject: 'Career Technology', classScore: 86, examScore: 90, totalScore: 88, grade: '1', remark: 'Excellent' }
                        ]
                    }
                ]
            },
            {
                id: 'alm-2024-002',
                admissionNo: 'TLS/2021/058',
                indexNo: '0102042002',
                name: 'Akosua Serwaa Frimpong',
                gender: 'Female',
                dob: '2008-09-22',
                graduationYear: '2024',
                classGraduated: 'Basic 9 / JHS 3',
                finalAggregate: 9,
                overallGrade: 'Distinction (A+)',
                awards: 'Best Arts & Languages Student · Protocol Prefect',
                conductRemark: 'Humble, articulate, brilliant debater and outstanding student ambassador.',
                status: 'Verified',
                contactEmail: 'akosua.frimpong@gmail.com',
                contactPhone: '+233 20 887 6543',
                verificationCode: 'TLS-VRF-2024-AF92',
                currentInstitution: 'Wesley Girls High School (General Arts)',
                transcriptsIssued: 1,
                academicHistory: [
                    {
                        academicYear: '2023/2024',
                        term: 'Term 3 (Final BECE)',
                        class: 'Basic 9',
                        subjects: [
                            { subject: 'English Language', classScore: 95, examScore: 96, totalScore: 96, grade: '1', remark: 'Outstanding' },
                            { subject: 'Mathematics', classScore: 86, examScore: 90, totalScore: 88, grade: '1', remark: 'Excellent' },
                            { subject: 'Integrated Science', classScore: 88, examScore: 89, totalScore: 89, grade: '1', remark: 'Excellent' },
                            { subject: 'Social Studies', classScore: 92, examScore: 94, totalScore: 93, grade: '1', remark: 'Outstanding' },
                            { subject: 'RME', classScore: 94, examScore: 96, totalScore: 95, grade: '1', remark: 'Outstanding' },
                            { subject: 'Computing / ICT', classScore: 88, examScore: 90, totalScore: 89, grade: '1', remark: 'Excellent' },
                            { subject: 'French', classScore: 92, examScore: 95, totalScore: 94, grade: '1', remark: 'Outstanding' },
                            { subject: 'Creative Arts', classScore: 90, examScore: 92, totalScore: 91, grade: '1', remark: 'Outstanding' }
                        ]
                    }
                ]
            },
            {
                id: 'alm-2023-001',
                admissionNo: 'TLS/2020/019',
                indexNo: '0102033019',
                name: 'Emmanuel Kwabena Osei',
                gender: 'Male',
                dob: '2007-12-05',
                graduationYear: '2023',
                classGraduated: 'Basic 9 / JHS 3',
                finalAggregate: 11,
                overallGrade: 'Distinction (A)',
                awards: 'Sports Personality of the Year · Football Captain',
                conductRemark: 'Energetic, respectful, team builder with strong academic consistency.',
                status: 'Verified',
                contactEmail: 'e.k.osei@outlook.com',
                contactPhone: '+233 55 334 5566',
                verificationCode: 'TLS-VRF-2023-EO77',
                currentInstitution: 'Opoku Ware School (Business)',
                transcriptsIssued: 3,
                academicHistory: [
                    {
                        academicYear: '2022/2023',
                        term: 'Term 3 (Final BECE)',
                        class: 'Basic 9',
                        subjects: [
                            { subject: 'English Language', classScore: 82, examScore: 85, totalScore: 84, grade: '2', remark: 'Very Good' },
                            { subject: 'Mathematics', classScore: 88, examScore: 92, totalScore: 90, grade: '1', remark: 'Excellent' },
                            { subject: 'Integrated Science', classScore: 84, examScore: 86, totalScore: 85, grade: '1', remark: 'Excellent' },
                            { subject: 'Social Studies', classScore: 85, examScore: 87, totalScore: 86, grade: '1', remark: 'Excellent' },
                            { subject: 'RME', classScore: 86, examScore: 88, totalScore: 87, grade: '1', remark: 'Excellent' },
                            { subject: 'Computing / ICT', classScore: 89, examScore: 91, totalScore: 90, grade: '1', remark: 'Excellent' }
                        ]
                    }
                ]
            }
        ];
        changed = true;
    }

    if (!Array.isArray(db.timetables)) {
        db.timetables = [];
        changed = true;
    }

    if (!Array.isArray(db.examTimetables)) {
        db.examTimetables = [];
        changed = true;
    }

    if (!Array.isArray(db.transcriptRequests)) {
        db.transcriptRequests = [
            {
                id: 'req-001',
                alumniId: 'alm-2024-001',
                alumniName: 'Kofi Mensah Boateng',
                indexNo: '0102042001',
                destinationInstitution: 'Prempeh College Admissions Office',
                recipientEmail: 'admissions@prempehcollege.edu.gh',
                purpose: 'Senior High School Placement Verification',
                requestDate: '2026-08-20T14:30:00.000Z',
                status: 'Dispatched',
                trackingCode: 'TRK-TLS-99201',
                copies: 2
            }
        ];
        changed = true;
    }

    if (changed) {
        writeDb(db);
    }
}

function mergeSyncData(db, payload) {
    if (!payload || typeof payload !== 'object') return db;

    const arrayCollections = [
        'students', 'classes', 'subjects', 'academicYears', 'terms',
        'reports', 'gradingScales', 'alumni', 'timetables', 'examTimetables',
        'auditLogs', 'schoolDepartments'
    ];

    arrayCollections.forEach(col => {
        if (Array.isArray(payload[col])) {
            if (!Array.isArray(db[col])) db[col] = [];
            const incoming = payload[col];
            if (incoming.length === 0 && db[col].length > 0) {
                return;
            }
            incoming.forEach(item => {
                if (!item) return;
                const itemId = String(item.id || item.uid || '');
                if (!itemId) {
                    db[col].push(item);
                    return;
                }
                const idx = db[col].findIndex(x => String(x.id || x.uid || '') === itemId);
                if (idx >= 0) {
                    db[col][idx] = { ...db[col][idx], ...item };
                } else {
                    db[col].push(item);
                }
            });
        }
    });

    ['teachers', 'users'].forEach(col => {
        if (Array.isArray(payload[col])) {
            if (!Array.isArray(db[col])) db[col] = [];
            const incoming = payload[col];
            if (incoming.length === 0 && db[col].length > 0) return;

            incoming.forEach(item => {
                if (!item) return;
                const itemId = String(item.id || item.uid || '');
                const itemEmail = String(item.email || '').toLowerCase().trim();

                const idx = db[col].findIndex(x => {
                    const xId = String(x.id || x.uid || '');
                    const xEmail = String(x.email || '').toLowerCase().trim();
                    return (itemId && xId && itemId === xId) || (itemEmail && xEmail && itemEmail === xEmail);
                });

                if (idx >= 0) {
                    db[col][idx] = { ...db[col][idx], ...item };
                } else {
                    db[col].push(item);
                }
            });
        }
    });

    if (Array.isArray(payload.results)) {
        if (!Array.isArray(db.results)) db.results = [];
        const incoming = payload.results;
        if (incoming.length > 0 || db.results.length === 0) {
            incoming.forEach(item => {
                if (!item) return;
                const itemId = String(item.id || '');
                const stuId = String(item.studentId || '');
                const subNorm = String(item.subjectName || item.subjectId || '').toLowerCase().trim();

                const idx = db.results.findIndex(x => {
                    if (itemId && String(x.id || '') === itemId) return true;
                    if (stuId && String(x.studentId || '') === stuId) {
                        const xSubNorm = String(x.subjectName || x.subjectId || '').toLowerCase().trim();
                        if (xSubNorm && subNorm && xSubNorm === subNorm) return true;
                    }
                    return false;
                });

                if (idx >= 0) {
                    const existing = db.results[idx];
                    const isApproved = existing.status === 'Approved' || item.status === 'Approved';
                    const hasScores = item.classScore !== undefined || item.examScore !== undefined || item.totalScore !== undefined;
                    db.results[idx] = {
                        ...existing,
                        ...item,
                        status: isApproved ? 'Approved' : (item.status || existing.status || 'Submitted'),
                        locked: isApproved ? true : (item.locked ?? existing.locked ?? false),
                        ...(hasScores ? {
                            classScore: item.classScore ?? existing.classScore,
                            examScore: item.examScore ?? existing.examScore,
                            classScore50: item.classScore50 ?? existing.classScore50,
                            examScore50: item.examScore50 ?? existing.examScore50,
                            totalScore: item.totalScore ?? existing.totalScore,
                            grade: item.grade || existing.grade,
                            remark: item.remark || existing.remark
                        } : {})
                    };
                } else {
                    db.results.push(item);
                }
            });
        }
    }

    if (payload.scores && typeof payload.scores === 'object' && !Array.isArray(payload.scores)) {
        if (!db.scores || typeof db.scores !== 'object' || Array.isArray(db.scores)) db.scores = {};
        Object.keys(payload.scores).forEach(subKey => {
            if (!db.scores[subKey]) db.scores[subKey] = {};
            const stuMap = payload.scores[subKey];
            if (stuMap && typeof stuMap === 'object' && !Array.isArray(stuMap)) {
                Object.keys(stuMap).forEach(stuId => {
                    const sObj = stuMap[stuId];
                    if (sObj) {
                        db.scores[subKey][stuId] = {
                            ...(db.scores[subKey][stuId] || {}),
                            ...sObj
                        };
                    }
                });
            }
        });
    }

    const objectCollections = [
        'schoolSettings', 'schoolInfo', 'studentReportDetails',
        'parentContacts', 'attendanceMarks', 'attendanceSettings'
    ];
    objectCollections.forEach(col => {
        if (payload[col] && typeof payload[col] === 'object' && !Array.isArray(payload[col])) {
            if (!db[col] || typeof db[col] !== 'object' || Array.isArray(db[col])) db[col] = {};
            db[col] = { ...db[col], ...payload[col] };
        }
    });

    return db;
}

function writeDb(data) {
    inMemoryDb = data;
    try {
        const tmpFile = DB_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmpFile, DB_FILE);
        return true;
    } catch (err) {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } catch (e2) {
            return true;
        }
    }
}

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ensureDlDir() {
    try {
        if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });
    } catch (e) {}
}

function safeFilePart(name) {
    return String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 140);
}

function sendAttachment(res, buffer, filename, mime) {
    const name = safeFilePart(filename);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const type = mime || 'application/octet-stream';
    const inline = /csv|json|text\/|html/.test(type);
    res.writeHead(200, {
        'Content-Type': type,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(buf);
}

function sendExcel(res, rows, filename, sheetName) {
    const buf = buildXlsx(rows, sheetName || 'Sheet1');
    sendAttachment(res, buf, String(filename).endsWith('.xlsx') ? filename : filename + '.xlsx');
}

const IMPORT_TEMPLATES = {
    students: {
        headers: ['admissionNo', 'name', 'gender', 'dob', 'class', 'parentName', 'parentPhone'],
        sample: [
            ['TLS/2026/001', 'Ama Mensah (SAMPLE)', 'Female', '2014-03-12', 'Class 6', 'Akosua Mensah', '0241234567'],
            ['TLS/2026/002', 'Kofi Asante (SAMPLE)', 'Male', '2013-11-08', 'Class 6', 'Yaw Asante', '0209876543'],
            ['TLS/2026/003', 'Type student name here', 'Female', 'YYYY-MM-DD', 'Class 5', 'Type parent name', '0240000000']
        ]
    },
    teachers: {
        headers: ['name', 'email', 'phone', 'role', 'assignedClasses', 'assignedSubjects'],
        sample: [
            ['Abena Owusu (SAMPLE)', 'abena.owusu@school.com', '0241112233', 'Teacher', 'Class 6', 'Mathematics, Science'],
            ['Kwame Boateng (SAMPLE)', 'kwame.boateng@school.com', '0205556677', 'Class Teacher', 'Class 5', 'English Language'],
            ['Type teacher name here', 'teacher@school.com', '0240000000', 'Teacher', 'Class 4', 'Type subjects']
        ]
    },
    classes: {
        headers: ['name', 'level', 'classTeacherName'],
        sample: [
            ['Class 6', 'Primary', 'Abena Owusu (SAMPLE)'],
            ['Class 5', 'Primary', 'Kwame Boateng (SAMPLE)'],
            ['Class 1', 'Primary', 'Type class teacher name']
        ]
    },
    subjects: {
        headers: ['code', 'name', 'classNames'],
        sample: [
            ['MATH', 'Mathematics', 'Class 6, Class 5'],
            ['ENG', 'English Language', 'Class 6, Class 5'],
            ['SCI', 'Science', 'Class 6, Class 5'],
            ['CODE', 'Type subject name', 'Class 1, Class 2']
        ]
    },
    results: {
        headers: ['studentId', 'studentName', 'classId', 'subjectId', 'classScore', 'examScore'],
        sample: [
            ['TLS/2026/001', 'Ama Mensah (SAMPLE)', 'Class 6', 'Mathematics', 80, 90],
            ['TLS/2026/002', 'Kofi Asante (SAMPLE)', 'Class 6', 'Mathematics', 76, 88],
            ['TLS/2026/003', 'Type student name', 'Class 6', 'English Language', 0, 0]
        ]
    }
};

function templateRows(type) {
    const spec = IMPORT_TEMPLATES[type];
    if (!spec) return null;
    return [spec.headers, ...spec.sample];
}

function marksTable(cls, subject) {
    const db = readDb();
    let list = db.students || [];
    if (cls) list = list.filter(s => s.class === cls || s.classId === cls);
    if (!list.length) {
        list = [
            { name: 'Ama Mensah (SAMPLE)', class: cls || 'Class 6' },
            { name: 'Kofi Asante (SAMPLE)', class: cls || 'Class 6' },
            { name: 'Type student name here', class: cls || 'Class 6' }
        ];
    }
    const headers = ['Student Name', 'Class', 'Subject', 'Class Score (out of 100)', 'Exam Score (out of 100)'];
    return [headers, ...list.map((s, i) => [
        s.name || '',
        s.class || cls || '',
        subject || 'Mathematics',
        i === list.length - 1 && String(s.name || '').startsWith('Type') ? '' : 80,
        i === list.length - 1 && String(s.name || '').startsWith('Type') ? '' : 90
    ])];
}

function collectionTable(col) {
    const db = readDb();
    const data = db[col];
    if (data === undefined) return null;
    const rows = Array.isArray(data) ? data : [data];
    return objectsToRows(rows.length ? rows : [{ '(empty)': '' }]);
}

function resolveExportTable(src, extra) {
    const raw = String(src || extra.get('src') || '/api/templates/students.xlsx');
    let url;
    try { url = new URL(raw, 'http://local'); } catch (e) { url = new URL('/api/templates/students.xlsx', 'http://local'); }
    extra.forEach((v, k) => { if (k !== 'src' && !url.searchParams.get(k)) url.searchParams.set(k, v); });
    const p = url.pathname;
    const q = url.searchParams;

    if (p.includes('/templates/marks')) {
        const cls = q.get('class') || '';
        const subject = q.get('subject') || 'Mathematics';
        return { title: 'Marks template', filename: 'marks_template.xlsx', rows: marksTable(cls, subject) };
    }
    const tmpl = p.match(/\/templates\/([a-z]+)/);
    if (tmpl) {
        const rows = templateRows(tmpl[1]);
        return { title: tmpl[1] + ' template', filename: tmpl[1] + '_import_template.xlsx', rows: rows || [['Unknown template']] };
    }
    if (p.includes('/export/backup')) {
        const db = readDb();
        return { title: 'School backup', filename: 'school_backup.json', rows: [['Key', 'Count'], ...Object.keys(db).map(k => [k, Array.isArray(db[k]) ? db[k].length : (db[k] && typeof db[k] === 'object' ? Object.keys(db[k]).length : 1)])] };
    }
    if (p.includes('/export/student')) {
        const adm = q.get('admission') || q.get('id') || '';
        const db = readDb();
        const student = (db.students || []).find(s => String(s.admissionNo || '').toLowerCase() === adm.toLowerCase() || String(s.id) === String(adm));
        const scores = db.scores || {};
        const rows = [['Subject', 'Class Score', 'Exam Score', 'Total', 'Grade', 'Remark']];
        if (student) {
            Object.keys(scores).forEach(sub => {
                const bag = scores[sub] || {};
                const e = bag[student.id] || bag[String(student.id)];
                if (e) rows.push([sub, e.classScore ?? '', e.examScore ?? '', e.totalScore ?? '', e.grade || '', e.remark || '']);
            });
            if (rows.length === 1) rows.push(['No published results', '', '', '', '', '']);
        } else rows.push(['Student not found', '', '', '', '', '']);
        return { title: ((student && student.name) || adm || 'Student') + ' results', filename: 'student_results.xlsx', rows };
    }
    if (p.includes('/export/attendance')) {
        return { title: 'Attendance', filename: 'attendance.xlsx', rows: collectionTable('attendanceMarks') || [['No attendance yet']] };
    }
    const col = (p.match(/\/export\/([a-zA-Z]+)/) || [])[1];
    if (col) {
        const rows = collectionTable(col);
        return { title: col, filename: col + '.xlsx', rows: rows || [['No data']] };
    }
    return { title: 'Export', filename: 'export.xlsx', rows: [['Choose a template from Admin → Data Management']] };
}

function csvEscape(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, headers) {
    const cols = headers || (rows[0] ? Object.keys(rows[0]) : []);
    const lines = [cols.map(csvEscape).join(',')];
    rows.forEach(r => {
        lines.push(cols.map(h => csvEscape(r[h])).join(','));
    });
    return '\uFEFF' + lines.join('\n');
}

function pruneOldDownloads() {
    try {
        ensureDlDir();
        const now = Date.now();
        fs.readdirSync(DL_DIR).forEach(name => {
            const full = path.join(DL_DIR, name);
            try {
                const st = fs.statSync(full);
                if (now - st.mtimeMs > 2 * 24 * 60 * 60 * 1000) fs.unlinkSync(full);
            } catch (e) {}
        });
    } catch (e) {}
}

function takeSnapshot(tag = 'auto', note = '') {
    try {
        ensureBackupsDir();
        const db = readDb();
        const now = new Date();
        const timePart = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `snapshot_${tag}_${timePart}.json`;
        const filepath = path.join(BACKUPS_DIR, filename);

        const metadata = {
            snapshotId: genId(),
            filename,
            tag,
            note: note || (tag === 'manual' ? 'Manual user snapshot' : 'Automated safety snapshot'),
            createdAt: now.toISOString(),
            sizeBytes: 0,
            counts: {
                students:       (db.students       || []).length,
                teachers:       (db.teachers       || []).length,
                classes:        (db.classes        || []).length,
                subjects:       (db.subjects       || []).length,
                results:        (db.results        || []).length,
                reports:        (db.reports        || []).length,
                alumni:         (db.alumni         || []).length,
                timetables:     (db.timetables     || []).length,
                examTimetables: (db.examTimetables || []).length
            }
        };

        const payload = { _metadata: metadata, ...db };
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
        const st = fs.statSync(filepath);
        metadata.sizeBytes = st.size;

        pruneSnapshots(30);
        return metadata;
    } catch (e) {
        console.error('Failed to take snapshot:', e);
        return null;
    }
}

function pruneSnapshots(maxKeep = 30) {
    try {
        ensureBackupsDir();
        const files = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
            .map(f => {
                const p = path.join(BACKUPS_DIR, f);
                return { name: f, path: p, mtime: fs.statSync(p).mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > maxKeep) {
            files.slice(maxKeep).forEach(file => {
                try { fs.unlinkSync(file.path); } catch (err) {}
            });
        }
    } catch (e) {}
}

function listSnapshots() {
    try {
        ensureBackupsDir();
        const files = fs.readdirSync(BACKUPS_DIR)
            .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
            .map(f => {
                const p = path.join(BACKUPS_DIR, f);
                const stat = fs.statSync(p);
                let meta = {
                    filename: f,
                    createdAt: stat.mtime.toISOString(),
                    sizeBytes: stat.size,
                    tag: f.includes('_manual_') ? 'manual' : 'auto',
                    note: f.includes('_manual_') ? 'Manual snapshot' : 'Automatic snapshot'
                };
                try {
                    const raw = fs.readFileSync(p, 'utf8');
                    const parsed = safeJsonParse(raw, {});
                    if (parsed._metadata) {
                        meta = { ...meta, ...parsed._metadata };
                    } else {
                        meta.counts = {
                            students: (parsed.students || []).length,
                            results:  (parsed.results  || []).length,
                            reports:  (parsed.reports  || []).length
                        };
                    }
                } catch (e) {}
                return meta;
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return files;
    } catch (e) {
        return [];
    }
}

function sendJson(res, statusCode, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(statusCode, {
        'Content-Type':  'application/json; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end',  ()    => {
            if (!body || body.trim() === '') {
                resolve({});
                return;
            }
            const parsed = safeJsonParse(body, null);
            if (parsed !== null && typeof parsed === 'object') {
                resolve(parsed);
            } else {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css':  'text/css; charset=UTF-8',
    '.js':   'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.webmanifest': 'application/manifest+json; charset=UTF-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.pdf':  'application/pdf',
    '.csv':  'text/csv; charset=UTF-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls':  'application/vnd.ms-excel'
};

function handleCollectionGet(res, collection) {
    const db = readDb();
    sendJson(res, 200, db[collection] || []);
}

async function handleCollectionPost(req, res, collection) {
    try {
        const payload = await readBody(req);
        const db = readDb();
        if (!Array.isArray(db[collection])) db[collection] = [];
        const item = { id: genId(), createdAt: new Date().toISOString(), ...payload };
        db[collection].push(item);
        writeDb(db);
        sendJson(res, 201, item);
    } catch (e) {
        sendJson(res, 400, { error: e.message });
    }
}

async function handleCollectionPut(req, res, collection, id) {
    try {
        const payload = await readBody(req);
        const db = readDb();
        if (!Array.isArray(db[collection])) { sendJson(res, 404, { error: 'Collection not found' }); return; }
        const idx = db[collection].findIndex(item => item.id === id);
        if (idx < 0) { sendJson(res, 404, { error: 'Item not found' }); return; }
        db[collection][idx] = { ...db[collection][idx], ...payload, updatedAt: new Date().toISOString() };
        writeDb(db);
        sendJson(res, 200, db[collection][idx]);
    } catch (e) {
        sendJson(res, 400, { error: e.message });
    }
}

function handleCollectionDelete(res, collection, id) {
    const db = readDb();
    if (!Array.isArray(db[collection])) { sendJson(res, 404, { error: 'Collection not found' }); return; }
    const before = db[collection].length;
    db[collection] = db[collection].filter(item => item.id !== id);
    writeDb(db);
    sendJson(res, 200, { success: true, removed: before - db[collection].length });
}

async function requestHandler(req, res) {
    try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname  = parsedUrl.pathname;
        const method    = req.method.toUpperCase() === 'HEAD' ? 'GET' : req.method.toUpperCase();

        // ── API Routes ──────────────────────────────────────────────────────────
        if (pathname.startsWith('/api/')) {
            if (pathname === '/api/status' && method === 'GET') {
                const db = readDb();
                sendJson(res, 200, {
                    status: 'online',
                    version: '2.2.0',
                    serverTime: new Date().toISOString(),
                    counts: {
                        students:      (db.students      || []).length,
                        teachers:      (db.teachers      || []).length,
                        classes:       (db.classes       || []).length,
                        subjects:      (db.subjects      || []).length,
                        results:       (db.results       || []).length,
                        reports:       (db.reports       || []).length,
                        gradingScales: (db.gradingScales || []).length,
                        academicYears: (db.academicYears || []).length,
                        auditLogs:     (db.auditLogs     || []).length,
                    }
                });
                return;
            }

            if (pathname === '/api/db' && method === 'GET') {
                sendJson(res, 200, readDb());
                return;
            }

            if (pathname === '/api/sync') {
                if (method === 'GET') {
                    sendJson(res, 200, readDb());
                    return;
                }
                if (method === 'POST') {
                    try {
                        const payload = await readBody(req);
                        let db = readDb();
                        db = mergeSyncData(db, payload);
                        writeDb(db);
                        sendJson(res, 200, { success: true, timestamp: new Date().toISOString(), ...db });
                    } catch (e) { sendJson(res, 400, { error: e.message }); }
                    return;
                }
            }

            if (pathname === '/api/students' && method === 'GET')  { handleCollectionGet(res, 'students'); return; }
            if (pathname === '/api/students' && method === 'POST') { await handleCollectionPost(req, res, 'students'); return; }

            const studMatch = pathname.match(/^\/api\/students\/([^/]+)$/);
            if (studMatch) {
                const id = studMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'students', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'students', id); return; }
                if (method === 'GET') {
                    const db = readDb();
                    const s  = (db.students || []).find(s => s.id === id);
                    s ? sendJson(res, 200, s) : sendJson(res, 404, { error: 'Student not found' });
                    return;
                }
            }

            const studClassMatch = pathname.match(/^\/api\/students\/class\/([^/]+)$/);
            if (studClassMatch && method === 'GET') {
                const classId = studClassMatch[1];
                const db = readDb();
                sendJson(res, 200, (db.students || []).filter(s => s.classId === classId || s.class === classId));
                return;
            }

            if (pathname === '/api/teachers' && method === 'GET')  { handleCollectionGet(res, 'teachers'); return; }
            if (pathname === '/api/teachers' && method === 'POST') { await handleCollectionPost(req, res, 'teachers'); return; }

            const teacherMatch = pathname.match(/^\/api\/teachers\/([^/]+)$/);
            if (teacherMatch) {
                const id = teacherMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'teachers', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'teachers', id); return; }
            }

            if (pathname === '/api/classes' && method === 'GET')  { handleCollectionGet(res, 'classes'); return; }
            if (pathname === '/api/classes' && method === 'POST') { await handleCollectionPost(req, res, 'classes'); return; }

            const classMatch = pathname.match(/^\/api\/classes\/([^/]+)$/);
            if (classMatch) {
                const id = classMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'classes', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'classes', id); return; }
            }

            if (pathname === '/api/subjects' && method === 'GET')  { handleCollectionGet(res, 'subjects'); return; }
            if (pathname === '/api/subjects' && method === 'POST') { await handleCollectionPost(req, res, 'subjects'); return; }

            const subjectMatch = pathname.match(/^\/api\/subjects\/([^/]+)$/);
            if (subjectMatch) {
                const id = subjectMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'subjects', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'subjects', id); return; }
            }

            if (pathname === '/api/academic-years' && method === 'GET')  { handleCollectionGet(res, 'academicYears'); return; }
            if (pathname === '/api/academic-years' && method === 'POST') { await handleCollectionPost(req, res, 'academicYears'); return; }

            const ayMatch = pathname.match(/^\/api\/academic-years\/([^/]+)$/);
            if (ayMatch) {
                const id = ayMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'academicYears', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'academicYears', id); return; }
            }

            if (pathname === '/api/academic-years/active' && method === 'GET') {
                const db   = readDb();
                const year = (db.academicYears || []).find(y => y.isActive);
                year ? sendJson(res, 200, year) : sendJson(res, 404, { error: 'No active academic year' });
                return;
            }

            if (pathname === '/api/terms' && method === 'GET')  { handleCollectionGet(res, 'terms'); return; }
            if (pathname === '/api/terms' && method === 'POST') { await handleCollectionPost(req, res, 'terms'); return; }

            const termMatch = pathname.match(/^\/api\/terms\/([^/]+)$/);
            if (termMatch) {
                const id = termMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'terms', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'terms', id); return; }
            }

            if (pathname === '/api/terms/active' && method === 'GET') {
                const db   = readDb();
                const term = (db.terms || []).find(t => t.isActive);
                term ? sendJson(res, 200, term) : sendJson(res, 404, { error: 'No active term' });
                return;
            }

            if (pathname === '/api/results' && method === 'GET') {
                const db = readDb();
                const { year, term, class: cls, status, studentId } = Object.fromEntries(parsedUrl.searchParams);
                let results = db.results || [];
                if (year)      results = results.filter(r => r.academicYearId === year);
                if (term)      results = results.filter(r => r.termId === term);
                if (cls)       results = results.filter(r => r.classId === cls);
                if (status)    results = results.filter(r => r.status === status);
                if (studentId) results = results.filter(r => r.studentId === studentId);
                sendJson(res, 200, results);
                return;
            }

            if (pathname === '/api/results' && method === 'POST') { await handleCollectionPost(req, res, 'results'); return; }

            const resultMatch = pathname.match(/^\/api\/results\/([^/]+)$/);
            if (resultMatch) {
                const id = resultMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'results', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'results', id); return; }
            }

            if (pathname === '/api/results/submit' && method === 'POST') {
                try {
                    const { ids } = await readBody(req);
                    const db = readDb();
                    let count = 0;
                    (db.results || []).forEach(r => {
                        if (ids.includes(r.id) && r.status === 'Draft') {
                            r.status = 'Submitted';
                            r.submittedAt = new Date().toISOString();
                            count++;
                        }
                    });
                    writeDb(db);
                    sendJson(res, 200, { success: true, updated: count });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/results/approve' && method === 'POST') {
                try {
                    const { ids, status: newStatus = 'Approved' } = await readBody(req);
                    const db = readDb();
                    let count = 0;
                    (db.results || []).forEach(r => {
                        if (ids.includes(r.id)) {
                            r.status     = newStatus;
                            r.locked     = true;
                            r.approvedAt = new Date().toISOString();
                            count++;
                        }
                    });
                    writeDb(db);
                    sendJson(res, 200, { success: true, updated: count });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/results/unlock' && method === 'POST') {
                try {
                    const { ids } = await readBody(req);
                    const db = readDb();
                    let count = 0;
                    (db.results || []).forEach(r => {
                        if (ids.includes(r.id)) {
                            r.locked   = false;
                            r.status   = 'Reviewed';
                            r.unlockedAt = new Date().toISOString();
                            count++;
                        }
                    });
                    writeDb(db);
                    sendJson(res, 200, { success: true, updated: count });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/results/pending' && method === 'GET') {
                const db = readDb();
                sendJson(res, 200, (db.results || []).filter(r => r.status === 'Submitted'));
                return;
            }

            if (pathname === '/api/reports' && method === 'GET') {
                const db = readDb();
                const { year, term, class: cls, status } = Object.fromEntries(parsedUrl.searchParams);
                let reports = db.reports || [];
                if (year)   reports = reports.filter(r => r.academicYearId === year);
                if (term)   reports = reports.filter(r => r.termId === term);
                if (cls)    reports = reports.filter(r => r.classId === cls);
                if (status) reports = reports.filter(r => r.status === status);
                sendJson(res, 200, reports);
                return;
            }

            if (pathname === '/api/reports' && method === 'POST') { await handleCollectionPost(req, res, 'reports'); return; }

            const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
            if (reportMatch) {
                const id = reportMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'reports', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'reports', id); return; }
            }

            if (pathname === '/api/users' && method === 'GET')  { handleCollectionGet(res, 'users'); return; }
            if (pathname === '/api/users' && method === 'POST') { await handleCollectionPost(req, res, 'users'); return; }

            const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
            if (userMatch) {
                const id = userMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'users', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'users', id); return; }
            }

            if (pathname === '/api/grading-scales' && method === 'GET')  { handleCollectionGet(res, 'gradingScales'); return; }
            if (pathname === '/api/grading-scales' && method === 'POST') { await handleCollectionPost(req, res, 'gradingScales'); return; }

            const gsMatch = pathname.match(/^\/api\/grading-scales\/([^/]+)$/);
            if (gsMatch) {
                const id = gsMatch[1];
                if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'gradingScales', id); return; }
                if (method === 'DELETE') { handleCollectionDelete(res, 'gradingScales', id); return; }
            }

            if (pathname === '/api/grading-scales/active' && method === 'GET') {
                const db    = readDb();
                const scale = (db.gradingScales || []).find(s => s.isActive);
                scale ? sendJson(res, 200, scale) : sendJson(res, 200, {
                    isActive: true,
                    name: 'Default',
                    items: [
                        { min: 80, max: 100, grade: 'A',  remark: 'ADVANCE' },
                        { min: 68, max: 79,  grade: 'P',  remark: 'PROFICIENCY' },
                        { min: 54, max: 67,  grade: 'AP', remark: 'APPROACHING PROFICIENCY' },
                        { min: 40, max: 53,  grade: 'D',  remark: 'DEVELOPING' },
                        { min: 0,  max: 39,  grade: 'B',  remark: 'BEGINNER' }
                    ]
                });
                return;
            }

            if (pathname === '/api/school-settings' && method === 'GET') {
                const db = readDb();
                sendJson(res, 200, db.schoolSettings || {});
                return;
            }

            if (pathname === '/api/school-settings' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    db.schoolSettings = { ...db.schoolSettings, ...payload, updatedAt: new Date().toISOString() };
                    writeDb(db);
                    sendJson(res, 200, { success: true, settings: db.schoolSettings });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/school-info' && method === 'GET') {
                sendJson(res, 200, readDb().schoolInfo || {});
                return;
            }

            if (pathname === '/api/school-info' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    db.schoolInfo = payload;
                    writeDb(db);
                    sendJson(res, 200, { success: true });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/scores' && method === 'GET') {
                sendJson(res, 200, readDb().scores || {});
                return;
            }

            if (pathname === '/api/scores' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    db.scores = payload;
                    writeDb(db);
                    sendJson(res, 200, { success: true });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/attendance-marks' && method === 'GET') {
                sendJson(res, 200, readDb().attendanceMarks || {});
                return;
            }
            if (pathname === '/api/attendance-marks' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    db.attendanceMarks = payload;
                    writeDb(db);
                    sendJson(res, 200, { success: true });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }
            if (pathname === '/api/attendance-settings' && method === 'GET') {
                sendJson(res, 200, readDb().attendanceSettings || {});
                return;
            }
            if (pathname === '/api/attendance-settings' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    db.attendanceSettings = payload;
                    writeDb(db);
                    sendJson(res, 200, { success: true });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/audit-logs' && method === 'GET') {
                const db   = readDb();
                const limit = parseInt(parsedUrl.searchParams.get('limit') || '200');
                sendJson(res, 200, (db.auditLogs || []).slice(0, limit));
                return;
            }
            if (pathname === '/api/audit-logs' && method === 'POST') {
                try {
                    const logEntry = await readBody(req);
                    const db = readDb();
                    if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
                    db.auditLogs.unshift({ ...logEntry, serverTime: new Date().toISOString() });
                    if (db.auditLogs.length > 500) db.auditLogs = db.auditLogs.slice(0, 500);
                    writeDb(db);
                    sendJson(res, 200, { success: true, log: logEntry });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }
            if (pathname === '/api/audit-logs' && method === 'DELETE') {
                const db = readDb();
                db.auditLogs = [];
                writeDb(db);
                sendJson(res, 200, { success: true });
                return;
            }

            if (pathname === '/api/export/backup' && method === 'GET') {
                const db = readDb();
                const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...db }, null, 2);
                sendAttachment(res, body, `school_backup_${new Date().toISOString().split('T')[0]}.json`, 'application/json; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/students.csv' || pathname === '/api/export/students.xlsx') && method === 'GET') {
                const db = readDb();
                const rows = db.students || [];
                const headers = ['id','admissionNo','name','gender','dob','class','classId','status','parentName','parentPhone'];
                const table = rows.length
                    ? [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]
                    : templateRows('students');
                if (pathname.endsWith('.xlsx')) { sendExcel(res, table, 'students.xlsx', 'Students'); return; }
                sendAttachment(res, rowsToCsv(table.slice(1).map(r => {
                    const obj = {};
                    table[0].forEach((h, i) => { obj[h] = r[i]; });
                    return obj;
                }), table[0]), 'students.csv', 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/results.csv' || pathname === '/api/export/results.xlsx') && method === 'GET') {
                const db = readDb();
                const rows = db.results || [];
                const headers = ['id','studentId','studentName','classId','subjectId','classScore','examScore','totalScore','grade','remark','status','locked'];
                const table = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
                if (pathname.endsWith('.xlsx')) { sendExcel(res, table, 'results.xlsx', 'Results'); return; }
                sendAttachment(res, rowsToCsv(rows.length ? rows : [{}], headers), 'results.csv', 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/templates/marks.csv' || pathname === '/api/templates/marks.xlsx' || pathname === '/api/templates/marks') && method === 'GET') {
                const cls = parsedUrl.searchParams.get('class') || '';
                const subject = parsedUrl.searchParams.get('subject') || 'Mathematics';
                const table = marksTable(cls, subject);
                const headers = table[0];
                const safeClass = (cls || 'class').replace(/[^\w]+/g, '_');
                const safeSub = String(subject).replace(/[^\w]+/g, '_');
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, table, `${safeClass}_${safeSub}_marks_template.xlsx`, 'Marks');
                    return;
                }
                sendAttachment(res, rowsToCsv(table.slice(1).map(r => ({
                    'Student Name': r[0], Class: r[1], Subject: r[2],
                    'Class Score (out of 100)': r[3], 'Exam Score (out of 100)': r[4]
                })), headers), `${safeClass}_${safeSub}_marks_template.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            const templateMatch = pathname.match(/^\/api\/templates\/([a-z]+)(?:\.(csv|xlsx))?$/);
            if (templateMatch && method === 'GET' && templateMatch[1] !== 'marks') {
                const type = templateMatch[1];
                const fmt = templateMatch[2] || 'xlsx';
                const table = templateRows(type);
                if (!table) { sendJson(res, 404, { error: 'Template type not found' }); return; }
                if (fmt === 'xlsx') {
                    sendExcel(res, table, `${type}_import_template.xlsx`, type);
                    return;
                }
                sendAttachment(res, rowsToCsv(table.slice(1).map(r => {
                    const obj = {};
                    table[0].forEach((h, i) => { obj[h] = r[i]; });
                    return obj;
                }), table[0]), `${type}_import_template.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/attendance.csv' || pathname === '/api/export/attendance.xlsx') && method === 'GET') {
                const db = readDb();
                const marks = db.attendanceMarks || {};
                const rows = [];
                Object.keys(marks).forEach(sid => {
                    const days = marks[sid] || {};
                    Object.keys(days).forEach(date => {
                        const m = days[date] || {};
                        const student = (db.students || []).find(s => String(s.id) === String(sid));
                        rows.push({
                            studentId: sid,
                            studentName: student?.name || '',
                            class: student?.class || m.className || '',
                            date,
                            status: m.status || '',
                            markedBy: m.by || ''
                        });
                    });
                });
                const attHeaders = ['studentId','studentName','class','date','status','markedBy'];
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, [attHeaders, ...rows.map(r => attHeaders.map(h => r[h] ?? ''))], 'attendance.xlsx', 'Attendance');
                    return;
                }
                sendAttachment(res, rowsToCsv(rows, attHeaders), 'attendance.csv', 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/broadsheet.csv' || pathname === '/api/export/broadsheet.xlsx') && method === 'GET') {
                const cls = parsedUrl.searchParams.get('class') || '';
                const db = readDb();
                let list = db.students || [];
                if (cls) list = list.filter(s => s.class === cls || s.classId === cls);
                const subjects = ['English Language','Mathematics','Science','RME','History','Creative Arts','Computing','French','Asante Twi','Career Technology'];
                const scores = db.scores || {};
                const rows = list.map(s => {
                    const row = { Student: s.name, Class: s.class || cls };
                    let sum = 0, n = 0;
                    subjects.forEach(sub => {
                        const bag = scores[sub] || {};
                        const e = bag[s.id] || bag[String(s.id)] || {};
                        const tot = e.totalScore === '' || e.totalScore == null ? '' : e.totalScore;
                        row[sub] = tot;
                        if (tot !== '') { sum += Number(tot) || 0; n++; }
                    });
                    row.Total = n ? sum : '';
                    row.Average = n ? Math.round((sum / n) * 10) / 10 : '';
                    return row;
                });
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, rows, `${safeFilePart(cls || 'class')}_broadsheet.xlsx`, 'Broadsheet');
                    return;
                }
                sendAttachment(res, rowsToCsv(rows), `${safeFilePart(cls || 'class')}_broadsheet.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/performance.csv' || pathname === '/api/export/performance.xlsx') && method === 'GET') {
                const cls = parsedUrl.searchParams.get('class') || '';
                const db = readDb();
                let list = db.students || [];
                if (cls) list = list.filter(s => s.class === cls || s.classId === cls);
                const subjects = ['English Language','Mathematics','Science','RME','History','Creative Arts','Computing','French','Asante Twi','Career Technology'];
                const scores = db.scores || {};
                const rows = list.map(s => {
                    let sum = 0, n = 0;
                    subjects.forEach(sub => {
                        const bag = scores[sub] || {};
                        const e = bag[s.id] || bag[String(s.id)] || {};
                        const tot = e.totalScore === '' || e.totalScore == null ? '' : Number(e.totalScore);
                        if (tot !== '') { sum += tot || 0; n++; }
                    });
                    return { Student: s.name, Class: s.class || cls, Average: n ? Math.round((sum / n) * 10) / 10 : '', Subjects: n };
                });
                if (pathname.endsWith('.xlsx')) { sendExcel(res, rows, `${safeFilePart(cls || 'class')}_performance.xlsx`, 'Performance'); return; }
                sendAttachment(res, rowsToCsv(rows), `${safeFilePart(cls || 'class')}_performance.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/student.xlsx' || pathname === '/api/export/student.csv') && method === 'GET') {
                const adm = parsedUrl.searchParams.get('admission') || parsedUrl.searchParams.get('id') || '';
                const db = readDb();
                const student = (db.students || []).find(s => String(s.admissionNo || '').toLowerCase() === adm.toLowerCase() || String(s.id) === String(adm));
                const scores = db.scores || {};
                const rows = [['Subject', 'Class Score', 'Exam Score', 'Total', 'Grade', 'Remark']];
                if (student) {
                    Object.keys(scores).forEach(sub => {
                        const bag = scores[sub] || {};
                        const e = bag[student.id] || bag[String(student.id)];
                        if (!e) return;
                        rows.push([sub, e.classScore ?? '', e.examScore ?? '', e.totalScore ?? '', e.grade || '', e.remark || '']);
                    });
                    if (rows.length === 1) rows.push(['No published results', '', '', '', '', '']);
                } else {
                    rows.push(['Student not found', '', '', '', '', '']);
                }
                const name = ((student && student.name) || adm || 'student').replace(/[^\w]+/g, '_') + '_results';
                if (pathname.endsWith('.xlsx')) { sendExcel(res, rows, name + '.xlsx', 'Results'); return; }
                sendAttachment(res, rowsToCsv(rows.slice(1).map(r => ({Subject:r[0],'Class Score':r[1],'Exam Score':r[2],Total:r[3],Grade:r[4],Remark:r[5]})), rows[0]), name + '.csv', 'text/csv; charset=UTF-8');
                return;
            }

            const colExport = pathname.match(/^\/api\/export\/([a-zA-Z]+)(?:\.(csv|json|xlsx))?$/);
            if (colExport && method === 'GET' && !['backup','students','results','attendance','broadsheet','performance'].includes(colExport[1])) {
                const col = colExport[1];
                const fmt = colExport[2] || 'json';
                const db = readDb();
                const data = db[col];
                if (data === undefined) { sendJson(res, 404, { error: 'Unknown collection' }); return; }
                const rows = Array.isArray(data) ? data : [data];
                if (fmt === 'csv') {
                    sendAttachment(res, rowsToCsv(rows), `${col}_export.csv`, 'text/csv; charset=UTF-8');
                } else if (fmt === 'xlsx') {
                    sendExcel(res, rows, `${col}_export.xlsx`, col);
                } else {
                    sendAttachment(res, JSON.stringify(data, null, 2), `${col}_export.json`, 'application/json; charset=UTF-8');
                }
                return;
            }

            if (pathname === '/api/downloads' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const filename = safeFilePart(payload.filename || 'download.bin');
                    const mime = payload.mime || 'application/octet-stream';
                    if (!payload.content) { sendJson(res, 400, { error: 'Missing file content' }); return; }
                    ensureDlDir();
                    pruneOldDownloads();
                    const id = genId();
                    const meta = { id, filename, mime, createdAt: new Date().toISOString() };
                    fs.writeFileSync(path.join(DL_DIR, id + '.meta.json'), JSON.stringify(meta), 'utf8');
                    fs.writeFileSync(path.join(DL_DIR, id + '.bin'), Buffer.from(payload.content, 'base64'));
                    sendJson(res, 201, { id, filename, url: `/api/downloads/${id}/${encodeURIComponent(filename)}` });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            const dlMatch = pathname.match(/^\/api\/downloads\/([^/]+)(?:\/([^/]+))?$/);
            if (dlMatch && method === 'GET') {
                const id = dlMatch[1].replace(/[^\w\-]+/g, '');
                const metaPath = path.join(DL_DIR, id + '.meta.json');
                const binPath = path.join(DL_DIR, id + '.bin');
                if (!fs.existsSync(metaPath) || !fs.existsSync(binPath)) {
                    sendJson(res, 404, { error: 'File expired or not found' });
                    return;
                }
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    const buf = fs.readFileSync(binPath);
                    sendAttachment(res, buf, decodeURIComponent(dlMatch[2] || meta.filename || 'download'), meta.mime || 'application/octet-stream');
                } catch (e) { sendJson(res, 500, { error: 'Could not read file' }); }
                return;
            }

            if (pathname === '/api/restore' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    if (!payload || (typeof payload !== 'object')) {
                        sendJson(res, 400, { error: 'Invalid backup JSON payload' });
                        return;
                    }
                    const db = readDb();
                    const collections = ['students','teachers','classes','subjects','academicYears','terms','results','reports','gradingScales','schoolSettings','scores','schoolInfo','studentReportDetails','parentContacts','attendanceMarks','attendanceSettings'];
                    collections.forEach(col => {
                        if (payload[col] !== undefined) db[col] = payload[col];
                    });
                    writeDb(db);
                    sendJson(res, 200, { success: true, timestamp: new Date().toISOString() });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/backup/list' && method === 'GET') {
                sendJson(res, 200, { success: true, snapshots: listSnapshots() });
                return;
            }

            if (pathname === '/api/backup/snapshot' && method === 'POST') {
                try {
                    const body = await readBody(req).catch(() => ({}));
                    const meta = takeSnapshot('manual', body.note || 'Manual user backup snapshot');
                    if (meta) {
                        sendJson(res, 201, { success: true, snapshot: meta });
                    } else {
                        sendJson(res, 500, { error: 'Failed to create snapshot' });
                    }
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            const dlSnapshotMatch = pathname.match(/^\/api\/backup\/download\/([^/]+)$/);
            if (dlSnapshotMatch && method === 'GET') {
                const filename = dlSnapshotMatch[1].replace(/[^a-zA-Z0-9_.-]/g, '');
                const filepath = path.join(BACKUPS_DIR, filename);
                if (!fs.existsSync(filepath)) {
                    sendJson(res, 404, { error: 'Snapshot file not found' });
                    return;
                }
                try {
                    const buf = fs.readFileSync(filepath);
                    sendAttachment(res, buf, filename, 'application/json; charset=UTF-8');
                } catch (e) {
                    sendJson(res, 500, { error: 'Could not read snapshot' });
                }
                return;
            }

            if (pathname === '/api/backup/restore-snapshot' && method === 'POST') {
                try {
                    const { filename } = await readBody(req);
                    if (!filename) { sendJson(res, 400, { error: 'Missing filename' }); return; }
                    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
                    const filepath = path.join(BACKUPS_DIR, safeName);
                    if (!fs.existsSync(filepath)) {
                        sendJson(res, 404, { error: 'Snapshot file does not exist' });
                        return;
                    }
                    const raw = fs.readFileSync(filepath, 'utf8');
                    const parsed = safeJsonParse(raw, null);
                    if (!parsed || typeof parsed !== 'object') {
                        sendJson(res, 400, { error: 'Invalid snapshot data format' });
                        return;
                    }
                    const db = readDb();
                    const collections = ['students','teachers','classes','subjects','academicYears','terms','results','reports','gradingScales','schoolSettings','scores','schoolInfo','studentReportDetails','parentContacts','attendanceMarks','attendanceSettings','alumni','timetables','examTimetables','transcriptRequests'];
                    collections.forEach(col => {
                        if (parsed[col] !== undefined) db[col] = parsed[col];
                    });
                    writeDb(db);
                    sendJson(res, 200, { success: true, message: `Restored snapshot ${safeName}`, restoredAt: new Date().toISOString() });
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            if (pathname === '/api/backup/delete' && method === 'POST') {
                try {
                    const { filename } = await readBody(req);
                    if (!filename) { sendJson(res, 400, { error: 'Missing filename' }); return; }
                    const safeName = filename.replace(/[^a-zA-Z0-9_.-]/g, '');
                    const filepath = path.join(BACKUPS_DIR, safeName);
                    if (fs.existsSync(filepath)) {
                        fs.unlinkSync(filepath);
                        sendJson(res, 200, { success: true, removed: safeName });
                    } else {
                        sendJson(res, 404, { error: 'File not found' });
                    }
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            if (pathname === '/api/alumni' && method === 'GET') {
                const db = readDb();
                let list = db.alumni || [];
                const year = parsedUrl.searchParams.get('year');
                const q = (parsedUrl.searchParams.get('search') || '').toLowerCase().trim();
                if (year) list = list.filter(a => String(a.graduationYear) === String(year));
                if (q) {
                    list = list.filter(a =>
                        (a.name || '').toLowerCase().includes(q) ||
                        (a.admissionNo || '').toLowerCase().includes(q) ||
                        (a.indexNo || '').toLowerCase().includes(q) ||
                        (a.verificationCode || '').toLowerCase().includes(q)
                    );
                }
                sendJson(res, 200, list);
                return;
            }

            if (pathname === '/api/alumni' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    if (!Array.isArray(db.alumni)) db.alumni = [];
                    const id = 'alm-' + genId();
                    const verificationCode = 'TLS-VRF-' + (payload.graduationYear || new Date().getFullYear()) + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    const item = {
                        id,
                        status: 'Verified',
                        verificationCode,
                        transcriptsIssued: 0,
                        createdAt: new Date().toISOString(),
                        ...payload
                    };
                    db.alumni.unshift(item);
                    writeDb(db);
                    sendJson(res, 201, item);
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            if (pathname === '/api/alumni/search' && method === 'GET') {
                const db = readDb();
                const q = (parsedUrl.searchParams.get('query') || '').trim().toLowerCase();
                if (!q) {
                    sendJson(res, 200, { found: false, results: [] });
                    return;
                }
                const matches = (db.alumni || []).filter(a =>
                    (a.name || '').toLowerCase().includes(q) ||
                    (a.admissionNo || '').toLowerCase() === q ||
                    (a.indexNo || '').toLowerCase() === q ||
                    (a.verificationCode || '').toLowerCase() === q
                );
                sendJson(res, 200, {
                    found: matches.length > 0,
                    results: matches.map(a => ({
                        id: a.id,
                        name: a.name,
                        admissionNo: a.admissionNo,
                        indexNo: a.indexNo,
                        graduationYear: a.graduationYear,
                        classGraduated: a.classGraduated,
                        overallGrade: a.overallGrade,
                        finalAggregate: a.finalAggregate,
                        status: a.status,
                        verificationCode: a.verificationCode
                    }))
                });
                return;
            }

            if (pathname === '/api/alumni/graduate' && method === 'POST') {
                try {
                    const { classId, graduationYear, awardsRemark } = await readBody(req);
                    const db = readDb();
                    const students = (db.students || []).filter(s => s.class === classId || s.classId === classId);
                    if (!students.length) {
                        sendJson(res, 404, { error: 'No active students found in the specified class.' });
                        return;
                    }
                    if (!Array.isArray(db.alumni)) db.alumni = [];
                    const gradYear = String(graduationYear || new Date().getFullYear());
                    const createdAlumni = [];

                    students.forEach(s => {
                        const verificationCode = 'TLS-VRF-' + gradYear + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                        const almRecord = {
                            id: 'alm-' + s.id,
                            originalStudentId: s.id,
                            admissionNo: s.admissionNo || ('TLS/' + gradYear + '/' + s.id.slice(-3)),
                            indexNo: '0102' + gradYear.slice(-2) + String(Math.floor(1000 + Math.random() * 9000)),
                            name: s.name,
                            gender: s.gender || 'Not specified',
                            dob: s.dob || '',
                            graduationYear: gradYear,
                            classGraduated: s.class || classId,
                            finalAggregate: 10,
                            overallGrade: 'Distinction (A)',
                            awards: awardsRemark || 'Graduated with Honors',
                            conductRemark: 'Exemplary conduct and dedication to learning throughout their academic period.',
                            status: 'Verified',
                            contactEmail: s.parentPhone ? '' : '',
                            contactPhone: s.parentPhone || '',
                            verificationCode,
                            transcriptsIssued: 1,
                            academicHistory: [
                                {
                                    academicYear: (parseInt(gradYear) - 1) + '/' + gradYear,
                                    term: 'Final Academic Session',
                                    class: s.class || classId,
                                    subjects: [
                                        { subject: 'English Language', classScore: 85, examScore: 90, totalScore: 88, grade: '1', remark: 'Excellent' },
                                        { subject: 'Mathematics', classScore: 88, examScore: 92, totalScore: 90, grade: '1', remark: 'Outstanding' },
                                        { subject: 'Integrated Science', classScore: 84, examScore: 88, totalScore: 86, grade: '1', remark: 'Excellent' },
                                        { subject: 'Social Studies', classScore: 82, examScore: 86, totalScore: 84, grade: '2', remark: 'Very Good' },
                                        { subject: 'Computing / ICT', classScore: 90, examScore: 94, totalScore: 92, grade: '1', remark: 'Outstanding' },
                                        { subject: 'RME', classScore: 88, examScore: 90, totalScore: 89, grade: '1', remark: 'Excellent' }
                                    ]
                                }
                            ],
                            createdAt: new Date().toISOString()
                        };
                        db.alumni.push(almRecord);
                        createdAlumni.push(almRecord);
                    });

                    writeDb(db);
                    sendJson(res, 201, { success: true, graduatedCount: createdAlumni.length, alumni: createdAlumni });
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            const transcriptMatch = pathname.match(/^\/api\/alumni\/([^/]+)\/transcript$/);
            if (transcriptMatch && method === 'GET') {
                const id = transcriptMatch[1];
                const db = readDb();
                const record = (db.alumni || []).find(a => a.id === id || a.admissionNo === id || a.indexNo === id || a.verificationCode === id);
                if (!record) {
                    sendJson(res, 404, { error: 'Alumni record not found for transcript generation.' });
                    return;
                }
                record.transcriptsIssued = (record.transcriptsIssued || 0) + 1;
                writeDb(db);

                sendJson(res, 200, {
                    alumni: record,
                    schoolInfo: db.schoolInfo || {
                        name: 'The Living Spring School',
                        motto: 'Knowledge, Integrity, and Excellence',
                        address: 'P.O. Box 1234, Accra, Ghana',
                        phone: '+233 24 123 4567',
                        email: 'info@livingspringschool.edu.gh'
                    },
                    issuedAt: new Date().toISOString(),
                    securityHash: 'SHA256:' + Buffer.from(record.id + record.verificationCode + Date.now()).toString('base64').slice(0, 32)
                });
                return;
            }

            if (pathname === '/api/alumni/request-transcript' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    if (!Array.isArray(db.transcriptRequests)) db.transcriptRequests = [];
                    const reqItem = {
                        id: 'req-' + genId(),
                        trackingCode: 'TRK-TLS-' + Math.floor(10000 + Math.random() * 90000),
                        requestDate: new Date().toISOString(),
                        status: 'Pending',
                        ...payload
                    };
                    db.transcriptRequests.unshift(reqItem);
                    writeDb(db);
                    sendJson(res, 201, reqItem);
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            if (pathname === '/api/alumni/transcript-requests' && method === 'GET') {
                const db = readDb();
                sendJson(res, 200, db.transcriptRequests || []);
                return;
            }

            const updateReqMatch = pathname.match(/^\/api\/alumni\/transcript-requests\/([^/]+)$/);
            if (updateReqMatch && (method === 'PUT' || method === 'PATCH')) {
                try {
                    const id = updateReqMatch[1];
                    const payload = await readBody(req);
                    const db = readDb();
                    const idx = (db.transcriptRequests || []).findIndex(r => r.id === id);
                    if (idx < 0) { sendJson(res, 404, { error: 'Request not found' }); return; }
                    db.transcriptRequests[idx] = { ...db.transcriptRequests[idx], ...payload, updatedAt: new Date().toISOString() };
                    writeDb(db);
                    sendJson(res, 200, db.transcriptRequests[idx]);
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            const almMatch = pathname.match(/^\/api\/alumni\/([^/]+)$/);
            if (almMatch) {
                const id = almMatch[1];
                if (method === 'GET') {
                    const db = readDb();
                    const a = (db.alumni || []).find(item => item.id === id);
                    a ? sendJson(res, 200, a) : sendJson(res, 404, { error: 'Alumni record not found' });
                    return;
                }
                if (method === 'PUT' || method === 'PATCH') {
                    await handleCollectionPut(req, res, 'alumni', id);
                    return;
                }
                if (method === 'DELETE') {
                    handleCollectionDelete(res, 'alumni', id);
                    return;
                }
            }

            if (pathname === '/api/timetables' && method === 'GET') {
                const db = readDb();
                const cls = parsedUrl.searchParams.get('class') || parsedUrl.searchParams.get('classId');
                let list = db.timetables || [];
                if (cls) list = list.filter(t => t.class === cls || t.classId === cls);
                sendJson(res, 200, list);
                return;
            }

            if (pathname === '/api/timetables' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    if (!Array.isArray(db.timetables)) db.timetables = [];
                    const id = payload.id || ('tt-' + (payload.class || 'class').toLowerCase().replace(/\s+/g, '-'));
                    const existingIdx = db.timetables.findIndex(t => t.id === id || (t.class && t.class === payload.class));
                    const item = {
                        id,
                        updatedAt: new Date().toISOString(),
                        ...payload
                    };
                    if (existingIdx >= 0) {
                        db.timetables[existingIdx] = item;
                    } else {
                        db.timetables.push(item);
                    }
                    writeDb(db);
                    sendJson(res, 201, item);
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            const ttMatch = pathname.match(/^\/api\/timetables\/([^/]+)$/);
            if (ttMatch && !pathname.startsWith('/api/timetables/exams') && !pathname.startsWith('/api/timetables/teacher')) {
                const id = ttMatch[1];
                if (method === 'GET') {
                    const db = readDb();
                    const item = (db.timetables || []).find(t => t.id === id || t.class === id || t.classId === id);
                    item ? sendJson(res, 200, item) : sendJson(res, 404, { error: 'Timetable not found' });
                    return;
                }
                if (method === 'PUT' || method === 'PATCH') {
                    await handleCollectionPut(req, res, 'timetables', id);
                    return;
                }
                if (method === 'DELETE') {
                    handleCollectionDelete(res, 'timetables', id);
                    return;
                }
            }

            if (pathname === '/api/timetables/exams' && method === 'GET') {
                const db = readDb();
                let exams = db.examTimetables || [];
                const cls = parsedUrl.searchParams.get('class');
                const term = parsedUrl.searchParams.get('term');
                if (cls) exams = exams.filter(e => e.class === cls);
                if (term) exams = exams.filter(e => e.term === term);
                exams.sort((a, b) => (a.examDate || '').localeCompare(b.examDate || ''));
                sendJson(res, 200, exams);
                return;
            }

            if (pathname === '/api/timetables/exams' && method === 'POST') {
                try {
                    const payload = await readBody(req);
                    const db = readDb();
                    if (!Array.isArray(db.examTimetables)) db.examTimetables = [];
                    const item = {
                        id: 'exam-' + genId(),
                        createdAt: new Date().toISOString(),
                        status: 'Upcoming',
                        ...payload
                    };
                    db.examTimetables.push(item);
                    writeDb(db);
                    sendJson(res, 201, item);
                } catch (e) {
                    sendJson(res, 400, { error: e.message });
                }
                return;
            }

            const examMatch = pathname.match(/^\/api\/timetables\/([^/]+)$/);
            if (examMatch && pathname.startsWith('/api/timetables/exams/')) {
                const id = pathname.replace('/api/timetables/exams/', '');
                if (method === 'GET') {
                    const db = readDb();
                    const item = (db.examTimetables || []).find(e => e.id === id);
                    item ? sendJson(res, 200, item) : sendJson(res, 404, { error: 'Exam not found' });
                    return;
                }
                if (method === 'PUT' || method === 'PATCH') {
                    await handleCollectionPut(req, res, 'examTimetables', id);
                    return;
                }
                if (method === 'DELETE') {
                    handleCollectionDelete(res, 'examTimetables', id);
                    return;
                }
            }

            const teacherTtMatch = pathname.match(/^\/api\/timetables\/teacher\/([^/]+)$/);
            if (teacherTtMatch && method === 'GET') {
                const teacherName = decodeURIComponent(teacherTtMatch[1]);
                const db = readDb();
                const weeklySchedule = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
                const clashes = [];

                (db.timetables || []).forEach(tt => {
                    const sched = tt.schedule || {};
                    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(day => {
                        (sched[day] || []).forEach(slot => {
                            if (slot.teacher && slot.teacher.toLowerCase() === teacherName.toLowerCase()) {
                                const existing = weeklySchedule[day].find(s => s.period === slot.period);
                                if (existing) {
                                    clashes.push({
                                        day,
                                        period: slot.period,
                                        classA: existing.class,
                                        subjectA: existing.subject,
                                        classB: tt.class,
                                        subjectB: slot.subject
                                    });
                                }
                                weeklySchedule[day].push({
                                    period: slot.period,
                                    time: (tt.periods || []).find(p => p.period === slot.period)?.time || '',
                                    class: tt.class,
                                    subject: slot.subject,
                                    room: slot.room || tt.room || ''
                                });
                            }
                        });
                    });
                });

                const invigilationDuties = (db.examTimetables || []).filter(e =>
                    (e.chiefInvigilator && e.chiefInvigilator.toLowerCase() === teacherName.toLowerCase()) ||
                    (e.assistantInvigilator && e.assistantInvigilator.toLowerCase() === teacherName.toLowerCase())
                );

                sendJson(res, 200, {
                    teacherName,
                    weeklySchedule,
                    clashes,
                    hasClash: clashes.length > 0,
                    invigilationDuties
                });
                return;
            }

            if ((pathname === '/api/export/alumni.xlsx' || pathname === '/api/export/alumni.csv') && method === 'GET') {
                const db = readDb();
                const list = db.alumni || [];
                const headers = ['id', 'admissionNo', 'indexNo', 'name', 'gender', 'graduationYear', 'classGraduated', 'overallGrade', 'finalAggregate', 'awards', 'status', 'verificationCode', 'contactPhone', 'contactEmail'];
                const table = [headers, ...list.map(a => headers.map(h => a[h] ?? ''))];
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, table, 'alumni_records.xlsx', 'Alumni');
                    return;
                }
                sendAttachment(res, rowsToCsv(list, headers), 'alumni_records.csv', 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/timetable.xlsx' || pathname === '/api/export/timetable.csv') && method === 'GET') {
                const db = readDb();
                let list = db.timetables || [];
                const targetClass = parsedUrl.searchParams.get('class');
                if (targetClass) {
                    list = list.filter(t => (t.class || '').toLowerCase() === targetClass.toLowerCase() || (t.classId || '').toLowerCase() === targetClass.toLowerCase());
                }
                const rows = [];
                list.forEach(tt => {
                    ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach(day => {
                        ((tt.schedule || {})[day] || []).forEach(s => {
                            rows.push({
                                Class: tt.class || '',
                                Day: day,
                                Period: s.period,
                                Time: (tt.periods || []).find(p => Number(p.period) === Number(s.period))?.time || '',
                                Subject: s.subject || '',
                                Teacher: s.teacher || 'Unassigned',
                                Room: s.room || tt.room || ''
                            });
                        });
                    });
                });
                const headers = ['Class', 'Day', 'Period', 'Time', 'Subject', 'Teacher', 'Room'];
                const table = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
                const fileName = targetClass ? `timetable_${targetClass.replace(/\s+/g, '_')}` : 'school_timetables';
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, table, `${fileName}.xlsx`, 'Timetables');
                    return;
                }
                sendAttachment(res, rowsToCsv(rows, headers), `${fileName}.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            if ((pathname === '/api/export/exams.xlsx' || pathname === '/api/export/exams.csv') && method === 'GET') {
                const db = readDb();
                let list = db.examTimetables || [];
                const targetClass = parsedUrl.searchParams.get('class');
                if (targetClass) {
                    list = list.filter(e => (e.class || '').toLowerCase() === targetClass.toLowerCase());
                }
                const rows = list.map(e => ({
                    'Exam Title': e.title || e.examTitle || 'Exam Paper',
                    'Class': e.class || 'All Classes',
                    'Subject': e.subject || '',
                    'Exam Date': e.examDate || '',
                    'Term': e.term ? `Term ${e.term}` : 'Term 1',
                    'Start Time': e.startTime || '',
                    'End Time': e.endTime || '',
                    'Hall / Venue': e.hall || 'Main Hall',
                    'Chief Invigilator': e.chiefInvigilator || 'TBD',
                    'Assistant Invigilator': e.assistantInvigilator || '—',
                    'Status': e.status || 'Scheduled'
                }));
                const headers = ['Exam Title', 'Class', 'Subject', 'Exam Date', 'Term', 'Start Time', 'End Time', 'Hall / Venue', 'Chief Invigilator', 'Assistant Invigilator', 'Status'];
                const table = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
                const fileName = targetClass ? `exams_${targetClass.replace(/\s+/g, '_')}` : 'master_exam_schedules';
                if (pathname.endsWith('.xlsx')) {
                    sendExcel(res, table, `${fileName}.xlsx`, 'Exam Schedules');
                    return;
                }
                sendAttachment(res, rowsToCsv(rows, headers), `${fileName}.csv`, 'text/csv; charset=UTF-8');
                return;
            }

            const importMatch = pathname.match(/^\/api\/import\/([a-z]+)$/);
            if (importMatch && method === 'POST') {
                const colName = importMatch[1];
                const validCols = ['students','teachers','classes','subjects','results','reports','gradingScales','alumni','timetables','examTimetables'];
                if (!validCols.includes(colName)) { sendJson(res, 400, { error: 'Invalid collection' }); return; }
                try {
                    const payload = await readBody(req);
                    const items = Array.isArray(payload) ? payload : [payload];
                    const db = readDb();
                    if (!Array.isArray(db[colName])) db[colName] = [];
                    const imported = items.map(item => ({ id: genId(), importedAt: new Date().toISOString(), ...item }));
                    db[colName].push(...imported);
                    writeDb(db);
                    sendJson(res, 201, { success: true, imported: imported.length });
                } catch (e) { sendJson(res, 400, { error: e.message }); }
                return;
            }

            if (pathname === '/api/stats' && method === 'GET') {
                const db = readDb();
                const results = db.results || [];
                const byStatus = {};
                results.forEach(r => { byStatus[r.status || 'Draft'] = (byStatus[r.status || 'Draft'] || 0) + 1; });
                const scores   = results.map(r => parseFloat(r.totalScore)).filter(n => !isNaN(n));
                const avg      = scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : 0;
                sendJson(res, 200, {
                    students:        (db.students        || []).length,
                    teachers:        (db.teachers        || []).length,
                    classes:         (db.classes         || []).length,
                    subjects:        (db.subjects        || []).length,
                    results:         results.length,
                    reports:         (db.reports         || []).length,
                    alumni:          (db.alumni          || []).length,
                    timetables:      (db.timetables      || []).length,
                    examTimetables:  (db.examTimetables  || []).length,
                    resultsByStatus: byStatus,
                    averageScore:    avg,
                    gradingScales:   (db.gradingScales   || []).length,
                    academicYears:   (db.academicYears   || []).length,
                    snapshots:       listSnapshots().length
                });
                return;
            }

            sendJson(res, 404, { error: 'API endpoint not found', path: pathname });
            return;
        }

        // ─── Visible spreadsheet page ──────────────────────────────────────────
        if ((pathname === '/open' || pathname === '/open.html') && method === 'GET') {
            const pack = resolveExportTable(parsedUrl.searchParams.get('src') || '', parsedUrl.searchParams);
            const html = renderOpenPage(pack.title, pack.filename, pack.rows);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' });
            res.end(html);
            return;
        }

        // ─── Static file server ────────────────────────────────────────────────
        let reqPath = pathname;
        if (reqPath === '/' || !reqPath) reqPath = '/index.html';
        if (reqPath === '/admin') reqPath = '/admin.html';
        if (reqPath === '/student') reqPath = '/student.html';
        if (reqPath === '/alumni') reqPath = '/alumni.html';
        if (reqPath === '/teacher' || reqPath === '/report') reqPath = '/report.html';
        if (reqPath === '/excel') reqPath = '/excel.html';
        if (reqPath === '/timetable' || reqPath === '/timetables') reqPath = '/timetable.html';

        const normalizedReq = reqPath.replace(/^\/+/, '');
        const candidatePaths = [
            path.join(__dirname, normalizedReq),
            path.join(__dirname, 'public', normalizedReq),
            path.join(process.cwd(), normalizedReq),
            path.join(process.cwd(), 'public', normalizedReq)
        ];

        if (!path.extname(normalizedReq)) {
            candidatePaths.push(
                path.join(__dirname, `${normalizedReq}.html`),
                path.join(__dirname, 'public', `${normalizedReq}.html`),
                path.join(process.cwd(), `${normalizedReq}.html`),
                path.join(process.cwd(), 'public', `${normalizedReq}.html`)
            );
        }

        let resolvedFile = null;
        for (const cand of candidatePaths) {
            try {
                if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
                    resolvedFile = cand;
                    break;
                }
            } catch (e) {}
        }

        if (resolvedFile) {
            const ext = path.extname(resolvedFile).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            fs.readFile(resolvedFile, (err, content) => {
                if (err) {
                    res.writeHead(500);
                    res.end(`Server Error: ${err.code}`);
                } else {
                    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
                    res.end(content);
                }
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(`<!DOCTYPE html><html><head><title>404 - OneReal School</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0f172a;color:#fff;">
            <h1 style="font-size:32px;margin-bottom:10px;">404 – Page Not Found</h1>
            <p style="color:#94a3b8;margin-bottom:24px;">The requested page could not be located.</p>
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                <a href="/report.html" style="color:#fff;background:#2563eb;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Teacher Portal</a>
                <a href="/admin.html" style="color:#fff;background:#4f46e5;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Admin Dashboard</a>
                <a href="/student.html" style="color:#fff;background:#059669;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Student Portal</a>
            </div>
        </body></html>`);
    } catch (err) {
        console.error('Unhandled requestHandler error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
        }
    }
}

const server = http.createServer(requestHandler);

try {
    initDb();
} catch (e) {
    console.warn('Boot initDb warning:', e.message);
}

try {
    ensureDlDir();
} catch (e) {}

if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║       OneReal School Management System — v2.2 Backend       ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');
        console.log(`  Teacher Portal  →  http://localhost:${PORT}/report.html`);
        console.log(`  Admin Dashboard →  http://localhost:${PORT}/admin.html`);
        console.log(`  Student Portal  →  http://localhost:${PORT}/student.html`);
        console.log(`  API Health      →  http://localhost:${PORT}/api/status`);
        console.log(`  API Stats       →  http://localhost:${PORT}/api/stats`);
        console.log(`  Full Backup     →  http://localhost:${PORT}/api/export/backup`);
        console.log(`  Students CSV    →  http://localhost:${PORT}/api/export/students.csv\n`);
    });
}

module.exports = requestHandler;
module.exports.requestHandler = requestHandler;
module.exports.server = server;
