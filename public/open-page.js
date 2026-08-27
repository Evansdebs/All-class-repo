'use strict';

function esc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function cell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function toCsv(rows) {
    return '\uFEFF' + (rows || []).map(row => {
        return (Array.isArray(row) ? row : [row]).map(cell).join(',');
    }).join('\r\n');
}

function toTsv(rows) {
    return (rows || []).map(row => {
        return (Array.isArray(row) ? row : [row]).map(v => String(v == null ? '' : v).replace(/\t/g, ' ')).join('\t');
    }).join('\n');
}

function objectsToRows(list) {
    if (!list || !list.length) return [['(no rows)']];
    if (Array.isArray(list[0])) return list;
    const headers = [];
    list.forEach(item => Object.keys(item || {}).forEach(k => {
        if (!headers.includes(k)) headers.push(k);
    }));
    return [headers, ...list.map(item => headers.map(h => item && item[h] != null ? item[h] : ''))];
}

function renderOpenPage(title, filename, rows) {
    const table = objectsToRows(rows);
    const csv = toCsv(table);
    const tsv = toTsv(table);
    const tableHtml = table.map((row, i) => {
        const tag = i === 0 ? 'th' : 'td';
        return '<tr>' + (Array.isArray(row) ? row : [row]).map(c => `<${tag}>${esc(c)}</${tag}>`).join('') + '</tr>';
    }).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b1220;color:#f8fafc;padding:16px}
.wrap{max-width:960px;margin:0 auto}
h1{font-size:20px;margin:8px 0}
.note{background:#1e293b;border:1px solid #334155;padding:12px 14px;border-radius:12px;color:#cbd5e1;line-height:1.45}
.row{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
button,a.btn{appearance:none;border:0;border-radius:10px;padding:12px 14px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;background:#4f46e5;color:#fff;text-decoration:none;display:inline-flex;align-items:center}
button.alt{background:#0f766e}
button.ghost,a.ghost{background:#334155}
.status{min-height:20px;color:#86efac;font-weight:700;font-size:13px}
.tablewrap{overflow:auto;background:#fff;color:#0f172a;border-radius:10px;max-height:55vh}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;white-space:nowrap}
th{background:#f1f5f9;position:sticky;top:0}
textarea{width:100%;min-height:120px;margin-top:12px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e2e8f0;padding:10px;font:12px/1.4 ui-monospace,monospace}
a.back{color:#93c5fd}
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/admin.html">← Admin</a> ·
  <a class="back" href="/report.html">Teacher</a> ·
  <a class="back" href="/student.html">Student</a>
  <h1>${esc(title)}</h1>
  <p class="note">This preview window cannot put a file in your computer Downloads folder. Copy the table and paste it into Excel or Google Sheets. On a phone, tap the CSV box, press and hold, then Copy.</p>
  <div class="row">
    <button type="button" id="copyBtn">Copy table</button>
    <button type="button" class="alt" id="selectBtn">Select CSV</button>
    <a class="btn ghost" href="/admin.html">Back to Admin</a>
  </div>
  <p class="status" id="status">Table is ready. Tap Copy table.</p>
  <div class="tablewrap"><table>${tableHtml}</table></div>
  <textarea id="csvBox" readonly>${esc(csv)}</textarea>
</div>
<script>
var tsv = ${JSON.stringify(tsv)};
var box = document.getElementById('csvBox');
function status(msg){ document.getElementById('status').textContent = msg; }
function copyNow(text){
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  box.focus(); box.select();
  document.execCommand('copy');
  return Promise.resolve();
}
document.getElementById('copyBtn').onclick = function(){
  copyNow(tsv).then(function(){ status('Copied. Open Excel or Google Sheets and paste.'); })
    .catch(function(){ box.focus(); box.select(); status('Select the CSV box, copy it, then paste into Excel.'); });
};
document.getElementById('selectBtn').onclick = function(){
  box.focus(); box.select();
  status('CSV selected. Copy it, then paste into Excel.');
};
try { box.focus(); box.select(); } catch (e) {}
</script>
</body>
</html>`;
}

module.exports = { renderOpenPage, objectsToRows, toCsv };
