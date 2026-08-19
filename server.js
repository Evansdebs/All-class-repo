'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT    = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

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
            users:          [],
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
        academicYears: [], terms: [], results: [], reports: [], users: [],
        gradingScales: [], schoolSettings: {}, scores: {}, schoolInfo: {},
        studentReportDetails: {}, parentContacts: {}, auditLogs: []
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
    '.pdf':  'application/pdf'
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
    const method    = req.method.toUpperCase();

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
                const allowed = ['students','scores','schoolInfo','studentReportDetails','parentContacts'];
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

        // ── AUDIT LOGS ───────────────────────────────────────────────────────
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

        // ── DATA EXPORT ───────────────────────────────────────────────────────
        // GET /api/export/backup — full JSON backup
        if (pathname === '/api/export/backup' && method === 'GET') {
            const db = readDb();
            const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...db }, null, 2);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=UTF-8',
                'Content-Disposition': `attachment; filename="school_backup_${new Date().toISOString().split('T')[0]}.json"`
            });
            res.end(body);
            return;
        }

        // GET /api/export/students.csv
        if (pathname === '/api/export/students.csv' && method === 'GET') {
            const db = readDb();
            const rows = db.students || [];
            if (!rows.length) { sendJson(res, 200, []); return; }
            const headers = ['id','admissionNo','name','gender','dob','class','classId','status','parentName','parentPhone'];
            const csv = [
                headers.join(','),
                ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
            ].join('\n');
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=UTF-8',
                'Content-Disposition': 'attachment; filename="students.csv"'
            });
            res.end(csv);
            return;
        }

        // GET /api/export/results.csv
        if (pathname === '/api/export/results.csv' && method === 'GET') {
            const db = readDb();
            const rows = db.results || [];
            if (!rows.length) { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end(''); return; }
            const headers = ['id','studentId','studentName','classId','subjectId','classScore','examScore','totalScore','grade','remark','status','locked'];
            const csv = [
                headers.join(','),
                ...rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(','))
            ].join('\n');
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=UTF-8',
                'Content-Disposition': 'attachment; filename="results.csv"'
            });
            res.end(csv);
            return;
        }

        // GET /api/templates/:type — Download standard import template CSV
        const templateMatch = pathname.match(/^\/api\/templates\/([a-z]+)$/);
        if (templateMatch && method === 'GET') {
            const type = templateMatch[1];
            const templates = {
                students: 'admissionNo,name,gender,dob,class,parentName,parentPhone\nTLS/2026/001,John Doe,Male,2014-05-12,Class 6,Robert Doe,0201234567\nTLS/2026/002,Jane Smith,Female,2014-08-20,Class 6,Mary Smith,0249876543',
                teachers: 'name,email,phone,role,assignedClasses,assignedSubjects\nKwame Mensah,teacher@school.com,0201234567,Teacher,"Class 6","Mathematics, Science"',
                classes:  'name,level,classTeacherName\nClass 6,Upper Primary,Kwame Mensah',
                subjects: 'code,name,classNames\nMATH,Mathematics,"Class 6, Class 5"\nENG,English Language,"Class 6, Class 5"',
                results:  'studentId,studentName,classId,subjectId,classScore,examScore\nTLS/2026/001,John Doe,Class 6,Mathematics,42,48\nTLS/2026/002,Jane Smith,Class 6,Mathematics,38,44'
            };
            const content = templates[type];
            if (!content) { sendJson(res, 404, { error: 'Template type not found' }); return; }
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=UTF-8',
                'Content-Disposition': `attachment; filename="${type}_import_template.csv"`
            });
            res.end(content);
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
                const collections = ['students','teachers','classes','subjects','academicYears','terms','results','reports','users','gradingScales','schoolSettings','scores','schoolInfo','studentReportDetails','parentContacts'];
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
            const validCols = ['students','teachers','classes','subjects','results','reports','users','gradingScales'];
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

    // ─── Static file server ─────────────────────────────────────────────────

    let reqPath = pathname;
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

server.listen(PORT, () => {
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
