const { queryDatabase, queryDatabaseAll, createPage, updatePage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');

// Monthly Location Compliance Report (ASRS-520-03) for one location and
// month, in two modes:
//
//   final  The whole month, judged once it has ended. Anything that had
//          to happen during the month and didn't is red. The first Final
//          for a month saves a frozen snapshot (Location Compliance
//          Reports); later downloads reuse it unless regenerated.
//   mtd    Month to date (preview). Anything not done yet but still due
//          before the month ends is yellow, not red. Never saved.
//
// Every item is { s, req, found, src } with s one of g (compliant),
// y (due soon / still due), r (action needed), m (a person answers it),
// n (N/A). Each area's light is its worst item; m and n don't count.
// Findings are every red item plus every liaison flag in the month.
//
// Each area is built on its own; one that can't be read (a lookup
// failed) shows a single "Couldn't check" item instead of failing the
// report.

const REPORTS_DB_ID = configId('LOCATION_REPORTS_DB_ID');
const FLAGS_DB_ID = configId('LIAISON_FLAGS_DB_ID');
const PHYSICAL_ENV_DB_ID = process.env.PHYSICAL_ENV_DB_ID;
const FIRST_AID_DB_ID = process.env.FIRST_AID_DB_ID;
const EMERGENCY_SUPPLIES_DB_ID = process.env.EMERGENCY_SUPPLIES_DB_ID;
const FIRE_DRILL_DB_ID = process.env.FIRE_DRILL_DB_ID;
const SERIOUS_INCIDENT_DB_ID = process.env.SERIOUS_INCIDENT_DB_ID;

const AREAS = [
  { key: 'A', title: 'Emergency preparedness & fire safety' },
  { key: 'B', title: 'First aid & medical equipment' },
  { key: 'C', title: 'Medications' },
  { key: 'D', title: 'Physical environment' },
  { key: 'E', title: 'Vehicles' },
  { key: 'F', title: 'Resident plans & documentation' },
  { key: 'G', title: 'Resident health' },
  { key: 'H', title: 'Resident quality of life' },
  { key: 'I', title: 'Staff & sponsors' },
  { key: 'J', title: 'Liaison oversight' }
];

// Same ranges as the Physical Environment screen.
const PE_RANGES = {
  'Kitchen Hot Water Temp': { min: 100, max: 110 },
  'Bathroom Hot Water Temp': { min: 100, max: 110 },
  'Refrigerator Temp': { min: 32, max: 40 },
  'Freezer Temp': { max: 32 }
};
const FIRE_RE = /smoke|carbon monoxide|extinguisher|exit|evacuation|emergency contact|fire/i;
const FIRST_AID_RE = /first aid|medical equipment/i;
const COMMUNITY_GOAL = 4;

function httpError(status, message) { const e = new Error(message); e.statusCode = status; return e; }

// ---- Dates ----
function pad(n) { return String(n).padStart(2, '0'); }
function easternToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw httpError(400, 'Choose a month (yyyy-mm).');
  const y = +m[1], mo = +m[2];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: m[1] + '-' + m[2] + '-01', end: m[1] + '-' + m[2] + '-' + pad(last), days: last, year: y, month: mo };
}
function monthLabel(month) {
  const b = monthBounds(month);
  return new Date(Date.UTC(b.year, b.month - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function nextMonth(month) {
  const b = monthBounds(month);
  const d = new Date(Date.UTC(b.year, b.month, 1));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function d10(v) { return String(v || '').slice(0, 10); }
function fmt(iso) {
  iso = d10(iso);
  if (!iso) return '';
  const p = iso.split('-');
  return (+p[1]) + '/' + (+p[2]) + '/' + p[0];
}
function fmtShort(iso) { iso = d10(iso); if (!iso) return ''; const p = iso.split('-'); return (+p[1]) + '/' + (+p[2]); }
function inMonth(iso, b) { iso = d10(iso); return !!iso && iso >= b.start && iso <= b.end; }

// ---- Status helpers ----
function worst(list) {
  const s = list.map(function (i) { return i.s; });
  if (s.indexOf('r') !== -1) return 'r';
  if (s.indexOf('y') !== -1) return 'y';
  if (s.indexOf('g') !== -1) return 'g';
  return s.indexOf('m') !== -1 ? 'm' : 'n';
}
function item(s, req, found, src) { return { s: s, req: req, found: found, src: src }; }

// Something that had to happen during the month and hasn't.
function notDone(ctx) { return ctx.final ? 'r' : 'y'; }

// ---- Area builders ----

async function activeRows(dbId, location) {
  const r = await queryDatabase(dbId, { and: [{ property: 'Location', select: { equals: location } }, { property: 'Active', checkbox: { equals: true } }] });
  return (r.results || []).filter(function (p) { return getPlainText(p.properties['Item Name']) !== 'General Notes'; });
}

// One Physical Environment row as a report item.
function peItem(page, ctx) {
  const p = page.properties;
  const name = getPlainText(p['Item Name']);
  const type = getPlainText(p['Item Type']);
  const updated = d10(getPlainText(p['Last Updated Date']));
  const checkedThisMonth = inMonth(updated, ctx.b);
  const when = updated ? ' (' + fmtShort(updated) + ')' : '';
  if (type === 'Expiration Date') {
    const exp = d10(getPlainText(p['Current Exp Date']));
    if (!exp) return item('r', name, 'No date on file.', 'Physical Environment');
    if (exp < ctx.asOf) return item('r', name, 'Expired ' + fmt(exp) + '.', 'Physical Environment');
    if (daysBetween(ctx.asOf, exp) <= 30) return item('y', name, 'Due ' + fmt(exp) + '.', 'Physical Environment');
    return item('g', name, 'Current to ' + fmt(exp) + '.', 'Physical Environment');
  }
  if (!checkedThisMonth) {
    return item(notDone(ctx), name, (ctx.final ? 'Not checked in ' : 'Not checked yet in ') + ctx.monthName + (updated ? '; last checked ' + fmt(updated) + '.' : '.'), 'Physical Environment');
  }
  if (type === 'Numeric Reading') {
    const v = p['Numeric Value'] && p['Numeric Value'].number;
    if (v === null || v === undefined) return item('r', name, 'No reading recorded' + when + '.', 'Physical Environment');
    const range = PE_RANGES[name];
    const out = range && ((range.min !== undefined && v < range.min) || (range.max !== undefined && v > range.max));
    return item(out ? 'r' : 'g', name, v + ' °F' + when + (out ? ', outside the safe range.' : '.'), 'Physical Environment');
  }
  const yes = !!getPlainText(p['Present']);
  return item(yes ? 'g' : 'r', name, (yes ? 'Yes' : 'No') + when + '.', 'Physical Environment');
}

// First Aid / Emergency Supplies: one summary item.
async function supplyItem(dbId, location, label, req, ctx) {
  const rows = await activeRows(dbId, location);
  if (!rows.length) return item('m', req, 'No ' + label + ' list on file for this home.', label);
  let missing = 0, expired = 0, soon = 0, next = null, last = '';
  rows.forEach(function (page) {
    const p = page.properties;
    const u = d10(getPlainText(p['Last Updated Date']));
    if (u > last && u <= ctx.b.end) last = u;
    if (getPlainText(p['Tracks Expiration'])) {
      const exp = d10(getPlainText(p['Current Exp Date']));
      if (!exp) { missing++; return; }
      if (exp < ctx.asOf) expired++;
      else if (daysBetween(ctx.asOf, exp) <= 30) soon++;
      if (exp >= ctx.asOf && (!next || exp < next.exp)) next = { exp: exp, name: getPlainText(p['Item Name']) };
    } else if (!getPlainText(p['Present'])) missing++;
  });
  const parts = [(rows.length - missing - expired) + ' of ' + rows.length + ' items present and in date'];
  if (expired) parts.push(expired + ' expired');
  if (missing) parts.push(missing + ' missing');
  if (next) parts.push('next to expire: ' + next.name + ', ' + fmt(next.exp));
  const checked = inMonth(last, ctx.b);
  let s = expired || missing ? 'r' : soon ? 'y' : 'g';
  if (!checked && s !== 'r') s = notDone(ctx);
  return item(s, req, parts.join('; ') + '. ' + (checked ? 'Checked ' + fmt(last) + '.' : (ctx.final ? 'Not checked in ' : 'Not checked yet in ') + ctx.monthName + (last ? ' (last ' + fmt(last) + ').' : '.')), label);
}

async function areaA(ctx) {
  const items = [];
  const drills = await queryDatabase(FIRE_DRILL_DB_ID, { property: 'Location', select: { equals: ctx.location } });
  const dates = (drills.results || []).map(function (p) { return d10(getPlainText(p.properties['Drill Date/Time'])); }).filter(Boolean).sort();
  const thisMonth = dates.filter(function (d) { return inMonth(d, ctx.b); });
  const before = dates.filter(function (d) { return d < ctx.b.start; });
  if (thisMonth.length) items.push(item('g', 'Fire drill held and documented (530)', 'Drill on ' + thisMonth.map(fmt).join(', ') + '.', 'Fire Drill log'));
  else items.push(item(notDone(ctx), 'Fire drill held and documented (530)', (ctx.final ? 'No drill logged in ' + ctx.monthName : 'Not logged yet; due by ' + fmt(ctx.b.end)) + '.' + (before.length ? ' Last drill ' + fmt(before[before.length - 1]) + '.' : ''), 'Fire Drill log'));
  ctx.pe.filter(function (p) { return FIRE_RE.test(getPlainText(p.properties['Item Name'])); }).forEach(function (p) { items.push(peItem(p, ctx)); });
  items.push(await supplyItem(EMERGENCY_SUPPLIES_DB_ID, ctx.location, 'Emergency Supplies', '3-day food, water and emergency supplies in date (530.E)', ctx));
  return items;
}

async function areaB(ctx) {
  const items = [await supplyItem(FIRST_AID_DB_ID, ctx.location, 'First Aid', 'First aid kit stocked; nothing expired (550)', ctx)];
  ctx.pe.filter(function (p) { return FIRST_AID_RE.test(getPlainText(p.properties['Item Name'])); }).forEach(function (p) { items.push(peItem(p, ctx)); });
  return items;
}

async function areaC(ctx) {
  const { findPeriodPage } = require('./mar-review-state');
  const sc = require('./mar-storage-checks');
  const ma = require('./medication-administration');
  const items = [];
  if (!ctx.residents.length) return [item('n', 'Medications', 'No residents with medications on file.', 'MAR Review')];
  for (const r of ctx.residents) {
    const page = await findPeriodPage(ctx.location, r);
    const finalizedOn = page ? d10(getPlainText(page.properties['Last Finalized Date'])) : '';
    const by = page ? getPlainText(page.properties['Last Finalized By']) : '';
    const period = page ? getPlainText(page.properties['Last Finalized Period']) : '';
    const done = inMonth(finalizedOn, ctx.b);
    items.push(item(done ? 'g' : notDone(ctx), r + ': Monthly MAR review', done ? 'Finalized ' + fmt(finalizedOn) + (by ? ' by ' + by : '') + (period ? ' (for ' + period + ')' : '') + '.' : (ctx.final ? 'Not finalized in ' + ctx.monthName : 'Not finalized yet this month') + (finalizedOn ? '; last ' + fmt(finalizedOn) + '.' : '.'), 'MAR Review'));
    const f = done ? sc.readFinalized(page) : { answers: {} };
    sc.CHECKS.forEach(function (c) {
      const v = f.answers[c.key];
      const req = r + ': ' + c.label;
      if (!done) items.push(item('m', req, 'Answered with the MAR review, which isn’t finalized for ' + ctx.monthName + '.', 'MAR storage check'));
      else if (v === 'Yes') items.push(item('g', req, 'Yes.', 'MAR storage check'));
      else if (v === 'No') items.push(item('r', req, 'No.' + (f.notes ? ' ' + f.notes : ''), 'MAR storage check'));
      else if (v) items.push(item('n', req, c.na || v, 'MAR storage check'));
      else items.push(item('m', req, 'Not answered.', 'MAR storage check'));
    });
    const logs = await ma.logsInRange(ctx.location, r, ctx.b.start, ctx.asOf < ctx.b.end ? ctx.asOf : ctx.b.end);
    const refused = logs.filter(function (l) { return /refus/i.test(l.status); }).length;
    items.push(item(logs.length ? 'g' : 'm', r + ': Doses logged in Give Meds', logs.length + ' doses logged' + (refused ? ', ' + refused + ' refused' : ', none refused') + '.', 'Give Meds'));
  }
  return items;
}

async function areaD(ctx) {
  const items = ctx.pe.filter(function (p) {
    const n = getPlainText(p.properties['Item Name']);
    return !FIRE_RE.test(n) && !FIRST_AID_RE.test(n);
  }).map(function (p) { return peItem(p, ctx); });
  return items.length ? items : [item('m', 'Physical Environment walkthrough', 'No walkthrough items on file for this home.', 'Physical Environment')];
}

async function areaE(ctx) {
  const v = require('./vehicles');
  const vehicles = await v.vehiclesForLocations([ctx.location]);
  if (!vehicles.length) return [item('n', 'Vehicles used for transport', 'No vehicle on file for this home.', 'Vehicles')];
  const asOfDate = new Date(ctx.asOf + 'T12:00:00Z');
  const items = [];
  for (const veh of vehicles) {
    const st = v.computeVehicleStatus(await v.servicesForVehicle(veh.id), asOfDate);
    st.items.forEach(function (i) {
      const s = i.status === 'red' ? 'r' : i.status === 'yellow' ? 'y' : i.status === 'green' ? 'g' : 'm';
      items.push(item(s, veh.name + ': ' + i.label, i.text, 'Vehicles'));
    });
  }
  return items;
}

async function areaF(ctx) {
  const ap = require('./annual-planning');
  const comp = require('./compliance');
  const qr = require('./quarterly-reporting');
  const dpn = require('./daily-progress-notes');
  const items = [];
  const asOfDate = new Date(ctx.asOf + 'T12:00:00');
  for (const r of ctx.residents) {
    const records = await ap.findRecordsForResident(ctx.location, r);
    if (!records.length) items.push(item('r', r + ': Annual Planning (665, 670, 675)', 'No Annual Planning on file.', 'Annual Planning'));
    for (const record of records) {
      const svc = record.service && record.service !== ap.DEFAULT_SERVICE ? ' · ' + record.service : '';
      const w = ap.computeAnnualPlanningWindow(record, asOfDate);
      const st = comp.annualStatus(w, asOfDate);
      const done = ap.STEPS.filter(function (s) { return record.steps[s.key] && record.steps[s.key].done; }).length;
      items.push(item(st.status === 'red' ? 'r' : st.status === 'yellow' ? 'y' : 'g', r + svc + ': ISP and annual packet (665, 670, 675)', 'Annual Planning ' + st.text + '; ' + done + ' of ' + ap.STEPS.length + ' documents done this cycle.', 'Annual Planning'));
      ['RiskProtocols', 'CarePlans', 'BSP'].forEach(function (key) {
        const step = ap.STEPS.filter(function (s) { return s.key === key; })[0];
        const s = record.steps[key] || {};
        if (s.filename === ap.NOT_NEEDED) items.push(item('n', r + svc + ': ' + step.label, 'Not needed.', 'Annual Planning'));
        else items.push(item(s.done ? 'g' : (w.isWindowOpen && !w.isFinalizedForTarget ? 'y' : 'r'), r + svc + ': ' + step.label + (key === 'BSP' ? ' (800, 810)' : ' (520.C.2)'), s.done ? 'On file.' : 'Not on file for this cycle.', 'Annual Planning'));
      });
      try {
        const state = await qr.computeQuarterlyReportingForRecord(ctx.location, r, record.service, record, asOfDate);
        if (state.hasCycle) {
          const owed = comp.quarterlyStatusForState(state, asOfDate);
          if (!owed.length) items.push(item('g', r + svc + ': Quarterly report (675, 880)', 'Nothing due.', 'Quarterly Reporting'));
          owed.forEach(function (o) { items.push(item(o.status === 'red' ? 'r' : o.status === 'yellow' ? 'y' : 'g', r + svc + ': Quarterly report (675, 880)', o.text + '.', 'Quarterly Reporting')); });
        }
      } catch (e) { /* quarterly not set up */ }
    }
    const covers = (await dpn.findAllCovers(ctx.location, r)).filter(function (c) { return inMonth(c.date, ctx.b) && c.signedAt; });
    const signedDays = {};
    covers.forEach(function (c) { signedDays[d10(c.date)] = true; });
    const lastDay = ctx.final ? ctx.b.end : addDays(ctx.asOf, -1);
    const missing = [];
    for (let d = ctx.b.start; d <= lastDay && d <= ctx.b.end; d = addDays(d, 1)) if (!signedDays[d]) missing.push(d);
    const expected = Math.max(0, daysBetween(ctx.b.start, lastDay < ctx.b.end ? lastDay : ctx.b.end) + 1);
    const text = 'Signed notes on ' + (expected - missing.length) + ' of ' + expected + ' days' + (ctx.final ? '' : ' so far') +
      (missing.length ? ' (missing ' + missing.slice(0, 6).map(fmtShort).join(', ') + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more' : '') + ').' : '.');
    items.push(item(missing.length ? notDone(ctx) : 'g', r + ': Daily progress notes (680, 880)', text, 'Daily Progress Notes'));
  }
  items.push(item('m', 'Personal funds ledger reconciled; spending forms complete (240)', 'Not captured in the app.', 'Reviewer'));
  return items;
}

async function areaG(ctx) {
  const med = require('./medical-appointments');
  const items = [];
  const asOfDate = new Date(ctx.asOf + 'T12:00:00Z');
  const seasonStart = (ctx.b.month >= 8 ? ctx.b.year : ctx.b.year - 1) + '-08-01';
  for (const r of ctx.residents) {
    const appts = await med.appointmentsForResident(ctx.location, r);
    med.computeMedicalCompliance(appts, asOfDate).items.forEach(function (i) {
      const s = i.status === 'red' ? 'r' : i.status === 'yellow' ? 'y' : 'g';
      const text = i.state === 'missing' ? 'None on file.' : i.state === 'overdue' ? 'Last ' + fmt(i.lastDate) + '; overdue since ' + fmt(i.dueDate) + '.' : 'Last ' + fmt(i.lastDate) + '; next due ' + fmt(i.dueDate) + '.';
      items.push(item(s, r + ': ' + i.label, text, 'Medical Appointments'));
    });
    const flu = appts.filter(function (a) { return a.typeKey === 'FluShot' && a.status === 'Completed' && a.date >= seasonStart && a.date <= ctx.asOf; })[0];
    items.push(item(flu ? 'g' : (ctx.b.month >= 9 || ctx.b.month <= 3 ? 'y' : 'n'), r + ': Flu shot (' + seasonStart.slice(0, 4) + '–' + String(+seasonStart.slice(0, 4) + 1).slice(2) + ' season)', flu ? fmt(flu.date) + '.' : 'None on file this season.', 'Medical Appointments'));
  }
  try {
    const res = await queryDatabase(SERIOUS_INCIDENT_DB_ID, { property: 'Location', rich_text: { equals: ctx.location } });
    const from = addDays(ctx.b.start, -30);
    (res.results || []).map(function (p) {
      return { name: getPlainText(p.properties['Name']), date: d10(getPlainText(p.properties['Date of Incident'])), resident: getPlainText(p.properties['Resident Involved']) };
    }).filter(function (i) { return i.date >= from && i.date <= ctx.b.end && !/test/i.test(i.name); }).forEach(function (i) {
      items.push(item('m', 'Reassessment within 30 days of the ' + fmt(i.date) + ' incident (520.C.2)', (i.resident ? i.resident + ': ' : '') + i.name + '. Reassessment due by ' + fmt(addDays(i.date, 30)) + '; confirm it was done.', 'Serious Incidents'));
    });
  } catch (e) { /* incidents unavailable */ }
  return items;
}

async function areaH(ctx) {
  const qn = require('./questionnaires');
  const dpn = require('./daily-progress-notes');
  const items = [];
  const responses = (await qn.responsesForLocation(ctx.location)).filter(function (x) { return x.period === ctx.month; });
  for (const r of ctx.residents) {
    const iv = responses.filter(function (x) { return x.audience === 'Resident' && x.resident === r; })[0];
    items.push(item(iv ? 'g' : notDone(ctx), r + ': Monthly resident interview (620.E)', iv ? 'Done ' + fmt(iv.submittedAt) + (iv.liaison ? ' by ' + iv.liaison : '') + '.' : (ctx.final ? 'Not done in ' + ctx.monthName + '.' : 'Not done yet this month.'), 'Liaison · Resident Interview'));
    const covers = (await dpn.findAllCovers(ctx.location, r)).filter(function (c) { return inMonth(c.date, ctx.b) && c.community && c.community.outing === 'Yes'; });
    const chosen = covers.filter(function (c) { return c.community.chosenBy === 'Resident chose' || c.community.chosenBy === 'Chose together'; }).length;
    const small = covers.filter(function (c) { return c.community.smallGroup === 'Yes'; }).length;
    const ok = covers.length >= COMMUNITY_GOAL;
    items.push(item(ok ? 'g' : (ctx.final && !covers.length ? 'r' : 'y'), r + ': Community activities of their choosing (QI 1a)',
      covers.length + ' outing' + (covers.length === 1 ? '' : 's') + (ctx.final ? '' : ' so far') + ' in the daily notes; ' + chosen + ' chosen by ' + r + ', ' + small + ' in a group of 3 or fewer. Goal: ' + COMMUNITY_GOAL + ' a month.', 'Daily Progress Notes'));
  }
  ctx.flags.forEach(function (f) {
    items.push(item(f.resolved ? 'g' : 'r', (f.resident ? f.resident + ': ' : '') + 'Concern flagged by the liaison', 'Flagged ' + fmt(f.flaggedOn) + (f.flaggedBy ? ' by ' + f.flaggedBy : '') + ' (' + f.source + '): ' + f.concern + (/[.!?]$/.test(f.concern) ? '' : '.') + (f.escalation === 'Escalated to QA/Issues log' ? ' Escalated to the QA/Issues log' + (f.escalatedOn ? ' ' + fmt(f.escalatedOn) : '') + '.' : f.escalation === 'Not needed' ? ' Escalation not needed.' : ' Escalation not decided yet.') + (f.resolved ? ' Resolved.' : ''), 'Liaison flag'));
  });
  return items;
}

async function areaI(ctx) {
  const st = require('./staff-training');
  const wf = require('./weekly-focus');
  const items = [];
  const requirements = (await st.loadRequirements()).requirements;
  const staff = await st.staffListForLocation(ctx.location);
  const asOfDate = new Date(ctx.asOf + 'T12:00:00');
  for (const member of staff) {
    const w = (await st.staffTrainingStatus(ctx.location, member, requirements, asOfDate)).window;
    const due = w.dueDate ? new Date(w.dueDate).toISOString().slice(0, 10) : '';
    const req = member.name + (member.role ? ' (' + member.role + ')' : '') + ': required training';
    if (w.isOverdue) items.push(item('r', req, 'Expired ' + fmt(due) + '.', 'Training & Certification'));
    else if (w.missingCount > 0) items.push(item('r', req, w.missingCount + ' of ' + w.totalCount + ' items not completed.', 'Training & Certification'));
    else if (w.isDueSoon) items.push(item('y', req, 'Next item due ' + fmt(due) + '.', 'Training & Certification'));
    else items.push(item('g', req, due ? 'Current until ' + fmt(due) + '.' : 'Current.', 'Training & Certification'));
  }
  if (!staff.length) items.push(item('m', 'Staff and sponsors on file', 'No staff on file for this home.', 'ASRS People'));
  try {
    const responses = (await wf.responsesSince(addDays(ctx.b.start, -6))).filter(function (x) { return x.location === ctx.location && inMonth(x.weekOf, ctx.b); });
    if (responses.length) {
      const done = responses.filter(function (x) { return x.status && x.status !== 'Pending'; }).length;
      items.push(item(done === responses.length ? 'g' : (ctx.final ? 'r' : 'y'), 'Weekly Focus check-ins', done + ' of ' + responses.length + ' completed.', 'Weekly Focus'));
    }
  } catch (e) { /* weekly focus unavailable */ }
  return items;
}

async function areaJ(ctx) {
  const lz = require('./liaison');
  const qn = require('./questionnaires');
  const items = [];
  const visits = (await lz.visitsForLocation(ctx.location)).filter(function (v) { return v.status === 'Completed' && inMonth(v.visitDate || v.completedAt, ctx.b); });
  const onsite = visits.filter(function (v) { return v.type === 'On-site Visit'; });
  if (onsite.length) {
    onsite.forEach(function (v) {
      const ok = v.locationCheck === 'Verified on site';
      items.push(item(ok ? 'g' : 'y', 'Monthly on-site visit', fmt(v.visitDate || v.completedAt) + (v.liaison ? ' by ' + v.liaison : '') + ' · ' + (v.locationCheck || 'location not recorded') + (v.distance != null && !ok ? ' (' + lz.describeDistance(v.distance) + ' from the home)' : '') + '.', 'Liaison Visits'));
    });
  } else {
    items.push(item(notDone(ctx), 'Monthly on-site visit', ctx.final ? 'No on-site visit in ' + ctx.monthName + '.' : 'Not done yet this month.', 'Liaison Visits'));
  }
  // Weekly calls: one per week (Monday to Sunday) that starts in the month, up to the as-of date.
  const calls = visits.filter(function (v) { return v.type === 'Check-in Call'; }).map(function (v) { return d10(v.visitDate || v.completedAt); });
  const weeks = [];
  let mon = ctx.b.start;
  while (new Date(mon + 'T12:00:00Z').getUTCDay() !== 1) mon = addDays(mon, 1);
  for (; mon <= ctx.b.end && mon <= ctx.asOf; mon = addDays(mon, 7)) weeks.push(mon);
  const covered = weeks.filter(function (w) { const e = addDays(w, 6); return calls.some(function (c) { return c >= w && c <= e; }); });
  const openWeek = !ctx.final && weeks.length && addDays(weeks[weeks.length - 1], 6) >= ctx.asOf && covered.indexOf(weeks[weeks.length - 1]) === -1;
  const missed = weeks.length - covered.length - (openWeek ? 1 : 0);
  items.push(item(missed > 0 ? (ctx.final ? 'r' : 'y') : weeks.length ? 'g' : 'm', 'Weekly check-in calls', covered.length + ' of ' + weeks.length + ' weeks' + (ctx.final ? '' : ' so far') + (calls.length ? ' (' + calls.sort().map(fmtShort).join(', ') + ')' : '') + (openWeek ? '; this week’s call still due.' : '.'), 'Liaison Visits'));
  const responses = (await qn.responsesForLocation(ctx.location)).filter(function (x) { return x.period === ctx.month && x.audience !== 'Resident'; });
  const audience = ctx.homeType === 'Group Home' ? 'DSP' : 'Sponsor';
  const q = responses.filter(function (x) { return x.audience === audience; });
  items.push(item(q.length ? 'g' : notDone(ctx), audience + ' questionnaire', q.length ? q.map(function (x) { return fmt(x.submittedAt) + (x.spokeWith ? ' with ' + x.spokeWith : ''); }).join('; ') + '.' : (ctx.final ? 'Not done in ' + ctx.monthName + '.' : 'Not done yet this month.'), 'Liaison · ' + audience + ' Questionnaire'));
  return items;
}

const BUILDERS = { A: areaA, B: areaB, C: areaC, D: areaD, E: areaE, F: areaF, G: areaG, H: areaH, I: areaI, J: areaJ };
const OWNER = { A: 'Sponsor', B: 'Sponsor', C: 'Sponsor', D: 'Sponsor', E: 'Sponsor', F: 'Program Director', G: 'Program Director', H: 'Residential Liaison', I: 'Program Director', J: 'Residential Liaison' };

// ---- Liaison flags ----
function flagFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    concern: getPlainText(p['Concern']),
    location: getPlainText(p['Location']),
    resident: getPlainText(p['Resident Initials']),
    source: getPlainText(p['Source']) || 'Other',
    details: getPlainText(p['Details']),
    flaggedOn: d10(getPlainText(p['Flagged On'])),
    flaggedBy: getPlainText(p['Flagged By']),
    escalation: getPlainText(p['Escalation']),
    escalatedOn: d10(getPlainText(p['Escalated On'])),
    escalationNote: getPlainText(p['Escalation Note']),
    resolved: !!getPlainText(p['Resolved'])
  };
}

async function flagsFor(filter) {
  const r = await queryDatabaseAll(FLAGS_DB_ID, { and: [{ property: 'Active', checkbox: { equals: true } }].concat(filter || []) });
  return r.map(flagFromPage).sort(function (a, b) { return a.flaggedOn < b.flaggedOn ? 1 : -1; });
}

async function flagsForMonth(month, location) {
  const b = monthBounds(month);
  const f = [{ property: 'Flagged On', date: { on_or_after: b.start } }, { property: 'Flagged On', date: { on_or_before: b.end } }];
  if (location) f.push({ property: 'Location', select: { equals: location } });
  return flagsFor(f);
}

function richText(s) {
  const c = String(s == null ? '' : s);
  const chunks = [];
  for (let i = 0; i < c.length && chunks.length < 95; i += 2000) chunks.push({ text: { content: c.slice(i, i + 2000) } });
  return { rich_text: chunks };
}

const SOURCES = ['Resident Interview', 'Sponsor Questionnaire', 'DSP Questionnaire', 'On-site Visit', 'Check-in Call', 'Other'];
const ESCALATIONS = ['Escalated to QA/Issues log', 'Not needed'];

async function createFlag(session, input) {
  const concern = String(input.concern || '').trim();
  if (!concern) throw httpError(400, 'Describe the concern.');
  const source = SOURCES.indexOf(input.source) !== -1 ? input.source : 'Other';
  const today = easternToday();
  const props = {
    'Concern': { title: [{ text: { content: concern.slice(0, 1800) } }] },
    'Location': { select: { name: session.location } },
    'Resident Initials': richText(String(input.resident || '').slice(0, 20)),
    'Source': { select: { name: source } },
    'Details': richText(String(input.details || '').slice(0, 6000)),
    'Flagged On': { date: { start: today } },
    'Flagged By': richText(session.name || session.email),
    'Flagged By Email': richText(session.email || ''),
    'Active': { checkbox: true }
  };
  if (ESCALATIONS.indexOf(input.escalation) !== -1) {
    props['Escalation'] = { select: { name: input.escalation } };
    if (input.escalation === ESCALATIONS[0]) props['Escalated On'] = { date: { start: today } };
  }
  return flagFromPage(await createPage(FLAGS_DB_ID, props));
}

async function updateFlag(id, input) {
  const props = {};
  if (input.escalation !== undefined) {
    props['Escalation'] = ESCALATIONS.indexOf(input.escalation) !== -1 ? { select: { name: input.escalation } } : { select: null };
    props['Escalated On'] = input.escalation === ESCALATIONS[0] ? { date: { start: easternToday() } } : { date: null };
  }
  if (input.escalationNote !== undefined) props['Escalation Note'] = richText(String(input.escalationNote).slice(0, 2000));
  if (input.resolved !== undefined) props['Resolved'] = { checkbox: !!input.resolved };
  if (input.remove) props['Active'] = { checkbox: false };
  return flagFromPage(await updatePage(id, props));
}

// ---- Build ----
async function build(location, month, mode, now) {
  const b = monthBounds(month);
  const today = easternToday(now);
  if (b.start > today) throw httpError(400, 'That month hasn’t started yet.');
  const final = mode === 'final';
  if (final && today <= b.end) throw httpError(400, 'The final report for ' + monthLabel(month) + ' can be made once the month ends. Use the month-to-date preview for now.');
  const asOf = final || today > b.end ? b.end : today;
  const med = require('./medical-appointments');
  const lz = require('./liaison');
  const roles = require('./roles');
  const roleNames = function (role) { return roles.adminsWithRole(role, location).then(function (a) { return a.map(function (x) { return x.name; }); }).catch(function () { return []; }); };
  const [residents, home, pe, flags, sponsors, programDirectors, liaisonRole, directors] = await Promise.all([
    med.residentsForLocation(location),
    lz.homeInfo(location).catch(function () { return { homeType: 'Sponsored Residential' }; }),
    activeRows(PHYSICAL_ENV_DB_ID, location).catch(function () { return []; }),
    flagsForMonth(month, location).catch(function () { return []; }),
    require('./weekly-focus').activeSponsors().then(function (s) { return s.filter(function (x) { return x.location === location; }).map(function (x) { return x.name; }); }).catch(function () { return []; }),
    roleNames('Program Director'), roleNames('Residential Liaison'), roleNames('Executive Director')
  ]);
  const holders = { 'Sponsor': sponsors, 'Program Director': programDirectors, 'Residential Liaison': liaisonRole };
  const ctx = { location: location, month: month, b: b, final: final, asOf: asOf, today: today, monthName: monthLabel(month).split(' ')[0], residents: residents, homeType: home.homeType, pe: pe, flags: flags };

  const areas = await Promise.all(AREAS.map(async function (a) {
    let items;
    try { items = await BUILDERS[a.key](ctx); } catch (e) {
      console.error('location report area ' + a.key, e);
      items = [item('m', a.title, 'Couldn’t check this area right now. Try generating the report again.', '')];
    }
    return { key: a.key, title: a.title, items: items, status: worst(items) };
  }));

  const fixBy = final ? nextMonth(month) + '-10' : b.end;
  const findings = [];
  areas.forEach(function (a) {
    a.items.forEach(function (i) {
      if (i.s !== 'r') return;
      const flag = i.src === 'Liaison flag';
      findings.push({ area: a.key, finding: i.req.replace(/ \([0-9.,A-Z ]+\)$/, '') + ': ' + i.found, raisedBy: flag ? 'Liaison' : 'App', owner: (holders[OWNER[a.key]] || []).length ? holders[OWNER[a.key]].join(', ') : OWNER[a.key], fixBy: fixBy, escalated: flag && /Escalated to the QA\/Issues log/.test(i.found) });
    });
  });

  const liaisons = {};
  ctx.flags.forEach(function (f) { if (f.flaggedBy) liaisons[f.flaggedBy] = true; });
  try { (await lz.visitsForLocation(location)).forEach(function (v) { if (v.liaison && inMonth(v.visitDate || v.completedAt, b)) liaisons[v.liaison] = true; }); } catch (e) { /* none */ }

  const known = areas.filter(function (a) { return a.status !== 'm' && a.status !== 'n'; });
  const overall = known.some(function (a) { return a.status === 'r'; }) ? 'r' : known.some(function (a) { return a.status === 'y'; }) ? 'y' : 'g';
  return {
    form: 'ASRS-520-03',
    location: location,
    month: month,
    monthLabel: monthLabel(month),
    mode: final ? 'final' : 'mtd',
    asOf: asOf,
    generatedAt: new Date().toISOString(),
    homeType: home.homeType || 'Sponsored Residential',
    residents: residents,
    sponsors: sponsors,
    liaisons: Object.keys(liaisons).length ? Object.keys(liaisons) : liaisonRole,
    signers: { 'Residential Liaison': liaisonRole, 'Executive Director': directors },
    overall: overall,
    areas: areas,
    findings: findings
  };
}

// ---- Snapshots and filing ----
function reportRowFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    location: getPlainText(p['Location']),
    month: getPlainText(p['Month']),
    overall: getPlainText(p['Overall']),
    generatedAt: getPlainText(p['Generated At']),
    generatedBy: getPlainText(p['Generated By']),
    filed: !!getPlainText(p['Filed in Drive']),
    filedOn: d10(getPlainText(p['Filed On'])),
    filedBy: getPlainText(p['Filed By']),
    snapshot: getPlainText(p['Snapshot'])
  };
}

