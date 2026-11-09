const crypto = require('crypto');
const { queryDatabase, createPage, updatePage, getPage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');
const { requireSession } = require('./session');
const { encryptToken } = require('./crypto');

// Liaison app: liaisons are admin accounts (Admin Accounts, "Liaison App
// Enabled") who see the sponsor app for any of their granted locations,
// plus on-site visits, weekly check-in calls and questionnaire links.
//
// On-site visits record the phone's location when the visit is started
// and again when it's submitted. Each reading is compared to the home's
// coordinates (Location Access Codes: Latitude / Longitude / On-site
// Radius). A visit that is too far away, or where location wasn't shared,
// is still saved but flagged for the office.

const VISITS_DB_ID = configId('LIAISON_VISITS_DB_ID');
const CHECKLIST_DB_ID = configId('VISIT_CHECKLIST_DB_ID');
const LOCATION_CODES_DB_ID = configId('LOCATION_CODES_DB_ID');

const DEFAULT_RADIUS_M = 150;
// GPS readings come with an accuracy (meters). Give the reading the
// benefit of that doubt, up to this much, before calling it too far.
const MAX_ACCURACY_CREDIT_M = 75;

const TEMPLATES = {
  sponsorVisit: 'Sponsor Site Visit',
  groupVisit: 'Group Home Site Visit',
  call: 'Weekly Check-in Call'
};
const TYPES = { visit: 'On-site Visit', call: 'Check-in Call' };
const MODES = ['In person', 'Phone', 'Video'];

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function richText(s) {
  const content = String(s == null ? '' : s);
  const chunks = [];
  for (let i = 0; i < content.length && chunks.length < 90; i += 2000) chunks.push({ text: { content: content.slice(i, i + 2000) } });
  return { rich_text: chunks };
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

// Today / this month in Eastern time (the homes' time zone).
function easternDate(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
function periodOf(iso) { return String(iso || '').slice(0, 7); }
function previousPeriod(period) {
  const y = parseInt(period.slice(0, 4), 10), m = parseInt(period.slice(5, 7), 10);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
function daysBetween(fromISO, toISO) {
  return Math.round((new Date(toISO + 'T00:00:00Z') - new Date(fromISO + 'T00:00:00Z')) / 86400000);
}

// ---- Session ----

// Every liaison function goes through this: a sponsor app session is not
// enough. session.location is always one of session.grantedLocations
// (checked when the token was issued).
function requireLiaison(event) {
  const session = requireSession(event);
  if (!session.liaison) throw httpError(403, 'This is for the Liaison app.');
  if ((session.grantedLocations || []).indexOf(session.location) === -1) throw httpError(403, 'Not authorized for that location.');
  return session;
}

// ---- Homes ----

async function homeInfo(location) {
  const result = await queryDatabase(LOCATION_CODES_DB_ID, { property: 'Active', checkbox: { equals: true } });
  const page = (result.results || []).find(function (p) { return getPlainText(p.properties['Location']) === location; });
  if (!page) return { location: location, homeType: 'Sponsored Residential', lat: null, lng: null, radius: DEFAULT_RADIUS_M, address: '' };
  const p = page.properties;
  return {
    id: page.id,
    location: location,
    homeType: getPlainText(p['Home Type']) || 'Sponsored Residential',
    lat: num(getPlainText(p['Latitude'])),
    lng: num(getPlainText(p['Longitude'])),
    radius: num(getPlainText(p['On-site Radius (m)'])) || DEFAULT_RADIUS_M,
    address: getPlainText(p['Address'])
  };
}

async function allHomes() {
  const result = await queryDatabase(LOCATION_CODES_DB_ID, { property: 'Active', checkbox: { equals: true } });
  return (result.results || []).map(function (page) {
    const p = page.properties;
    return {
      id: page.id,
      location: getPlainText(p['Location']),
      homeType: getPlainText(p['Home Type']) || 'Sponsored Residential',
      lat: num(getPlainText(p['Latitude'])),
      lng: num(getPlainText(p['Longitude'])),
      radius: num(getPlainText(p['On-site Radius (m)'])),
      address: getPlainText(p['Address'])
    };
  }).sort(function (a, b) { return a.location.localeCompare(b.location); });
}

function visitTemplateFor(home) {
  return home.homeType === 'Group Home' ? TEMPLATES.groupVisit : TEMPLATES.sponsorVisit;
}

// Great-circle distance in meters.
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A browser reading: { lat, lng, accuracy } or null (not shared / failed).
function cleanCoords(c) {
  if (!c || typeof c !== 'object') return null;
  const lat = Number(c.lat), lng = Number(c.lng), acc = Number(c.accuracy);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat, lng: lng, accuracy: isFinite(acc) && acc >= 0 ? Math.round(acc) : null };
}

// Compares both readings to the home. The farther reading decides.
function locationCheck(home, start, end) {
  if (home.lat == null || home.lng == null) return { result: 'Home location not set up', distance: null };
  if (!start || !end) return { result: 'Location not shared', distance: null };
  const readings = [start, end].map(function (c) {
    const d = distanceM(home.lat, home.lng, c.lat, c.lng);
    return { d: d, effective: d - Math.min(c.accuracy || 0, MAX_ACCURACY_CREDIT_M) };
  });
  const far = readings.reduce(function (a, b) { return b.d > a.d ? b : a; });
  return { result: far.effective <= home.radius ? 'Verified on site' : 'Too far away', distance: Math.round(far.d) };
}

function describeDistance(m) {
  if (m == null) return '';
  if (m < 1000) return Math.round(m * 3.281) + ' ft';
  return (m / 1609.34).toFixed(1) + ' mi';
}

// ---- Checklist ----

async function loadChecklist(template) {
  const result = await queryDatabase(CHECKLIST_DB_ID, {
    and: [
      { property: 'Template', select: { equals: template } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(function (page) {
    const p = page.properties;
    return {
      key: page.id.replace(/-/g, '').slice(-12),
      question: getPlainText(p['Question']),
      section: getPlainText(p['Section']),
      order: num(getPlainText(p['Order'])) || 0,
      type: getPlainText(p['Type']) || 'Text',
      fromApp: getPlainText(p['From the App']),
      help: getPlainText(p['Help'])
    };
  }).filter(function (q) { return q.question; }).sort(function (a, b) { return a.order - b.order; });
}

// ---- What the app already knows (shown under questions) ----

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

async function buildPrefill(location, residents, questions) {
  const wanted = {};
  questions.forEach(function (q) { if (q.fromApp) wanted[q.fromApp] = true; });
  const out = { byResident: {}, text: {} };
  if (!Object.keys(wanted).length) return out;

  const tasks = [];
  if (wanted['Medical dates']) {
    tasks.push((async function () {
      const med = require('./medical-appointments');
      for (const r of residents) {
        try {
          const all = await med.appointmentsForResident(location, r);
          const done = med.latestByType(all.filter(function (a) { return a.status === 'Completed'; }));
          const planned = all.filter(function (a) { return a.status === 'Planned' && a.date >= easternDate(); })
            .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
          const part = function (key, label) { const t = done.filter(function (x) { return x.key === key; })[0]; return label + ' ' + (t ? fmtDate(t.latest.date) : 'none on file'); };
          out.byResident[r] = [part('Physical', 'Physical'), part('Dental', 'Dental'), part('FluShot', 'Flu shot'), part('TBTest', 'TB test')].join(' · ') +
            (planned.length ? '\nUpcoming: ' + planned.slice(0, 3).map(function (a) { return a.typeLabel + ' ' + fmtDate(a.date); }).join(', ') : '');
        } catch (e) { out.byResident[r] = ''; }
      }
    })());
  }
  if (wanted['Monthly reports'] || wanted['Compliance overview'] || wanted['Training'] || wanted['Annual planning']) {
    tasks.push((async function () {
      try {
        const c = await require('./compliance').locationCompliance(location);
        const byKey = {};
        c.areas.forEach(function (a) { byKey[a.key] = a; });
        const line = function (a) {
          if (!a) return '';
          const t = (a.items || []).map(function (i) { return i.text; }).filter(Boolean).join('; ');
          return a.name + ' (' + a.status + ')' + (t ? ': ' + t : '');
        };
        out.text['Monthly reports'] = ['fireDrill', 'firstAid', 'emergency', 'physical'].map(function (k) { return line(byKey[k]); }).filter(Boolean).join('\n');
        out.text['Training'] = line(byKey.training);
        out.text['Annual planning'] = [line(byKey.annual), line(byKey.quarterly)].filter(Boolean).join('\n');
        out.text['Compliance overview'] = 'Overall: ' + c.overall + ' · ' + c.counts.green + ' green, ' + c.counts.yellow + ' yellow, ' + c.counts.red + ' red';
      } catch (e) { /* leave blank */ }
    })());
  }
  if (wanted['Medications']) {
    tasks.push((async function () {
      try {
        const { findPeriodPage } = require('./mar-review-state');
        const sc = require('./mar-storage-checks');
        const lines = [];
        for (const r of residents) {
          const page = await findPeriodPage(location, r);
          const f = sc.readFinalized(page);
          const no = sc.CHECKS.filter(function (c) { return f.answers[c.key] === 'No'; }).length;
          lines.push(r + ': MAR last finalized ' + (page && getPlainText(page.properties['Last Finalized Period']) || 'never') +
            ' · storage check ' + (!Object.keys(f.answers).length ? 'not done' : no ? no + ' No' : 'all OK'));
        }
        out.text['Medications'] = lines.join('\n');
      } catch (e) { /* leave blank */ }
    })());
  }
  await Promise.all(tasks);
  return out;
}

// Recent signed daily notes to pick from for the "Daily notes" question.
async function recentNotes(location, residents) {
  const dpn = require('./daily-progress-notes');
  const since = easternDate(new Date(Date.now() - 21 * 86400000));
  const list = [];
  for (const r of residents) {
    try {
      (await dpn.findAllCovers(location, r)).forEach(function (c) {
        if (c.signedAt && c.date >= since) list.push({ id: c.id, label: r + ' · ' + fmtDate(c.date) + (c.timesCovered ? ' · ' + c.timesCovered : '') + (c.signedBy ? ' · ' + c.signedBy : ''), date: c.date });
      });
    } catch (e) { /* skip */ }
  }
  return list.sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 14);
}

// ---- Visits ----

function visitFromPage(page) {
  const p = page.properties;
  let answers = [];
  try { answers = JSON.parse(getPlainText(p['Answers']) || '[]'); } catch (e) { answers = []; }
  return {
    id: page.id,
    type: getPlainText(p['Type']),
    template: getPlainText(p['Template']),
    status: getPlainText(p['Status']),
    location: getPlainText(p['Location']),
    spokeWith: getPlainText(p['Spoke With']),
    mode: getPlainText(p['Mode']),
    liaison: getPlainText(p['Liaison']),
    liaisonEmail: getPlainText(p['Liaison Email']),
    startedAt: getPlainText(p['Started At']),
    completedAt: getPlainText(p['Completed At']),
    visitDate: getPlainText(p['Visit Date']),
    duration: num(getPlainText(p['Duration (min)'])),
    start: getPlainText(p['Start Latitude']) !== null && getPlainText(p['Start Latitude']) !== '' ? { lat: getPlainText(p['Start Latitude']), lng: getPlainText(p['Start Longitude']), accuracy: getPlainText(p['Start Accuracy (m)']) } : null,
    distance: num(getPlainText(p['Distance (m)'])),
    locationCheck: getPlainText(p['Location Check']),
    answers: answers,
    notes: getPlainText(p['Notes']),
    followUps: getPlainText(p['Follow-ups']),
    pdfStatus: getPlainText(p['PDF Status']),
    pdfLink: getPlainText(p['PDF Link']),
    active: !!getPlainText(p['Active'])
  };
}

async function visitsForLocation(location) {
  const result = await queryDatabase(VISITS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(visitFromPage);
}

async function getVisit(id) {
  try { return visitFromPage(await getPage(id)); } catch (e) { throw httpError(404, 'That visit wasn\'t found.'); }
}

// The visit, if this liaison may work on it (same location, still a draft
// they started, unless reading).
async function visitForSession(session, id, opts) {
  const v = await getVisit(id);
  if (!v.active || v.location !== session.location) throw httpError(403, 'Not authorized for that visit.');
  if (opts && opts.editable && (v.status !== 'Draft' || v.liaisonEmail !== session.email)) throw httpError(409, 'This visit can no longer be changed.');
  return v;
}

function findDraft(visits, type, email) {
  return visits.filter(function (v) { return v.status === 'Draft' && v.type === type && v.liaisonEmail === email; })
    .sort(function (a, b) { return a.startedAt < b.startedAt ? 1 : -1; })[0] || null;
}

async function startVisit(session, input) {
  const type = input.type === 'call' ? TYPES.call : TYPES.visit;
  const home = await homeInfo(session.location);
  const template = type === TYPES.call ? TEMPLATES.call : visitTemplateFor(home);
  const now = new Date();
  const props = {
    'Record Title': { title: [{ text: { content: session.location + ' - ' + type + ' - ' + easternDate(now) } }] },
    'Type': { select: { name: type } },
    'Template': { select: { name: template } },
    'Status': { select: { name: 'Draft' } },
    'Location': { select: { name: session.location } },
    'Liaison': richText(session.name || session.email),
    'Liaison Email': richText(session.email),
    'Spoke With': richText(String(input.spokeWith || '').slice(0, 100)),
    'Mode': { select: { name: type === TYPES.visit ? 'In person' : (MODES.indexOf(input.mode) !== -1 ? input.mode : 'Phone') } },
    'Started At': { date: { start: now.toISOString() } },
    'Active': { checkbox: true }
  };
  if (type === TYPES.visit) {
    const c = cleanCoords(input.coords);
    props['Start Latitude'] = { number: c ? c.lat : null };
    props['Start Longitude'] = { number: c ? c.lng : null };
    props['Start Accuracy (m)'] = { number: c ? c.accuracy : null };
  }
  return visitFromPage(await createPage(VISITS_DB_ID, props));
}

// Answers come in as { [questionKey]: { value, note, perResident: { AR: '' }, notes: [ids] } }.
// Stored as a snapshot with each question's wording.
function snapshotAnswers(questions, raw, residents, noteOptions) {
  raw = raw || {};
  const noteLabels = {};
  (noteOptions || []).forEach(function (n) { noteLabels[n.id] = n.label; });
  const clip = function (s, n) { return String(s == null ? '' : s).slice(0, n || 2000); };
  return questions.map(function (q) {
    const a = raw[q.key] || {};
    const entry = { key: q.key, question: q.question, section: q.section, type: q.type };
    if (q.type === 'Yes/No') {
      entry.value = ['Yes', 'No', 'N/A'].indexOf(a.value) !== -1 ? a.value : '';
      entry.note = clip(a.note, 1000);
    } else if (q.type === 'Per resident') {
      entry.perResident = {};
      residents.forEach(function (r) { entry.perResident[r] = clip(a.perResident && a.perResident[r], 1500); });
    } else if (q.type === 'Daily notes') {
      entry.notes = (Array.isArray(a.notes) ? a.notes : []).slice(0, 4).map(function (id) { return { id: id, label: noteLabels[id] || a.labels && a.labels[id] || id }; });
      entry.note = clip(a.note, 1000);
    } else {
      entry.value = clip(a.value);
    }
    return entry;
  });
}

function missingForSubmit(snapshot, type) {
  const missing = snapshot.filter(function (e) { return e.type === 'Yes/No' && !e.value; }).map(function (e) { return e.question; });
  if (type === TYPES.visit) {
    snapshot.filter(function (e) { return e.type === 'Daily notes' && (!e.notes || e.notes.length < 1); }).forEach(function (e) { missing.push(e.question); });
  }
  return missing;
}

async function saveDraft(visit, fields) {
  const props = {};
  if (fields.answers) props['Answers'] = richText(JSON.stringify(fields.answers));
  if (fields.notes !== undefined) props['Notes'] = richText(String(fields.notes || '').slice(0, 4000));
  if (fields.followUps !== undefined) props['Follow-ups'] = richText(String(fields.followUps || '').slice(0, 4000));
  if (fields.spokeWith !== undefined) props['Spoke With'] = richText(String(fields.spokeWith || '').slice(0, 100));
  if (fields.mode && visit.type === TYPES.call && MODES.indexOf(fields.mode) !== -1) props['Mode'] = { select: { name: fields.mode } };
  if (Object.keys(props).length) await updatePage(visit.id, props);
}

async function completeVisit(visit, home, endCoords, now) {
  now = now || new Date();
  const props = {
    'Status': { select: { name: 'Completed' } },
    'Completed At': { date: { start: now.toISOString() } },
    'Visit Date': { date: { start: easternDate(now) } },
    'Duration (min)': { number: visit.startedAt ? Math.max(0, Math.round((now - new Date(visit.startedAt)) / 60000)) : null }
  };
  let check = { result: 'Not required', distance: null };
  if (visit.type === TYPES.visit) {
    const end = cleanCoords(endCoords);
    props['End Latitude'] = { number: end ? end.lat : null };
    props['End Longitude'] = { number: end ? end.lng : null };
    props['End Accuracy (m)'] = { number: end ? end.accuracy : null };
    check = locationCheck(home, visit.start ? cleanCoords(visit.start) : null, end);
    props['Distance (m)'] = { number: check.distance };
  }
  props['Location Check'] = { select: { name: check.result } };
  await updatePage(visit.id, props);
  return check;
}

// On-site visit → the Monthly Checklist's Last Site Visit (and Licensing
// Drill Completed when the drill question was answered), on whichever
// month that checklist is working on, if it isn't finalized yet.
async function updateMonthlyChecklist(location, visitDate, snapshot) {
  const mc = require('./monthly-checklist');
  const target = await mc.resolveTarget(location);
  if (target.record && target.record.finalized) return false;
  const fields = { LastSiteVisit: visitDate };
  const drill = snapshot.filter(function (e) { return e.type === 'Yes/No' && /licensing drill/i.test(e.question) && (e.value === 'Yes' || e.value === 'No'); })[0];
  if (drill) fields.LicensingDrillCompleted = drill.value;
  await mc.saveProgress(location, target.targetPeriod, fields);
  return true;
}

// ---- Status lights ----

function visitStatus(visits, today) {
  const done = visits.filter(function (v) { return v.type === TYPES.visit && v.status === 'Completed' && v.visitDate; })
    .sort(function (a, b) { return a.visitDate < b.visitDate ? 1 : -1; });
  const last = done[0] || null;
  const period = periodOf(today);
  // Done this month: green. Not yet, but last month was done: yellow (due
  // by month end). A missed month, or never: red.
  const status = !last ? 'red' : periodOf(last.visitDate) === period ? 'green' : periodOf(last.visitDate) === previousPeriod(period) ? 'yellow' : 'red';
  return {
    status: status,
    last: last ? { date: last.visitDate, locationCheck: last.locationCheck, distance: last.distance, liaison: last.liaison } : null,
    text: last ? 'Last visit ' + fmtDate(last.visitDate) + (last.locationCheck ? ' · ' + last.locationCheck + (last.locationCheck === 'Too far away' && last.distance != null ? ' (' + describeDistance(last.distance) + ')' : '') : '') + (status === 'green' ? '' : ' · due this month') : 'No visits yet · due this month'
  };
}

function callStatus(visits, today) {
  const done = visits.filter(function (v) { return v.type === TYPES.call && v.status === 'Completed' && v.visitDate; })
    .sort(function (a, b) { return a.visitDate < b.visitDate ? 1 : -1; });
  const last = done[0] || null;
  if (!last) return { status: 'red', last: null, text: 'No calls yet · due now' };
  const days = daysBetween(last.visitDate, today);
  const status = days <= 7 ? 'green' : days === 8 ? 'yellow' : 'red';
  return {
    status: status,
    last: { date: last.visitDate, spokeWith: last.spokeWith },
    text: 'Last call ' + fmtDate(last.visitDate) + (last.spokeWith ? ' with ' + last.spokeWith : '') + ' · ' + (days <= 7 ? 'next due ' + fmtDate(new Date(new Date(last.visitDate + 'T12:00:00Z').getTime() + 7 * 86400000).toISOString().slice(0, 10)) : 'overdue')
  };
}

// ---- PDFs and filing in Drive ----
// The "ASRS Document Filing" Zapier workflow takes a file plus an
// encrypted ticket, asks document-filing-resolve where it goes and what
// it's called, saves it, and confirms back (which sets PDF Status = Saved).

function filingTicket(target, pageId, location, folders, filename) {
  return encryptToken({ kind: 'filing', target: target, pageId: pageId, location: location, folders: folders, filename: filename }, 7 * 24 * 3600);
}

async function sendForFiling(pdfBytes, ticket, filename, site) {
  const url = configId('DOCUMENT_FILING_WEBHOOK_URL');
  if (!url) throw new Error('Document filing is not configured.');
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
  form.append('ticket', ticket);
  form.append('site', site || process.env.URL || 'https://asrs-sponsor-app.netlify.app');
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Filing webhook returned ' + res.status);
}

function safePart(s) { return String(s || '').replace(/[^a-zA-Z0-9]+/g, ''); }

async function buildVisitPdf(visit, home, residents, check) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 50, CW = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const clean = function (s) { return String(s == null ? '' : s).replace(/[^\x20-\x7E\n]/g, function (ch) { return ({ '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '-', '…': '...' })[ch] || ''; }); };
  function wrap(text, f, size, width) {
    const out = [];
    clean(text).split('\n').forEach(function (para) {
      let line = '';
      para.split(/\s+/).forEach(function (w) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function draw(text, opts) {
    opts = opts || {};
    const size = opts.size || 10, f = opts.bold ? bold : font, indent = opts.indent || 0;
    wrap(text, f, size, CW - indent).forEach(function (l) {
      if (y - size < M) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M + indent, y: y - size, size: size, font: f, color: opts.color || rgb(0, 0, 0) });
      y -= size + 4;
    });
  }
  draw('Arch Support Residential Services', { size: 10, color: rgb(0.3, 0.3, 0.3) });
  draw(visit.type === TYPES.call ? 'Weekly Check-in Call' : 'On-site Visit: ' + visit.template, { size: 16, bold: true });
  y -= 4;
  draw('Location: ' + visit.location + (home.address ? ' (' + home.address + ')' : ''), { bold: true });
  draw('Date: ' + fmtDate(easternDate(new Date())) + (visit.duration != null ? ' - ' + visit.duration + ' minutes' : ''));
  draw('Liaison: ' + visit.liaison + (visit.spokeWith ? ' - Spoke with: ' + visit.spokeWith : '') + (visit.mode ? ' - ' + visit.mode : ''));
  if (visit.type === TYPES.visit) {
    const c = check || {};
    draw('Location check: ' + (c.result || '') + (c.distance != null ? ' - ' + describeDistance(c.distance) + ' from the home' : ''), { bold: true, color: c.result === 'Verified on site' ? rgb(0.1, 0.45, 0.2) : rgb(0.7, 0.15, 0.1) });
  }
  if (residents.length) draw('Residents: ' + residents.join(', '));
  y -= 8;
  let section = null;
  visit.answers.forEach(function (e) {
    if (e.section && e.section !== section) { section = e.section; y -= 4; draw(section.toUpperCase(), { size: 9, bold: true, color: rgb(0.2, 0.35, 0.3) }); }
    draw(e.question, { bold: true });
    if (e.type === 'Yes/No') draw((e.value || '-') + (e.note ? ' - ' + e.note : ''), { indent: 12 });
    else if (e.type === 'Per resident') Object.keys(e.perResident || {}).forEach(function (r) { draw(r + ': ' + (e.perResident[r] || '-'), { indent: 12 }); });
    else if (e.type === 'Daily notes') { (e.notes || []).forEach(function (n) { draw('- ' + n.label, { indent: 12 }); }); if (e.note) draw(e.note, { indent: 12 }); if (!(e.notes || []).length) draw('-', { indent: 12 }); }
    else draw(e.value || '-', { indent: 12 });
    y -= 4;
  });
  if (visit.notes) { y -= 4; draw('Notes', { bold: true }); draw(visit.notes, { indent: 12 }); }
  if (visit.followUps) { y -= 4; draw('Follow-ups', { bold: true }); draw(visit.followUps, { indent: 12 }); }
  return doc.save();
}

async function fileVisitPdf(visit, home, residents, check, site) {
  const filename = easternDate(new Date()) + '_' + safePart(visit.location) + '_' + (visit.type === TYPES.call ? 'CheckInCall' : 'OnSiteVisit') + '.pdf';
  const pdf = await buildVisitPdf(visit, home, residents, check);
  await updatePage(visit.id, { 'PDF Status': { select: { name: 'Pending' } } });
  const ticket = filingTicket('visit', visit.id, visit.location, [{ name: visit.location, create: false }, { name: 'Liaison Visits', create: true }], filename);
  await sendForFiling(pdf, ticket, filename, site);
}

// Liaison app session for a location (re-issued when switching homes).
async function sessionForLocation(base, location) {
  const residents = await require('./medical-appointments').residentsForLocation(location);
  return {
    email: base.email,
    name: base.name,
    location: location,
    residentInitials: residents.join(', '),
    grantedLocations: base.grantedLocations,
    accountType: 'admin',
    liaison: true
  };
}

module.exports = {
  TEMPLATES, TYPES, MODES, DEFAULT_RADIUS_M,
  httpError, richText, easternDate, periodOf, previousPeriod, daysBetween, fmtDate, safePart,
  requireLiaison, homeInfo, allHomes, visitTemplateFor, distanceM, cleanCoords, locationCheck, describeDistance,
  loadChecklist, buildPrefill, recentNotes,
  visitFromPage, visitsForLocation, getVisit, visitForSession, findDraft, startVisit, snapshotAnswers, missingForSubmit,
  saveDraft, completeVisit, updateMonthlyChecklist, visitStatus, callStatus,
  filingTicket, sendForFiling, buildVisitPdf, fileVisitPdf, sessionForLocation,
  LOCATION_CODES_DB_ID, VISITS_DB_ID
};
