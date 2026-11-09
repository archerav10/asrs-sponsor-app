const { queryDatabase, updatePage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');
const lr = require('./location-report');

// Month-end close for the QI & RM work, on the admin dashboard. Kept on
// the existing QI & RM Monthly Checklists row for the month (one per
// month), plus the Location Compliance Reports and Liaison Flags tables:
//
//   Location reports filed   Final generated and "Filed in Drive" ticked, every home
//   Liaison flags decided    every flag in the month escalated or marked not needed
//   QI & RM report (620-06)  drafted -> reviewed at leadership -> signed (the
//                            QA/Issues Log review and Risk Tracking Tool update
//                            are part of that report)
//   Notion monthly checklist the checklist row's own Status
//
// Lights: green when done; for open items gray until the 10th of the next
// month, yellow the 10th to the 15th, red after the 15th (the checklist
// itself is due the last day of the month).

const QI_DB_ID = configId('QI_RM_CHECKLISTS_DB_ID');
const DUE_DAY = 15, WARN_DAY = 10;

function httpError(status, message) { const e = new Error(message); e.statusCode = status; return e; }
function d10(v) { return String(v || '').slice(0, 10); }
function fmt(iso) { const p = d10(iso).split('-'); return p.length === 3 ? (+p[1]) + '/' + (+p[2]) + '/' + p[0] : ''; }

async function checklistRow(month) {
  const r = await queryDatabase(QI_DB_ID, { property: 'Month', date: { equals: month + '-01' } });
  return (r.results || [])[0] || null;
}

function openStatus(today, warnFrom, dueOn) {
  if (today > dueOn) return 'red';
  if (today >= warnFrom) return 'yellow';
  return 'gray';
}

async function load(month, locations, now) {
  lr.monthBounds(month);
  const today = lr.easternToday(now);
  const next = lr.nextMonth(month);
  const due = next + '-' + DUE_DAY, warn = next + '-' + String(WARN_DAY).padStart(2, '0');
  const [row, reports, flags] = await Promise.all([checklistRow(month), lr.reportRows(month), lr.flagsForMonth(month)]);
  const p = row ? row.properties : {};
  const val = function (k) { return row ? getPlainText(p[k]) : ''; };
  const mine = flags.filter(function (f) { return locations.indexOf(f.location) !== -1; });
  const byLoc = {};
  reports.forEach(function (r) { byLoc[r.location] = r; });
  const homes = locations.map(function (l) {
    const r = byLoc[l];
    return { location: l, generated: !!r, generatedAt: r ? r.generatedAt : '', generatedBy: r ? r.generatedBy : '', overall: r ? r.overall : '', filed: !!(r && r.filed), filedOn: r ? r.filedOn : '', filedBy: r ? r.filedBy : '' };
  });
  const st = function (done) { return done ? 'green' : openStatus(today, warn, due); };
  const filedCount = homes.filter(function (h) { return h.filed; }).length;
  const decided = mine.filter(function (f) { return f.escalation; }).length;
  const qi = { drafted: d10(val('QI Report Drafted On')), reviewed: d10(val('QI Report Reviewed On')), signed: d10(val('QI Report Signed On')), by: val('QI Report By'), link: val('QI Report Link') };
  const checklistStatus = (row && p['Status'] && p['Status'].status && p['Status'].status.name) || 'Not started';
  const items = [
    { key: 'reports', label: 'Location reports (ASRS-520-03) filed', status: st(homes.length && filedCount === homes.length), text: filedCount + ' of ' + homes.length + ' filed in Drive', due: due },
    { key: 'flags', label: 'Liaison flags decided', status: st(decided === mine.length), text: mine.length ? decided + ' of ' + mine.length + ' escalated or marked not needed' : 'No flags this month', due: due },
    { key: 'qiReport', label: 'QI & RM report (ASRS-620-06)', status: st(!!qi.signed), text: qi.signed ? 'Signed ' + fmt(qi.signed) : qi.reviewed ? 'Reviewed at leadership ' + fmt(qi.reviewed) + '; not signed yet' : qi.drafted ? 'Drafted ' + fmt(qi.drafted) + '; not reviewed yet' : 'Not started', due: due },
    { key: 'checklist', label: 'Notion QI & RM monthly checklist', status: checklistStatus === 'Complete' ? 'green' : today > lr.monthBounds(month).end ? 'red' : today >= lr.monthBounds(month).end.slice(0, 8) + '25' ? 'yellow' : 'gray', text: row ? checklistStatus : 'No checklist page for this month', due: lr.monthBounds(month).end }
  ];
  return {
    month: month, monthLabel: lr.monthLabel(month), due: due, today: today,
    checklist: row ? { id: row.id, url: row.url, status: checklistStatus } : null,
    qi: qi, homes: homes, flags: mine, items: items
  };
}

function richText(s) { return { rich_text: s ? [{ text: { content: String(s).slice(0, 1900) } }] : [] }; }
function dateProp(on) { return on ? { date: { start: on } } : { date: null }; }

async function save(month, input, who, locations) {
  const today = lr.easternToday();
  if (input.action === 'filed') {
    if (locations.indexOf(input.location) === -1) throw httpError(403, 'Not authorized for that location.');
    return lr.setFiled(input.location, month, !!input.filed, who);
  }
  if (input.action === 'flag') {
    const flag = (await lr.flagsForMonth(month)).filter(function (f) { return f.id === input.flagId; })[0];
    if (!flag || locations.indexOf(flag.location) === -1) throw httpError(404, 'That flag wasn’t found.');
    return lr.updateFlag(flag.id, { escalation: input.escalation, resolved: input.resolved, escalationNote: input.escalationNote });
  }
  const row = await checklistRow(month);
  if (!row) throw httpError(400, 'There’s no QI & RM Monthly Checklist page for ' + lr.monthLabel(month) + ' in Notion yet.');
  const on = input.done === false ? null : today;
  let props;
  if (input.action === 'qiStep') {
    const prop = { drafted: 'QI Report Drafted On', reviewed: 'QI Report Reviewed On', signed: 'QI Report Signed On' }[input.step];
    if (!prop) throw httpError(400, 'Unknown step.');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : on;
    props = {}; props[prop] = dateProp(input.done === false ? null : date); props['QI Report By'] = richText(who);
  } else if (input.action === 'qiLink') {
    const link = String(input.link || '').trim();
    if (link && !/^https:\/\//.test(link)) throw httpError(400, 'Paste the Drive link (it starts with https://).');
    props = { 'QI Report Link': { url: link || null } };
  } else throw httpError(400, 'Unknown action.');
  await updatePage(row.id, props);
  return { ok: true };
}

module.exports = { load, save, checklistRow, DUE_DAY, WARN_DAY };
