const drive = require('./google-drive');
const { readXlsx, excelDate } = require('./xlsx');

// The ASRS Risk Tracking Tool (an Excel workbook kept in Google Drive and
// updated monthly) as data for the Monthly QI & RM Status and Compliance
// Report (ASRS-620-06). Reads the stored values, so the tool's formulas
// don't need to run here. Sheets used:
//   Individual Log                serious incidents (date, risk, level, location, follow-up)
//   Care Concerns & Risk Triggers DBHDS care concerns, ASRS detailed-RCA thresholds, 520.C.4
//   Compliance Log                every item for every location, monthly
//   Compliance Summary            "Reviewed? ✓" row
//   Review Log                    monthly reviews
//   Quarterly & Annual Worksheet  quarter summaries
//   Location Summary              incidents by service and location
//   SRA Qn yyyy - All Services    quarterly Systemic Risk Assessments

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fileIdFromLink(link) {
  const s = String(link || '').trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

async function loadRiskTool(link) {
  const id = fileIdFromLink(link);
  if (!id) throw Object.assign(new Error('Paste the Risk Tracking Tool\'s Google Drive link.'), { statusCode: 400 });
  let file;
  try {
    file = await drive.fileContent(id);
  } catch (e) {
    throw Object.assign(new Error('Couldn\'t open the Risk Tracking Tool in Google Drive (' + (e.message || 'error') + '). Check the link, and that the file is in the ASRS Drive the app reads.'), { statusCode: 400 });
  }
  let wb;
  try { wb = readXlsx(file.buffer); } catch (e) {
    throw Object.assign(new Error('The Risk Tracking Tool isn\'t an Excel (.xlsx) file the app can read: ' + e.message), { statusCode: 400 });
  }
  if (!wb.sheet('Individual Log') || !wb.sheet('Compliance Log')) throw Object.assign(new Error('That file doesn\'t look like the Risk Tracking Tool (no Individual Log or Compliance Log sheet).'), { statusCode: 400 });
  return { id: id, name: file.name, wb: wb };
}

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function headerIndex(row, re) { return (row || []).findIndex(function (h) { return re.test(norm(h)); }); }

// Serious incidents in the month (Individual Log).
function incidents(wb, month) {
  const rows = wb.sheet('Individual Log') || [];
  const h = rows[0] || [];
  const c = {
    name: headerIndex(h, /^name/i), date: headerIndex(h, /^date/i), risk: headerIndex(h, /^risk/i), level: headerIndex(h, /^level/i),
    notes: headerIndex(h, /^notes/i), location: headerIndex(h, /^location/i), follow: headerIndex(h, /follow-up/i)
  };
  const list = [];
  rows.slice(1).forEach(function (r) {
    const date = excelDate(r[c.date]);
    if (!date || date.slice(0, 7) !== month) return;
    list.push({ initials: norm(r[c.name]), date: date, risk: norm(r[c.risk]), level: norm(r[c.level]), notes: norm(r[c.notes]), location: norm(r[c.location]), followUp: norm(r[c.follow]) });
  });
  const count = function (lvl) { return list.filter(function (i) { return new RegExp('level\\s*' + lvl + '$', 'i').test(i.level); }).length; };
  // RCAs due this month: "[RCA] RCA and reassessment due by 7/17/2026." on any incident.
  const rcaDue = [];
  rows.slice(1).forEach(function (r) {
    const f = norm(r[c.follow]);
    const m = f.match(/due by (\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (m && excelDate(m[1]).slice(0, 7) === month) rcaDue.push({ initials: norm(r[c.name]), date: excelDate(r[c.date]), location: norm(r[c.location]), due: excelDate(m[1]), followUp: f });
  });
  return { list: list, levelI: count('I'), levelII: count('II'), levelIII: count('III'), rcaDue: rcaDue };
}

// Care Concerns & Risk Triggers: the month's column.
function careConcerns(wb, month) {
  const rows = wb.sheet('Care Concerns & Risk Triggers') || [];
  const hi = rows.findIndex(function (r) { return (r || []).some(function (x) { return norm(x) === 'Jan'; }); });
  if (hi < 0) return null;
  const col = headerIndex(rows[hi], new RegExp('^' + ABBR[Number(month.slice(5, 7)) - 1] + '$', 'i'));
  const out = { careConcerns: [], detailedRca: [], restraint: [] };
  rows.slice(hi + 1).forEach(function (r) {
    const label = norm(r[0]);
    if (!label) return;
    const n = Number(r[col]) || 0;
    const entry = { label: label, count: n };
    if (/^ASRS detailed RCA/i.test(label)) out.detailedRca.push(entry);
    else if (/520\.C\.4|restraint|seclusion/i.test(label)) out.restraint.push(entry);
    else out.careConcerns.push(entry);
  });
  const sum = function (a) { return a.reduce(function (s, e) { return s + e.count; }, 0); };
  out.careConcernsMet = sum(out.careConcerns);
  out.detailedRcaMet = sum(out.detailedRca);
  out.restraintCount = sum(out.restraint);
  return out;
}

// Compliance Log rows for the month: complete when every row is marked.
function complianceLog(wb, month) {
  const rows = wb.sheet('Compliance Log') || [];
  const h = rows[0] || [];
  const c = { month: headerIndex(h, /^month$/i), location: headerIndex(h, /^location/i), item: headerIndex(h, /^item #/i), what: headerIndex(h, /^item to check/i), ok: headerIndex(h, /^compliant/i), finding: headerIndex(h, /^finding/i), action: headerIndex(h, /^action/i), status: headerIndex(h, /^status/i) };
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  const mine = rows.slice(1).filter(function (r) { return norm(r[c.month]).toLowerCase() === name.toLowerCase(); });
  const unmarked = mine.filter(function (r) { return !norm(r[c.ok]); });
  const findings = mine.filter(function (r) { return /^no$/i.test(norm(r[c.ok])); }).map(function (r) {
    return { item: norm(r[c.item]), what: norm(r[c.what]), location: norm(r[c.location]), finding: norm(r[c.finding]), action: norm(r[c.action]), status: norm(r[c.status]) };
  });
  // Compliance Summary "Reviewed? ✓" for the month.
  const cs = wb.sheet('Compliance Summary') || [];
  const hi = cs.findIndex(function (r) { return (r || []).some(function (x) { return norm(x) === 'Jan'; }); });
  let reviewedMark = '';
  if (hi >= 0) {
    const col = headerIndex(cs[hi], new RegExp('^' + ABBR[Number(month.slice(5, 7)) - 1] + '$', 'i'));
    const rr = cs.find(function (r) { return /^reviewed\?/i.test(norm(r[1])) || /^reviewed\?/i.test(norm(r[0])); });
    if (rr && col >= 0) reviewedMark = norm(rr[col]);
  }
  return { rows: mine.length, unmarked: unmarked.length, complete: mine.length > 0 && unmarked.length === 0, findings: findings, reviewedMark: reviewedMark };
}

function reviewLog(wb, month) {
  const rows = wb.sheet('Review Log') || [];
  const h = rows[0] || [];
  const c = { date: headerIndex(h, /^date of review/i), month: headerIndex(h, /^month reviewed/i), type: headerIndex(h, /^review type/i), loc: headerIndex(h, /^location/i), what: headerIndex(h, /^what was reviewed/i), findings: headerIndex(h, /^findings/i), actions: headerIndex(h, /^actions/i), by: headerIndex(h, /^reviewed by/i) };
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  return rows.slice(1).filter(function (r) { return norm(r[c.month]).toLowerCase() === name.toLowerCase() && excelDate(r[c.date]); }).map(function (r) {
    return { date: excelDate(r[c.date]), type: norm(r[c.type]), location: norm(r[c.loc]), what: norm(r[c.what]), findings: norm(r[c.findings]), actions: norm(r[c.actions]), by: norm(r[c.by]) };
  });
}

// Quarterly & Annual Worksheet: the block for quarter n (1-4).
function quarterWorksheet(wb, n) {
  const rows = wb.sheet('Quarterly & Annual Worksheet') || [];
  const start = rows.findIndex(function (r) { return new RegExp('^Quarter ' + n + '\\b', 'i').test(norm(r[0])); });
  if (start < 0) return null;
  const out = { heading: norm(rows[start][0]), rows: [] };
  for (let i = start + 1; i < rows.length; i++) {
    const label = norm(rows[i][0]);
    if (!label || /^(Quarter \d|ANNUAL)/i.test(label)) break;
    out.rows.push({ label: label.replace(/\.\s.*$/, ''), incidents: norm(rows[i][1]), triggers: norm(rows[i][2]) });
  }
  out.filled = out.rows.some(function (r) { return r.incidents || r.triggers; });
  return out;
}

// Location Summary: incidents by location for quarter n.
function locationSummary(wb, n) {
  const rows = wb.sheet('Location Summary') || [];
  const out = [];
  rows.forEach(function (r) {
    const svc = norm(r[0]), loc = norm(r[1]);
    if (!loc || !/residential|engagement|group home/i.test(svc)) return;
    const base = 2 + (n - 1) * 3;
    out.push({ service: svc, location: loc, levelI: Number(r[base]) || 0, levelII: Number(r[base + 1]) || 0, levelIII: Number(r[base + 2]) || 0 });
  });
  return out;
}

// SRA Qn yyyy sheet: who completed it, and items escalated to the Plan.
function sra(wb, n, year) {
  const name = wb.sheetNames.find(function (s) { return new RegExp('^SRA Q' + n + ' ' + year + '\\b', 'i').test(s); });
  if (!name) return null;
  const rows = wb.sheet(name) || [];
  let completed = '';
  rows.slice(0, 8).forEach(function (r) {
    const i = (r || []).findIndex(function (x) { return /^completed by/i.test(norm(x)); });
    if (i >= 0) completed = norm(r[i + 1]);
  });
  const hi = rows.findIndex(function (r) { return (r || []).some(function (x) { return /^escalate/i.test(norm(x)); }); });
  const escalated = [];
  if (hi >= 0) {
    const ec = headerIndex(rows[hi], /^escalate/i), ac = headerIndex(rows[hi], /^action/i);
    rows.slice(hi + 1).forEach(function (r) {
      if (/^y/i.test(norm(r[ec]))) escalated.push({ item: norm(r[0]) + ' ' + norm(r[1]), action: norm(r[ac]) });
    });
  }
  return { sheet: name, completed: completed, done: !!completed && !/\[date\]|\[.*\]/.test(completed), escalated: escalated };
}

// Everything the monthly report reads, in one object.
function forMonth(tool, month) {
  const wb = tool.wb;
  const mo = Number(month.slice(5, 7));
  const quarterEnd = mo === 1 || mo === 4 || mo === 7 || mo === 10;
  const out = {
    file: { id: tool.id, name: tool.name },
    incidents: incidents(wb, month),
    careConcerns: careConcerns(wb, month),
    compliance: complianceLog(wb, month),
    reviews: reviewLog(wb, month)
  };
  if (quarterEnd) {
    // The quarter just ended (January -> Q4 of last year).
    const q = mo === 1 ? 4 : (mo - 1) / 3;
    const year = mo === 1 ? String(Number(month.slice(0, 4)) - 1) : month.slice(0, 4);
    // Compliance Log findings for the quarter's three months.
    const qMonths = [1, 2, 3].map(function (k) { return year + '-' + String((q - 1) * 3 + k).padStart(2, '0'); });
    const byItem = {};
    let total = 0;
    qMonths.forEach(function (m) {
      complianceLog(wb, m).findings.forEach(function (f) {
        total++;
        const key = f.item + ' ' + f.what;
        (byItem[key] = byItem[key] || []).push(f.location + ' (' + MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3) + ')');
      });
    });
    const findings = { total: total, text: total ? total + ' findings: ' + Object.keys(byItem).map(function (k) { return k + ' - ' + byItem[k].join(', '); }).join('; ') : 'No findings in the quarter.' };
    out.quarter = { n: q, year: year, worksheet: quarterWorksheet(wb, q), locations: locationSummary(wb, q), sra: sra(wb, q, year), findings: findings };
  }
  return out;
}

module.exports = { fileIdFromLink, loadRiskTool, forMonth, incidents, careConcerns, complianceLog, reviewLog, quarterWorksheet, locationSummary, sra, MONTHS };
