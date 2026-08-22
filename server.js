'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { buildXlsx } = require('./xlsx-lite');
const { renderOpenPage, objectsToRows } = require('./open-page');

const PORT    = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const DL_DIR  = path.join(__dirname, 'user-downloads');

// ─── DB helpers ──────────────────────────────────────────────────────────────

function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            students:       [],
            teachers:       [],
            classes:        [],
            subjects:       [],
            academicYears:  [],
            terms:          [],
            results:        [],
            reports:        [],
            gradingScales:  [],
            schoolSettings: {},
            scores:         {},
            schoolInfo: {
                academicYear: '2024/2025',
                term: '1',
                closingDate: '19th DEC, 2024',
                reopeningDate: '13th JAN, 2025',
                numberOnRoll: '18',
                basicLevel: '6',
                classTeacher: '',
                headTeacher: ''
            },
            studentReportDetails: {},
            parentContacts:       {},
            attendanceMarks:      {},
            attendanceSettings:   { defaultDays: {}, studentDays: {}, studentPresentOverride: {} },
            auditLogs:            []
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
        console.log('database.json initialised.');
    }
}

function readDb() {
    try {
        initDb();
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error('Error reading database.json:', err);
        return initBlankDb();
    }
}

function initBlankDb() {
    return {
        students: [], teachers: [], classes: [], subjects: [],
        academicYears: [], terms: [], results: [], reports: [],
        gradingScales: [], schoolSettings: {}, scores: {}, schoolInfo: {},
        studentReportDetails: {}, parentContacts: {},
        attendanceMarks: {}, attendanceSettings: {}, auditLogs: []
    };
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing database.json:', err);
        return false;
    }
}

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ensureDlDir() {
    if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// ─── MIME types ───────────────────────────────────────────────────────────────
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css':  'text/css; charset=UTF-8',
    '.js':   'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
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

// ─── Generic collection CRUD ──────────────────────────────────────────────────

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

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname  = parsedUrl.pathname;
    const method    = req.method.toUpperCase() === 'HEAD' ? 'GET' : req.method.toUpperCase();

    // ── API Routes ──────────────────────────────────────────────────────────

    if (pathname.startsWith('/api/')) {

        // ── Health / Status ─────────────────────────────────────────────────
        if (pathname === '/api/status' && method === 'GET') {
            const db = readDb();
            sendJson(res, 200, {
                status: 'online',
                version: '2.0.0',
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

        // ── Full DB dump ─────────────────────────────────────────────────────
        if (pathname === '/api/db' && method === 'GET') {
            sendJson(res, 200, readDb());
            return;
        }

        // ── Legacy /api/sync (teacher app) ───────────────────────────────────
        if (pathname === '/api/sync' && method === 'POST') {
            try {
                const payload = await readBody(req);
                const db = readDb();
                const allowed = ['students','scores','schoolInfo','studentReportDetails','parentContacts','attendanceMarks','attendanceSettings','reports','classes','teachers','subjects','schoolSettings'];
                allowed.forEach(k => { if (payload[k] !== undefined) db[k] = payload[k]; });
                writeDb(db);
                sendJson(res, 200, { success: true, timestamp: new Date().toISOString() });
            } catch (e) { sendJson(res, 400, { error: e.message }); }
            return;
        }

        // ── COLLECTIONS: students ────────────────────────────────────────────
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

        // GET /api/students/class/:classId — filter by class
        const studClassMatch = pathname.match(/^\/api\/students\/class\/([^/]+)$/);
        if (studClassMatch && method === 'GET') {
            const classId = studClassMatch[1];
            const db = readDb();
            sendJson(res, 200, (db.students || []).filter(s => s.classId === classId || s.class === classId));
            return;
        }

        // ── COLLECTIONS: teachers ────────────────────────────────────────────
        if (pathname === '/api/teachers' && method === 'GET')  { handleCollectionGet(res, 'teachers'); return; }
        if (pathname === '/api/teachers' && method === 'POST') { await handleCollectionPost(req, res, 'teachers'); return; }

        const teacherMatch = pathname.match(/^\/api\/teachers\/([^/]+)$/);
        if (teacherMatch) {
            const id = teacherMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'teachers', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'teachers', id); return; }
        }

        // ── COLLECTIONS: classes ─────────────────────────────────────────────
        if (pathname === '/api/classes' && method === 'GET')  { handleCollectionGet(res, 'classes'); return; }
        if (pathname === '/api/classes' && method === 'POST') { await handleCollectionPost(req, res, 'classes'); return; }

        const classMatch = pathname.match(/^\/api\/classes\/([^/]+)$/);
        if (classMatch) {
            const id = classMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'classes', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'classes', id); return; }
        }

        // ── COLLECTIONS: subjects ────────────────────────────────────────────
        if (pathname === '/api/subjects' && method === 'GET')  { handleCollectionGet(res, 'subjects'); return; }
        if (pathname === '/api/subjects' && method === 'POST') { await handleCollectionPost(req, res, 'subjects'); return; }

        const subjectMatch = pathname.match(/^\/api\/subjects\/([^/]+)$/);
        if (subjectMatch) {
            const id = subjectMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'subjects', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'subjects', id); return; }
        }

        // ── COLLECTIONS: academicYears ───────────────────────────────────────
        if (pathname === '/api/academic-years' && method === 'GET')  { handleCollectionGet(res, 'academicYears'); return; }
        if (pathname === '/api/academic-years' && method === 'POST') { await handleCollectionPost(req, res, 'academicYears'); return; }

        const ayMatch = pathname.match(/^\/api\/academic-years\/([^/]+)$/);
        if (ayMatch) {
            const id = ayMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'academicYears', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'academicYears', id); return; }
        }

        // GET /api/academic-years/active — return the active year
        if (pathname === '/api/academic-years/active' && method === 'GET') {
            const db   = readDb();
            const year = (db.academicYears || []).find(y => y.isActive);
            year ? sendJson(res, 200, year) : sendJson(res, 404, { error: 'No active academic year' });
            return;
        }

        // ── COLLECTIONS: terms ───────────────────────────────────────────────
        if (pathname === '/api/terms' && method === 'GET')  { handleCollectionGet(res, 'terms'); return; }
        if (pathname === '/api/terms' && method === 'POST') { await handleCollectionPost(req, res, 'terms'); return; }

        const termMatch = pathname.match(/^\/api\/terms\/([^/]+)$/);
        if (termMatch) {
            const id = termMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'terms', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'terms', id); return; }
        }

        // GET /api/terms/active
        if (pathname === '/api/terms/active' && method === 'GET') {
            const db   = readDb();
            const term = (db.terms || []).find(t => t.isActive);
            term ? sendJson(res, 200, term) : sendJson(res, 404, { error: 'No active term' });
            return;
        }

        // ── COLLECTIONS: results ─────────────────────────────────────────────
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

        // POST /api/results/submit — bulk submit (Draft → Submitted)
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

        // POST /api/results/approve — bulk approve (Submitted/Reviewed → Approved)
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

        // POST /api/results/unlock — bulk unlock (remove lock)
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

        // GET /api/results/pending — results with status=Submitted
        if (pathname === '/api/results/pending' && method === 'GET') {
            const db = readDb();
            sendJson(res, 200, (db.results || []).filter(r => r.status === 'Submitted'));
            return;
        }

        // ── COLLECTIONS: reports ─────────────────────────────────────────────
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

        // ── COLLECTIONS: users ───────────────────────────────────────────────
        if (pathname === '/api/users' && method === 'GET')  { handleCollectionGet(res, 'users'); return; }
        if (pathname === '/api/users' && method === 'POST') { await handleCollectionPost(req, res, 'users'); return; }

        const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
        if (userMatch) {
            const id = userMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'users', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'users', id); return; }
        }

        // ── COLLECTIONS: grading scales ──────────────────────────────────────
        if (pathname === '/api/grading-scales' && method === 'GET')  { handleCollectionGet(res, 'gradingScales'); return; }
        if (pathname === '/api/grading-scales' && method === 'POST') { await handleCollectionPost(req, res, 'gradingScales'); return; }

        const gsMatch = pathname.match(/^\/api\/grading-scales\/([^/]+)$/);
        if (gsMatch) {
            const id = gsMatch[1];
            if (method === 'PUT' || method === 'PATCH') { await handleCollectionPut(req, res, 'gradingScales', id); return; }
            if (method === 'DELETE') { handleCollectionDelete(res, 'gradingScales', id); return; }
        }

        // GET /api/grading-scales/active
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

        // ── SCHOOL SETTINGS ──────────────────────────────────────────────────
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

        // ── Legacy school-info (teacher app compatibility) ───────────────────
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

        // ── Legacy scores (teacher app compatibility) ─────────────────────────
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

        // GET /api/templates/marks.csv|.xlsx
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

        // GET /api/templates/:type[.csv|.xlsx]
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

        // GET /api/export/attendance.csv
        // GET /api/export/attendance.csv
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

        // GET /api/export/broadsheet.csv?class=
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

        // GET /api/export/:collection.(csv|json)
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

        // POST /api/downloads — store a generated file, then GET it as a real attachment
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

        // POST /api/restore — Restore Full JSON Backup
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

        // ── IMPORT ────────────────────────────────────────────────────────────
        // POST /api/import/:collection — bulk import array
        const importMatch = pathname.match(/^\/api\/import\/([a-z]+)$/);
        if (importMatch && method === 'POST') {
            const colName = importMatch[1];
            const validCols = ['students','teachers','classes','subjects','results','reports','gradingScales'];
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

        // ── STATS ─────────────────────────────────────────────────────────────
        if (pathname === '/api/stats' && method === 'GET') {
            const db = readDb();
            const results = db.results || [];
            const byStatus = {};
            results.forEach(r => { byStatus[r.status || 'Draft'] = (byStatus[r.status || 'Draft'] || 0) + 1; });
            const scores   = results.map(r => parseFloat(r.totalScore)).filter(n => !isNaN(n));
            const avg      = scores.length ? Math.round(scores.reduce((a,b) => a+b,0) / scores.length) : 0;
            sendJson(res, 200, {
                students:      (db.students      || []).length,
                teachers:      (db.teachers      || []).length,
                classes:       (db.classes       || []).length,
                subjects:      (db.subjects      || []).length,
                results:       results.length,
                reports:       (db.reports       || []).length,
                resultsByStatus: byStatus,
                averageScore:  avg,
                gradingScales: (db.gradingScales || []).length,
                academicYears: (db.academicYears || []).length,
            });
            return;
        }

        sendJson(res, 404, { error: 'API endpoint not found', path: pathname });
        return;
    }

    // ─── Visible spreadsheet page (preview-safe) ────────────────────────────
    if ((pathname === '/open' || pathname === '/open.html') && method === 'GET') {
        const pack = resolveExportTable(parsedUrl.searchParams.get('src') || '', parsedUrl.searchParams);
        const html = renderOpenPage(pack.title, pack.filename, pack.rows);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(html);
        return;
    }

    // ─── Static file server ─────────────────────────────────────────────────

    let reqPath = pathname;
    // Root lands on the teacher portal login — never the Excel template page.
    if (reqPath === '/') reqPath = '/report.html';
    // Convenience routes
    if (reqPath === '/admin') reqPath = '/admin.html';
    if (reqPath === '/student') reqPath = '/student.html';

    const filePath   = path.join(__dirname, reqPath);
    const ext        = path.extname(filePath).toLowerCase();
    const contentType= MIME_TYPES[ext] || 'application/octet-stream';

    // Security: prevent path traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
                res.end(`<!DOCTYPE html><html><head><title>404</title></head><body>
                    <h1>404 – Not Found</h1>
                    <p><a href="/report.html">Teacher Portal</a> | <a href="/admin.html">Admin Dashboard</a> | <a href="/student.html">Student Portal</a></p>
                </body></html>`);
            } else {
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
            res.end(content);
        }
    });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

initDb();

ensureDlDir();

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

