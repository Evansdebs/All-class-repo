/* Shared attendance — teacher, admin, student, and report sheets */
(function (global) {
    'use strict';

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) { return fallback; }
    }
    function saveJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
        if (typeof syncSaveCollection === 'function') {
            try { syncSaveCollection(key, value); } catch (e) {}
        }
    }
    function sid(id) { return String(id); }

    function todayISO() {
        try {
            return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' });
        } catch (e) {
            return new Date().toISOString().slice(0, 10);
        }
    }

    function parseISO(iso) {
        const parts = String(iso || '').split('-').map(Number);
        if (parts.length < 3 || !parts[0]) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }

    function weekdayOf(iso) {
        const d = parseISO(iso);
        return d ? d.getDay() : -1;
    }

    function isWeekend(iso) {
        const day = weekdayOf(iso);
        return day === 0 || day === 6;
    }

    function isFuture(iso) {
        return !!iso && iso > todayISO();
    }

    function weekdayCount(start, end) {
        if (!start || !end || end < start) return 0;
        let n = 0;
        const d = parseISO(start);
        const last = parseISO(end);
        if (!d || !last) return 0;
        while (d <= last) {
            const day = d.getDay();
            if (day !== 0 && day !== 6) n++;
            d.setDate(d.getDate() + 1);
        }
        return n;
    }

    function markableError(date, opts) {
        const allowWeekend = opts && opts.allowWeekend;
        if (!date) return 'Pick a date first.';
        if (isFuture(date)) return 'You cannot mark attendance for a future date.';
        if (!allowWeekend && isWeekend(date)) return 'Weekends are not school days.';
        return '';
    }

    function termKey() {
        const si = loadJSON('schoolInfo', {});
        const years = loadJSON('academicYears', []);
        const terms = loadJSON('terms', []);
        const y = years.find(x => x.isActive);
        const t = terms.find(x => x.isActive) || terms.find(x => x.isClosed);
        const year = y?.name || si.academicYear || '';
        const term = t ? String(t.termNumber || '') : String(si.term || '1');
        return year + '|' + term;
    }

    function activeTerm() {
        const terms = loadJSON('terms', []);
        return terms.find(t => t.isActive) || terms.find(t => t.isClosed) || null;
    }

    let marks = {};
    let settings = { defaultDays: {}, studentDays: {}, studentPresentOverride: {}, termRange: {} };

    function normalizeSettings(raw) {
        const s = raw && typeof raw === 'object' ? raw : {};
        return {
            defaultDays: s.defaultDays || {},
            studentDays: s.studentDays || {},
            studentPresentOverride: s.studentPresentOverride || {},
            termRange: s.termRange || {},
            updatedAt: s.updatedAt || null
        };
    }

    function load() {
        marks = loadJSON('attendanceMarks', {}) || {};
        settings = normalizeSettings(loadJSON('attendanceSettings', {}));
        return { marks, settings };
    }

    function persistMarks() { saveJSON('attendanceMarks', marks); }
    function persistSettings() {
        settings.updatedAt = new Date().toISOString();
        saveJSON('attendanceSettings', settings);
    }

    function mergeMarks(local, remote) {
        const out = JSON.parse(JSON.stringify(remote || {}));
        Object.keys(local || {}).forEach(id => {
            if (!out[id]) out[id] = {};
            Object.keys(local[id] || {}).forEach(date => {
                const L = local[id][date];
                const R = out[id][date];
                if (!R || (L && L.at && (!R.at || L.at >= R.at))) out[id][date] = L;
            });
        });
        return out;
    }

    async function hydrateFromServer() {
        try {
            const res = await fetch('/api/db');
            if (!res.ok) return load();
            const db = await res.json();
            const localMarks = loadJSON('attendanceMarks', {});
            const localSet = normalizeSettings(loadJSON('attendanceSettings', {}));
            if (db.attendanceMarks) {
                marks = mergeMarks(localMarks, db.attendanceMarks);
                localStorage.setItem('attendanceMarks', JSON.stringify(marks));
            } else {
                marks = localMarks || {};
            }
            const remoteSet = normalizeSettings(db.attendanceSettings || {});
            const localNewer = (localSet.updatedAt || '') >= (remoteSet.updatedAt || '');
            settings = localNewer && (localSet.updatedAt || Object.keys(localSet.defaultDays).length)
                ? localSet
                : {
                    defaultDays: { ...remoteSet.defaultDays, ...localSet.defaultDays },
                    studentDays: { ...remoteSet.studentDays, ...localSet.studentDays },
                    studentPresentOverride: { ...remoteSet.studentPresentOverride, ...localSet.studentPresentOverride },
                    termRange: { ...remoteSet.termRange, ...localSet.termRange },
                    updatedAt: localNewer ? localSet.updatedAt : remoteSet.updatedAt
                };
            localStorage.setItem('attendanceSettings', JSON.stringify(settings));
        } catch (e) {
            load();
        }
        return load();
    }

    function bucket(studentId) {
        const id = sid(studentId);
        if (!marks[id]) {
            if (marks[studentId] && typeof marks[studentId] === 'object') marks[id] = marks[studentId];
            else marks[id] = {};
        }
        return marks[id];
    }

    function getDay(studentId, date) {
        load();
        return bucket(studentId)[date] || null;
    }

    function mark(studentId, date, status, meta) {
        load();
        const err = status ? markableError(date) : (date ? '' : 'Pick a date first.');
        if (err) return { ok: false, error: err };
        const rec = bucket(studentId);
        if (!status) delete rec[date];
        else {
            rec[date] = {
                status: status,
                className: (meta && meta.className) || '',
                termKey: termKey(),
                by: (meta && meta.by) || '',
                at: new Date().toISOString()
            };
        }
        persistMarks();
        syncStudentReportLabel(sid(studentId));
        return { ok: true, record: rec[date] || null };
    }

    function markMany(students, date, status, meta) {
        load();
        const list = (students || []).filter(s => s && s.id != null);
        if (!list.length) return { ok: false, error: 'No students in this class to mark.', count: 0 };
        const err = status ? markableError(date) : (date ? '' : 'Pick a date first.');
        if (err) return { ok: false, error: err, count: 0 };
        list.forEach(s => {
            const rec = bucket(s.id);
            if (!status) delete rec[date];
            else {
                rec[date] = {
                    status: status,
                    className: s.class || (meta && meta.className) || '',
                    termKey: termKey(),
                    by: (meta && meta.by) || '',
                    at: new Date().toISOString()
                };
            }
            syncStudentReportLabel(sid(s.id), true);
        });
        persistMarks();
        flushReportDetails();
        return { ok: true, count: list.length };
    }

    function countedPresent(status) {
        return status === 'present' || status === 'late';
    }

    function inTermRange(date, tk) {
        const range = termWindow(tk);
        if (range.start && date < range.start) return false;
        if (range.end && date > range.end) return false;
        return true;
    }

    function presentCount(studentId, tk) {
        load();
        const key = tk || termKey();
        const id = sid(studentId);
        const ov = settings.studentPresentOverride[id] && settings.studentPresentOverride[id][key];
        if (ov !== undefined && ov !== null && ov !== '') return Number(ov);
        const rec = bucket(studentId);
        let n = 0;
        Object.keys(rec).forEach(date => {
            const m = rec[date];
            if (!m) return;
            if (isWeekend(date) || isFuture(date)) return;
            if (m.termKey && m.termKey !== key) return;
            if (!inTermRange(date, key)) return;
            if (countedPresent(m.status)) n++;
        });
        return n;
    }

    function absentCount(studentId, tk) {
        load();
        const key = tk || termKey();
        const rec = bucket(studentId);
        let n = 0;
        Object.keys(rec).forEach(date => {
            const m = rec[date];
            if (!m) return;
            if (isWeekend(date) || isFuture(date)) return;
            if (m.termKey && m.termKey !== key) return;
            if (!inTermRange(date, key)) return;
            if (m.status === 'absent') n++;
        });
        return n;
    }

    function termWindow(tk) {
        load();
        const key = tk || termKey();
        const stored = settings.termRange[key] || {};
        const t = activeTerm() || {};
        const start = stored.start || t.startDate || '';
        let end = stored.end || t.endDate || '';
        if (t.isClosed && !end) end = stored.closedOn || todayISO();
        if (!t.isClosed) {
            const cap = todayISO();
            end = end && end < cap ? end : cap;
        }
        return { start: start, end: end, closed: !!t.isClosed };
    }

    function schoolDaysInTerm(tk) {
        load();
        const key = tk || termKey();
        const win = termWindow(key);
        const computed = (win.start && win.end) ? weekdayCount(win.start, win.end) : 0;
        if (win.closed && computed) return computed;
        const def = settings.defaultDays[key];
        if (def !== undefined && def !== null && def !== '') return Number(def);
        return computed;
    }

    function totalDays(studentId, tk) {
        load();
        const key = tk || termKey();
        const id = sid(studentId);
        const per = settings.studentDays[id] && settings.studentDays[id][key];
        if (per !== undefined && per !== null && per !== '') return Number(per);
        const computed = schoolDaysInTerm(key);
        if (computed) return computed;
        const def = settings.defaultDays[key];
        if (def !== undefined && def !== null && def !== '') return Number(def);
        return 0;
    }

    function label(studentId) {
        const p = presentCount(studentId);
        const t = totalDays(studentId);
        if (!t && !p) return '';
        if (!t) return p + ' OUT OF —';
        return p + ' OUT OF ' + t;
    }

    function defaultDays(tk) {
        return schoolDaysInTerm(tk);
    }

    function setDefaultDays(n, tk) {
        load();
        settings.defaultDays[tk || termKey()] = Math.max(0, Number(n) || 0);
        persistSettings();
        refreshAllReportLabels();
    }

    function setTermRange(start, end, tk) {
        load();
        const key = tk || termKey();
        if (!settings.termRange[key]) settings.termRange[key] = {};
        if (start !== undefined) settings.termRange[key].start = start || '';
        if (end !== undefined) settings.termRange[key].end = end || '';
        persistSettings();
        refreshAllReportLabels();
        return schoolDaysInTerm(key);
    }

    function finalizeClosedTerm(endDate, tk) {
        load();
        const key = tk || termKey();
        const win = termWindow(key);
        const end = endDate || todayISO();
        const start = win.start || end;
        if (!settings.termRange[key]) settings.termRange[key] = {};
        settings.termRange[key].start = start;
        settings.termRange[key].end = end;
        settings.termRange[key].closedOn = end;
        const days = weekdayCount(start, end);
        settings.defaultDays[key] = days;
        persistSettings();
        refreshAllReportLabels();
        return days;
    }

    function setStudentDays(studentId, n, tk) {
        load();
        const key = tk || termKey();
        const id = sid(studentId);
        if (!settings.studentDays[id]) settings.studentDays[id] = {};
        if (n === '' || n === null || n === undefined) delete settings.studentDays[id][key];
        else settings.studentDays[id][key] = Math.max(0, Number(n) || 0);
        persistSettings();
        syncStudentReportLabel(id);
    }

    function setPresentOverride(studentId, n, tk) {
        load();
        const key = tk || termKey();
        const id = sid(studentId);
        if (!settings.studentPresentOverride[id]) settings.studentPresentOverride[id] = {};
        if (n === '' || n === null || n === undefined) delete settings.studentPresentOverride[id][key];
        else settings.studentPresentOverride[id][key] = Math.max(0, Number(n) || 0);
        persistSettings();
        syncStudentReportLabel(id);
    }

    function hasPresentOverride(studentId, tk) {
        load();
        const key = tk || termKey();
        const id = sid(studentId);
        const ov = settings.studentPresentOverride[id] && settings.studentPresentOverride[id][key];
        return ov !== undefined && ov !== null && ov !== '';
    }

    function summaryForClass(students, date) {
        load();
        let present = 0, absent = 0, late = 0, unmarked = 0;
        (students || []).forEach(s => {
            const m = getDay(s.id, date);
            if (!m) unmarked++;
            else if (m.status === 'present') present++;
            else if (m.status === 'absent') absent++;
            else if (m.status === 'late') late++;
        });
        return { present, absent, late, unmarked, total: (students || []).length };
    }

    let detailsCache = null;
    function syncStudentReportLabel(studentId, deferFlush) {
        if (!detailsCache) detailsCache = loadJSON('studentReportDetails', {}) || {};
        const id = sid(studentId);
        const numeric = Object.keys(detailsCache).find(k => String(k) === id);
        const key = numeric !== undefined ? numeric : id;
        if (!detailsCache[key]) detailsCache[key] = {};
        detailsCache[key].attendance = label(studentId);
        if (!deferFlush) flushReportDetails();
    }

    function flushReportDetails() {
        if (!detailsCache) return;
        saveJSON('studentReportDetails', detailsCache);
        detailsCache = null;
    }

    function refreshAllReportLabels() {
        const students = loadJSON('students', []) || [];
        detailsCache = loadJSON('studentReportDetails', {}) || {};
        students.forEach(s => syncStudentReportLabel(s.id, true));
        Object.keys(marks || {}).forEach(id => syncStudentReportLabel(id, true));
        flushReportDetails();
    }

    function actor() {
        return sessionStorage.getItem('teacherEmail')
            || sessionStorage.getItem('adminEmail')
            || 'staff';
    }

    global.Attendance = {
        load: load,
        hydrateFromServer: hydrateFromServer,
        todayISO: todayISO,
        termKey: termKey,
        isWeekend: isWeekend,
        isFuture: isFuture,
        markableError: markableError,
        weekdayCount: weekdayCount,
        schoolDaysInTerm: schoolDaysInTerm,
        termWindow: termWindow,
        getDay: getDay,
        mark: mark,
        markMany: markMany,
        presentCount: presentCount,
        absentCount: absentCount,
        totalDays: totalDays,
        defaultDays: defaultDays,
        label: label,
        setDefaultDays: setDefaultDays,
        setTermRange: setTermRange,
        finalizeClosedTerm: finalizeClosedTerm,
        setStudentDays: setStudentDays,
        setPresentOverride: setPresentOverride,
        hasPresentOverride: hasPresentOverride,
        summaryForClass: summaryForClass,
        refreshAllReportLabels: refreshAllReportLabels,
        actor: actor
    };
})(window);