async function reportRows(month, location) {
  const f = [{ property: 'Active', checkbox: { equals: true } }, { property: 'Month', rich_text: { equals: month } }];
  if (location) f.push({ property: 'Location', select: { equals: location } });
  return (await queryDatabaseAll(REPORTS_DB_ID, { and: f })).map(reportRowFromPage);
}

// The Final for a month: the saved snapshot, or a fresh build that is
// then saved (regenerate replaces the snapshot).
async function finalReport(location, month, by, regenerate) {
  const existing = (await reportRows(month, location))[0] || null;
  if (existing && existing.snapshot && !regenerate) {
    try { return { report: JSON.parse(existing.snapshot), row: existing, fromSnapshot: true }; } catch (e) { /* rebuild */ }
  }
  const report = await build(location, month, 'final');
  const props = {
    'Report': { title: [{ text: { content: location + ' - ' + month } }] },
    'Location': { select: { name: location } },
    'Month': richText(month),
    'Overall': { select: { name: { r: 'red', y: 'yellow', g: 'green' }[report.overall] } },
    'Generated At': { date: { start: report.generatedAt } },
    'Generated By': richText(by || ''),
    'Snapshot': richText(JSON.stringify(report)),
    'Active': { checkbox: true }
  };
  const page = existing ? await updatePage(existing.id, props) : await createPage(REPORTS_DB_ID, props);
  return { report: report, row: reportRowFromPage(page), fromSnapshot: false };
}

async function setFiled(location, month, filed, by) {
  const row = (await reportRows(month, location))[0];
  if (!row) throw httpError(400, 'Generate the Final for ' + location + ' first.');
  await updatePage(row.id, {
    'Filed in Drive': { checkbox: !!filed },
    'Filed On': filed ? { date: { start: easternToday() } } : { date: null },
    'Filed By': richText(filed ? by || '' : '')
  });
  return Object.assign(row, { filed: !!filed });
}

module.exports = {
  AREAS, SOURCES, ESCALATIONS, monthBounds, monthLabel, nextMonth, easternToday,
  build, finalReport, reportRows, setFiled,
  flagsFor, flagsForMonth, createFlag, updateFlag, flagFromPage
};
