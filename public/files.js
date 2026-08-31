/* OneReal file helper — works even when the preview iframe blocks Downloads */
(function (global) {
    'use strict';

    var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    function safeName(name) {
        return String(name || 'download')
            .replace(/[/\\?%*:|"<>]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 140);
    }

    function toBlob(data, mime) {
        if (data instanceof Blob) return mime && data.type !== mime ? new Blob([data], { type: mime }) : data;
        if (data instanceof ArrayBuffer) return new Blob([data], { type: mime || 'application/octet-stream' });
        if (data instanceof Uint8Array) {
            var copy = new Uint8Array(data.byteLength);
            copy.set(data);
            return new Blob([copy], { type: mime || 'application/octet-stream' });
        }
        return new Blob([data == null ? '' : data], { type: mime || 'application/octet-stream' });
    }

    function csvCell(value) {
        var s = value == null ? '' : String(value);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function toCsv(rows, headers) {
        if (!rows || !rows.length) return '\uFEFF';
        var cols = headers;
        if (!cols) {
            if (Array.isArray(rows[0])) {
                return '\uFEFF' + rows.map(function (r) {
                    return (Array.isArray(r) ? r : [r]).map(csvCell).join(',');
                }).join('\r\n');
            }
            cols = Object.keys(rows[0]);
        }
        var lines = [cols.map(csvCell).join(',')];
        rows.forEach(function (r) {
            lines.push(cols.map(function (h, i) {
                return csvCell(Array.isArray(r) ? r[i] : r[h]);
            }).join(','));
        });
        return '\uFEFF' + lines.join('\r\n');
    }

    function parseCsv(text) {
        var rows = [];
        var row = [];
        var cell = '';
        var inQuotes = false;
        var s = String(text || '').replace(/^\uFEFF/, '');
        for (var i = 0; i < s.length; i++) {
            var c = s[i];
            if (inQuotes) {
                if (c === '"') {
                    if (s[i + 1] === '"') { cell += '"'; i++; }
                    else inQuotes = false;
                } else cell += c;
            } else if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                row.push(cell); cell = '';
            } else if (c === '\n') {
                row.push(cell); rows.push(row); row = []; cell = '';
            } else if (c !== '\r') {
                cell += c;
            }
        }
        if (cell.length || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(function (r) {
            return r.some(function (v) { return String(v || '').trim(); });
        });
    }

    function parseCsvObjects(text) {
        var rows = parseCsv(text);
        if (!rows.length) return [];
        var headers = rows[0].map(function (h) { return String(h || '').trim(); });
        return rows.slice(1).map(function (r) {
            var obj = {};
            headers.forEach(function (h, idx) { obj[h] = r[idx] != null ? String(r[idx]).trim() : ''; });
            return obj;
        });
    }

    function crc32(buf) {
        var c = ~0;
        for (var i = 0; i < buf.length; i++) {
            c ^= buf[i];
            for (var k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
        }
        return (~c) >>> 0;
    }

    function u8(str) {
        return new TextEncoder().encode(str);
    }

    function concatBytes(parts) {
        var total = 0;
        parts.forEach(function (p) { total += p.length; });
        var out = new Uint8Array(total);
        var off = 0;
        parts.forEach(function (p) { out.set(p, off); off += p.length; });
        return out;
    }

    function xmlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function colName(index) {
        var n = index;
        var s = '';
        while (n >= 0) {
            s = String.fromCharCode((n % 26) + 65) + s;
            n = Math.floor(n / 26) - 1;
        }
        return s;
    }

    function sheetXml(rows) {
        var lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
            '<sheetData>'
        ];
        (rows || []).forEach(function (row, r) {
            var cells = (Array.isArray(row) ? row : Object.values(row || {})).map(function (value, c) {
                var ref = colName(c) + (r + 1);
                var text = xmlEscape(value);
                if (value !== '' && value != null && !isNaN(value) && String(value).trim() !== '' && !/^0\d/.test(String(value))) {
                    return '<c r="' + ref + '"><v>' + String(value) + '</v></c>';
                }
                return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + text + '</t></is></c>';
            }).join('');
            lines.push('<row r="' + (r + 1) + '">' + cells + '</row>');
        });
        lines.push('</sheetData></worksheet>');
        return lines.join('');
    }

    function zipStore(files) {
        var locals = [];
        var centrals = [];
        var offset = 0;
        Object.keys(files).forEach(function (name) {
            var data = files[name] instanceof Uint8Array ? files[name] : u8(files[name]);
            var nameBuf = u8(name);
            var crc = crc32(data);
            var local = new Uint8Array(30);
            var lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, data.length, true);
            lv.setUint32(22, data.length, true);
            lv.setUint16(26, nameBuf.length, true);
            var localFull = concatBytes([local, nameBuf, data]);
            locals.push(localFull);
            var central = new Uint8Array(46);
            var cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, nameBuf.length, true);
            cv.setUint32(42, offset, true);
            centrals.push(concatBytes([central, nameBuf]));
            offset += localFull.length;
        });
        var centralDir = concatBytes(centrals);
        var end = new Uint8Array(22);
        var ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, Object.keys(files).length, true);
        ev.setUint16(10, Object.keys(files).length, true);
        ev.setUint32(12, centralDir.length, true);
        ev.setUint32(16, offset, true);
        return concatBytes(locals.concat([centralDir, end]));
    }

    function rowsFromAnything(list) {
        if (!list || !list.length) return [['(no rows)']];
        if (Array.isArray(list[0])) return list;
        var headers = [];
        list.forEach(function (item) {
            Object.keys(item || {}).forEach(function (k) {
                if (headers.indexOf(k) < 0) headers.push(k);
            });
        });
        return [headers].concat(list.map(function (item) {
            return headers.map(function (h) { return item && item[h] != null ? item[h] : ''; });
        }));
    }

    function buildXlsx(rows, sheetName) {
        var name = String(sheetName || 'Sheet1').slice(0, 31).replace(/[\\/?*\[\]]/g, ' ');
        var table = rowsFromAnything(rows);
        var files = {
            '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '</Types>',
            '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>',
            'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<sheets><sheet name="' + xmlEscape(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '</Relationships>',
            'xl/worksheets/sheet1.xml': sheetXml(table)
        };
        return zipStore(files);
    }

    function tsvFromRows(rows) {
        return (rows || []).map(function (r) {
            return (Array.isArray(r) ? r : [r]).map(function (v) {
                return String(v == null ? '' : v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
            }).join('\t');
        }).join('\n');
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
        return Promise.resolve();
    }

    async function writeWithPicker(blob, filename) {
        if (!window.showSaveFilePicker) return false;
        var handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{
                description: 'Excel file',
                accept: {
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
                    'text/csv': ['.csv'],
                    'application/pdf': ['.pdf']
                }
            }]
        });
        var writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
    }

    async function shareFile(blob, filename) {
        var file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        if (!navigator.canShare) return false;
        try {
            if (!navigator.canShare({ files: [file] })) return false;
            await navigator.share({ files: [file], title: filename });
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') return true;
            return false;
        }
    }

    function clickAnchor(url, filename) {
        var a = document.createElement('a');
        a.href = url;
        a.setAttribute('download', filename);
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    }

    async function saveBlob(blob, filename) {
        filename = safeName(filename);
        try {
            if (await writeWithPicker(blob, filename)) return { ok: true, how: 'picker' };
        } catch (e) {
            if (e && e.name === 'AbortError') return { ok: false, how: 'cancel' };
        }
        try {
            if (await shareFile(blob, filename)) return { ok: true, how: 'share' };
        } catch (e) {}
        var url = URL.createObjectURL(blob);
        clickAnchor(url, filename);
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
        return { ok: true, how: 'link' };
    }

    function csvUrlFor(url) {
        if (!url) return url;
        return String(url)
            .replace(/\.xlsx(\?|$)/i, '.csv$1')
            .replace(/\/api\/templates\/([a-z]+)$/i, '/api/templates/$1.csv');
    }

    function guessName(url, fallback) {
        if (fallback) return safeName(fallback);
        try {
            var path = String(url || '').split('?')[0];
            var last = decodeURIComponent(path.split('/').pop() || 'export');
            return safeName(last || 'export');
        } catch (e) {
            return 'export';
        }
    }

    function ensureStyles() {
        if (document.getElementById('onerealSheetCss')) return;
        var css = document.createElement('style');
        css.id = 'onerealSheetCss';
        css.textContent =
            '#onerealSheet{position:fixed;inset:0;z-index:2147483646;background:rgba(15,23,42,.62);display:flex;align-items:flex-end;justify-content:center;padding:0;}' +
            '#onerealSheet .os-card{background:#fff;color:#0f172a;width:100%;max-width:920px;max-height:96vh;border-radius:18px 18px 0 0;padding:18px 16px 20px;box-shadow:0 -12px 40px rgba(0,0,0,.28);font:14px/1.45 Inter,system-ui,sans-serif;display:flex;flex-direction:column;}' +
            '#onerealSheet h2{margin:0 0 6px;font-size:18px;}' +
            '#onerealSheet .os-note{color:#475569;font-size:13px;margin:0 0 12px;}' +
            '#onerealSheet .os-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}' +
            '#onerealSheet button,#onerealSheet .os-btn{appearance:none;border:0;border-radius:10px;padding:12px 14px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;background:#4f46e5;color:#fff;text-decoration:none;display:inline-flex;align-items:center;gap:6px;}' +
            '#onerealSheet button.alt{background:#0f766e;}' +
            '#onerealSheet button.ghost{background:#e2e8f0;color:#0f172a;}' +
            '#onerealSheet .os-status{min-height:20px;color:#166534;font-weight:700;font-size:13px;margin:0 0 8px;}' +
            '#onerealSheet .os-status.err{color:#b91c1c;}' +
            '#onerealSheet .os-tablewrap{overflow:auto;border:1px solid #e2e8f0;border-radius:10px;max-height:52vh;background:#fff;}' +
            '#onerealSheet table{border-collapse:collapse;width:100%;font-size:12px;}' +
            '#onerealSheet th,#onerealSheet td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;white-space:nowrap;}' +
            '#onerealSheet th{background:#f8fafc;position:sticky;top:0;}' +
            '#onerealSheet textarea{width:100%;min-height:90px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font:12px/1.4 ui-monospace,monospace;}' +
            '@media (min-width:720px){#onerealSheet{align-items:center;padding:24px;}#onerealSheet .os-card{border-radius:16px;max-height:90vh;padding:22px;}}';
        document.head.appendChild(css);
    }

    var current = { rows: null, blob: null, filename: '', csv: '', mime: '' };

    function setStatus(msg, isErr) {
        var el = document.getElementById('osStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'os-status' + (isErr ? ' err' : '');
    }

    function renderTable(rows) {
        var wrap = document.getElementById('osTable');
        if (!wrap) return;
        if (!rows || !rows.length) {
            wrap.innerHTML = '<p class="os-note">No rows in this file yet.</p>';
            return;
        }
        var html = '<div class="os-tablewrap"><table><tbody>' + rows.map(function (r, i) {
            var tag = i === 0 ? 'th' : 'td';
            return '<tr>' + (Array.isArray(r) ? r : [r]).map(function (c) {
                return '<' + tag + '>' + String(c == null ? '' : c).replace(/</g, '&lt;') + '</' + tag + '>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
        wrap.innerHTML = html;
    }

    function closeSheet() {
        var el = document.getElementById('onerealSheet');
        if (el) el.remove();
    }

    function showPanel(opts) {
        ensureStyles();
        closeSheet();
        current.rows = opts.rows || null;
        current.blob = opts.blob || null;
        current.filename = safeName(opts.filename || 'export.xlsx');
        current.csv = opts.csv || '';
        current.mime = opts.mime || '';
        var root = document.createElement('div');
        root.id = 'onerealSheet';
        var isSheet = !!(opts.rows && opts.rows.length);
        root.innerHTML =
            '<div class="os-card" role="dialog" aria-modal="true">' +
            '<h2>' + String(opts.title || current.filename).replace(/</g, '&lt;') + '</h2>' +
            '<p class="os-note">This preview window often blocks automatic Downloads. Use <strong>Save Excel</strong> (on a phone choose Save to Files / Downloads) or <strong>Copy table</strong> and paste into Excel or Google Sheets.</p>' +
            '<div class="os-row">' +
            (isSheet ? '<button type="button" id="osSaveXlsx">Save Excel</button><button type="button" class="alt" id="osCopy">Copy table</button><button type="button" class="ghost" id="osSelectCsv">Select CSV</button>' : '<button type="button" id="osSaveFile">Save file</button>') +
            '<button type="button" class="ghost" id="osClose">Close</button>' +
            '</div>' +
            '<p class="os-status" id="osStatus"></p>' +
            '<div id="osTable"></div>' +
            (isSheet ? '<textarea id="osCsv" readonly></textarea>' : '') +
            '</div>';
        document.body.appendChild(root);
        if (isSheet) {
            renderTable(opts.rows);
            var ta = document.getElementById('osCsv');
            if (ta) ta.value = current.csv || toCsv(opts.rows);
        }
        document.getElementById('osClose').onclick = closeSheet;
        root.addEventListener('click', function (e) { if (e.target === root) closeSheet(); });
        var saveX = document.getElementById('osSaveXlsx');
        if (saveX) saveX.onclick = function () { doSave(true); };
        var saveF = document.getElementById('osSaveFile');
        if (saveF) saveF.onclick = function () { doSave(false); };
        var copyB = document.getElementById('osCopy');
        if (copyB) copyB.onclick = function () {
            copyText(tsvFromRows(current.rows || [])).then(function () {
                setStatus('Copied. Open Excel or Google Sheets and paste.');
            }).catch(function () { setStatus('Copy failed. Select the CSV box and copy it.', true); });
        };
        var sel = document.getElementById('osSelectCsv');
        if (sel) sel.onclick = function () {
            var box = document.getElementById('osCsv');
            if (!box) return;
            box.focus();
            box.select();
            setStatus('CSV selected. Copy it, then paste into Excel.');
        };
    }

    async function doSave(preferXlsx) {
        try {
            var blob = current.blob;
            var name = current.filename;
            if (preferXlsx && current.rows) {
                var bytes = buildXlsx(current.rows, name.replace(/\.[^.]+$/, ''));
                blob = new Blob([bytes], { type: XLSX_MIME });
                if (!/\.xlsx$/i.test(name)) name += '.xlsx';
            }
            if (!blob) {
                blob = new Blob([current.csv || ''], { type: 'text/csv;charset=utf-8' });
                if (!/\.csv$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.csv';
            }
            setStatus('Saving…');
            var res = await saveBlob(blob, name);
            if (res.how === 'picker') setStatus('Saved. Check the folder you chose — usually Downloads.');
            else if (res.how === 'share') setStatus('Share sheet opened. Choose Save to Files or Downloads.');
            else if (res.how === 'cancel') setStatus('Save cancelled.');
            else {
                setStatus('If no file appeared, tap Copy table and paste into Excel. On a phone, Save Excel opens a share sheet — pick Save to Files.');
                if (current.rows) {
                    try { await copyText(tsvFromRows(current.rows)); } catch (e) {}
                }
            }
        } catch (e) {
            setStatus((e && e.message) || 'Could not save file.', true);
        }
    }

    function jsonToRows(data) {
        if (Array.isArray(data)) return rowsFromAnything(data);
        if (data && typeof data === 'object') {
            var keys = Object.keys(data);
            var firstArr = keys.map(function (k) { return data[k]; }).find(function (v) { return Array.isArray(v); });
            if (firstArr) return rowsFromAnything(firstArr);
            return [['Field', 'Value']].concat(keys.map(function (k) {
                var v = data[k];
                return [k, typeof v === 'object' ? JSON.stringify(v) : v];
            }));
        }
        return [['value'], [String(data)]];
    }

    async function openUrl(url, filename) {
        filename = guessName(url, filename);
        showPanel({ title: filename, filename: filename, rows: [['Loading…']], csv: '' });
        setStatus('Preparing file…');
        try {
            var fetchUrl = csvUrlFor(url);
            var res = await fetch(fetchUrl, { credentials: 'same-origin' });
            if (!res.ok) throw new Error('Could not load ' + fetchUrl + ' (' + res.status + ')');
            var ctype = (res.headers.get('content-type') || '').toLowerCase();
            var rows = null;
            var csv = '';
            var blob = null;
            if (/json/.test(ctype) || /\.json($|\?)/i.test(fetchUrl) || /\/backup($|\?)/i.test(fetchUrl)) {
                var json = await res.json();
                rows = jsonToRows(json);
                csv = toCsv(rows);
                blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json;charset=utf-8' });
                if (!/\.json$/i.test(filename)) filename = filename.replace(/\.[^.]+$/, '') + '.json';
                showPanel({ title: filename, filename: filename, rows: rows, csv: csv, blob: blob });
                setStatus('File ready. Save Excel makes a spreadsheet. JSON backup is also prepared.');
                return { ok: true };
            }
            var text = await res.text();
            if (text.charAt(0) === '{' || text.charAt(0) === '[') {
                try {
                    var parsed = JSON.parse(text);
                    rows = jsonToRows(parsed);
                    csv = toCsv(rows);
                    blob = new Blob([text], { type: 'application/json;charset=utf-8' });
                    showPanel({ title: filename, filename: filename, rows: rows, csv: csv, blob: blob });
                    setStatus('File ready.');
                    return { ok: true };
                } catch (e) {}
            }
            rows = parseCsv(text);
            if (!rows.length) rows = [['(empty file)']];
            csv = text.indexOf(',') >= 0 ? text : toCsv(rows);
            var xname = filename.replace(/\.csv$/i, '.xlsx');
            if (!/\.xlsx$/i.test(xname)) xname += '.xlsx';
            var bytes = buildXlsx(rows, xname.replace(/\.[^.]+$/, ''));
            blob = new Blob([bytes], { type: XLSX_MIME });
            showPanel({ title: xname, filename: xname, rows: rows, csv: csv, blob: blob });
            setStatus('Excel file is ready. Tap Save Excel.');
            return { ok: true };
        } catch (e) {
            showPanel({ title: filename, filename: filename, rows: [['Could not load file', String(e.message || e)]], csv: '' });
            setStatus(e.message || 'Could not load file.', true);
            return { ok: false };
        }
    }

    async function openData(filename, data, mime) {
        filename = safeName(filename);
        var blob = toBlob(data, mime || 'application/octet-stream');
        var rows = null;
        var csv = '';
        var kind = (mime || blob.type || '').toLowerCase();
        if (/csv|text\//.test(kind) || /\.csv$/i.test(filename)) {
            var text = typeof data === 'string' ? data : await blob.text();
            rows = parseCsv(text);
            csv = text;
            var xname = filename.replace(/\.csv$/i, '.xlsx');
            var bytes = buildXlsx(rows.length ? rows : [['(empty)']], xname.replace(/\.[^.]+$/, ''));
            blob = new Blob([bytes], { type: XLSX_MIME });
            filename = /\.xlsx$/i.test(xname) ? xname : xname + '.xlsx';
            showPanel({ title: filename, filename: filename, rows: rows, csv: csv, blob: blob });
            setStatus('Excel file is ready. Tap Save Excel.');
            return { ok: true };
        }
        showPanel({ title: filename, filename: filename, blob: blob, mime: kind });
        setStatus('File is ready. Tap Save file.');
        return { ok: true };
    }

    function openSheetPage(url) {
        location.href = '/open?src=' + encodeURIComponent(url);
        return { ok: true, url: url };
    }

    global.OneRealFiles = {
        arm: function () { return null; },
        open: function (url) { return openSheetPage(url); },
        downloadUrl: function (url) { return openSheetPage(url); },
        download: function (filename, data, mime) { return openData(filename, data, mime); },
        saveBlob: saveBlob,
        buildXlsx: buildXlsx,
        parseCsv: parseCsvObjects,
        parseCsvRows: parseCsv,
        toCsv: toCsv,
        csvCell: csvCell,
        safeName: safeName,
        close: closeSheet
    };
})(window);
