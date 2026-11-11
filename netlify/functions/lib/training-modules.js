// Training Modules: short modules (readings, videos, questions) that an
// admin assigns to a sponsor or DSP. The person gets a text with a private
// link, works through the steps on their phone, and on submit the app
// writes their answers to Notion and files a certificate PDF in Drive
// (through Zapier, like the Daily Progress Note PDFs).
//
// Notion (Longstreet Dashboard / Training Modules), IDs in lib/ids.js:
//   Modules            one row per module (Status, Key, Version, Min Words ...)
//   Module Steps       one row per step, in Order (Reading / Video / Questions)
//   Module Assignments one row per person per module, written by the app
//   Module Responses   one row per answer, written on submit
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { queryDatabase, queryDatabaseAll, updatePage, createPage, getPage, getPlainText, driveFolderIdFromUrl } = require('./notion');
const { id: configId } = require('./ids');
const { normalizePhone } = require('./twilio');

const MODULES_DB_ID = configId('MODULES_DB_ID');
const MODULE_STEPS_DB_ID = configId('MODULE_STEPS_DB_ID');
const MODULE_ASSIGNMENTS_DB_ID = configId('MODULE_ASSIGNMENTS_DB_ID');
const MODULE_RESPONSES_DB_ID = configId('MODULE_RESPONSES_DB_ID');

const DEFAULT_MIN_WORDS = 10;
const STEP_TYPES = ['Reading', 'Video', 'Questions'];
// A link keeps working this many days past the due date.
const LINK_GRACE_DAYS = 30;
const SITE_URL = (process.env.URL || 'https://asrs-sponsor-app.netlify.app').replace(/\/$/, '');
// Production or a deploy preview / branch deploy of this site.
const SITE_HOST_RE = /^([a-z0-9-]+--)?asrs-sponsor-app\.netlify\.app$/;

// The site a request came in on, so links and certificate call-backs made
// on a deploy preview stay on that preview. Anything else -> SITE_URL.
function siteFromEvent(event) {
  const host = String((event && event.headers && (event.headers.host || event.headers.Host)) || '').toLowerCase();
  return SITE_HOST_RE.test(host) ? 'https://' + host : SITE_URL;
}

// ---------- small helpers ----------

function badRequest(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode || 400;
  return err;
}

function wordCount(text) {
  const m = String(text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

// "1:45" -> 105, "0:43.5" -> 43.5, "75" -> 75. Blank -> null.
function parseTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some(function (p) { return !/^\d+(\.\d+)?$/.test(p); })) return NaN;
  return parts.reduce(function (total, p) { return total * 60 + parseFloat(p); }, 0);
}

// Which player a Video URL needs.
function videoSource(url) {
  const u = String(url || '').trim();
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return { kind: 'youtube', id: m[1] };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/);
  if (m) return { kind: 'vimeo', id: m[1], hash: m[2] || '' };
  // A video file: a full https URL, or a path on this site (/training-videos/...).
  if (/^(https:\/\/|\/)\S+\.(mp4|webm|m4v)(\?\S*)?$/i.test(u)) return { kind: 'file', src: u };
  return null;
}

// Notion caps a rich_text item at 2,000 characters; long text is split.
function richText(text) {
  const s = String(text || '');
  const chunks = [];
  for (let i = 0; i < s.length; i += 1900) chunks.push({ text: { content: s.slice(i, i + 1900) } });
  return { rich_text: chunks };
}

function relationIds(prop) {
  return ((prop && prop.relation) || []).map(function (r) { return r.id; });
}

function multiSelect(prop) {
  return ((prop && prop.multi_select) || []).map(function (o) { return o.name; });
}

function sameId(a, b) {
  return String(a || '').replace(/-/g, '') === String(b || '').replace(/-/g, '');
}

function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function prettyDate(iso) {
  if (!iso) return '';
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function longDate(iso) {
  return new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}


// ---------- private links ----------
// /m/{token}. The token is 32 bytes, base64url: the assignment's page ID
// (16 bytes), its Link Version (2), the expiry in seconds (4) and the
// first 10 bytes of an HMAC-SHA256 over those, keyed from
// APP_ENCRYPTION_KEY. Short enough to sit comfortably in a text message,
// and any change to it fails the HMAC. Raising Link Version on the
// assignment (Resend link) makes every older link stop working.

function hmacKey() {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('APP_ENCRYPTION_KEY is not set.');
  return crypto.createHash('sha256').update('asrs-module-link:' + hex).digest();
}

function makeLinkToken(assignmentId, linkVersion, expiresAtMs) {
  const idHex = String(assignmentId).replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(idHex)) throw new Error('Bad assignment id.');
  const body = Buffer.alloc(22);
  Buffer.from(idHex, 'hex').copy(body, 0);
  body.writeUInt16BE(linkVersion & 0xffff, 16);
  body.writeUInt32BE(Math.floor(expiresAtMs / 1000), 18);
  const mac = crypto.createHmac('sha256', hmacKey()).update(body).digest().subarray(0, 10);
  return Buffer.concat([body, mac]).toString('base64url');
}

// Returns { assignmentId, linkVersion, expired } or throws on a token that
// was never issued by this app.
function readLinkToken(token) {
  let raw;
  try { raw = Buffer.from(String(token || ''), 'base64url'); } catch (e) { raw = Buffer.alloc(0); }
  if (raw.length !== 32) throw badRequest('That link isn\'t valid.', 404);
  const body = raw.subarray(0, 22);
  const mac = crypto.createHmac('sha256', hmacKey()).update(body).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(mac, raw.subarray(22))) throw badRequest('That link isn\'t valid.', 404);
  const hex = body.subarray(0, 16).toString('hex');
  const assignmentId = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  return {
    assignmentId: assignmentId,
    linkVersion: body.readUInt16BE(16),
    expired: body.readUInt32BE(18) * 1000 < Date.now()
  };
}

function linkExpiry(dueDate) {
  const due = dueDate ? Date.parse(dueDate.slice(0, 10) + 'T23:59:59-05:00') : Date.now();
  return Math.max(due, Date.now()) + LINK_GRACE_DAYS * 864e5;
}

function moduleLink(assignment, site) {
  return (site || SITE_URL) + '/m/' + makeLinkToken(assignment.id, assignment.linkVersion, linkExpiry(assignment.dueDate));
}

// ---------- modules and steps ----------

function moduleFromPage(page) {
  const p = page.properties;
  const minWords = getPlainText(p['Min Words']);
  return {
    id: page.id,
    title: getPlainText(p['Title']),
    key: getPlainText(p['Key']).trim(),
    status: getPlainText(p['Status']) || 'Draft',
    type: getPlainText(p['Type']) || 'Reflection',
    version: getPlainText(p['Version']) || 1,
    minutes: getPlainText(p['Minutes']) || null,
    appliesTo: multiSelect(p['Applies To']),
    minWords: typeof minWords === 'number' && minWords > 0 ? minWords : DEFAULT_MIN_WORDS,
    certificateLine: getPlainText(p['Certificate Line']) || 'Training module',
    description: getPlainText(p['Description'])
  };
}

// Turns a Module Steps row into what the page needs, or a problem string.
function stepFromPage(page) {
  const p = page.properties;
  const type = getPlainText(p['Type']);
  const step = {
    id: page.id,
    order: getPlainText(p['Order']),
    type: type,
    label: getPlainText(p['Label']) || type,
    title: getPlainText(p['Title']) || getPlainText(p['Label']) || type,
    body: getPlainText(p['Body'])
  };
  if (typeof step.order !== 'number') return { problem: '"' + step.label + '" has no Order.' };
  if (STEP_TYPES.indexOf(type) < 0) {
    return { problem: '"' + step.label + '" has Type "' + (type || 'blank') + '". This version supports Reading, Video and Questions.' };
  }
  if (type === 'Video') {
    const url = getPlainText(p['Video URL']);
    const source = videoSource(url);
    if (!source) return { problem: '"' + step.label + '" needs a YouTube, Vimeo or .mp4 Video URL.' };
    const start = parseTime(getPlainText(p['Start'])) || 0;
    const end = parseTime(getPlainText(p['End']));
    if (!(end > start)) return { problem: '"' + step.label + '" needs an End time after its Start (mm:ss).' };
    step.video = Object.assign({ url: url, start: start, end: end }, source);
  }
  if (type === 'Questions') {
    step.questions = getPlainText(p['Questions']).split('\n').map(function (q) { return q.trim(); }).filter(Boolean);
    if (!step.questions.length) return { problem: '"' + step.label + '" has no Questions (one per line).' };
  }
  return { step: step };
}

// The module plus its steps in order. `problems` lists any step that
// can't be shown; a module with problems can't be assigned or taken.
async function loadModule(moduleId) {
  const page = await getPage(moduleId);
  const mod = moduleFromPage(page);
  const rows = await queryDatabaseAll(MODULE_STEPS_DB_ID, { property: 'Module', relation: { contains: moduleId } });
  const problems = [];
  const steps = [];
  rows.forEach(function (row) {
    const r = stepFromPage(row);
    if (r.problem) problems.push(r.problem); else steps.push(r.step);
  });
  steps.sort(function (a, b) { return a.order - b.order; });
  if (!steps.length) problems.push('It has no steps.');
  else if (steps[steps.length - 1].type !== 'Questions') problems.push('Its last step must be a Questions step.');
  if (!/^[A-Za-z0-9]+$/.test(mod.key)) problems.push('Its Key must be letters and numbers only.');
  mod.steps = steps;
  mod.problems = problems;
  return mod;
}

async function listModules() {
  const pages = await queryDatabaseAll(MODULES_DB_ID);
  return pages.map(moduleFromPage).sort(function (a, b) { return a.title.localeCompare(b.title); });
}

// ---------- assignments ----------

function parseProgress(text) {
  try {
    const p = JSON.parse(text || '{}');
    return { videos: p.videos || {}, answers: p.answers || {}, current: p.current || 0 };
  } catch (e) {
    return { videos: {}, answers: {}, current: 0 };
  }
}

function assignmentFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    moduleId: relationIds(p['Module'])[0] || '',
    // Set on a module that is a step in a training path, and on a Path
    // Assignments row itself (isPath), which shares these field names.
    pathAssignmentId: relationIds(p['Path Assignment'])[0] || '',
    pathStep: getPlainText(p['Path Step']) || null,
    pathId: relationIds(p['Path'])[0] || '',
    isPath: !!p['Path'] && !p['Module'],
    moduleVersion: getPlainText(p['Module Version']) || 1,
    personId: relationIds(p['Person'])[0] || '',
    personName: getPlainText(p['Person Name']),
    role: getPlainText(p['Role']),
    location: getPlainText(p['Location']),
    status: getPlainText(p['Status']) || 'Assigned',
    assignedDate: getPlainText(p['Assigned Date']),
    dueDate: getPlainText(p['Due Date']),
    assignedBy: getPlainText(p['Assigned By']),
    openedAt: getPlainText(p['Opened At']),
    completedAt: getPlainText(p['Completed At']),
    progress: parseProgress(getPlainText(p['Progress'])),
    linkVersion: getPlainText(p['Link Version']) || 1,
    channel: getPlainText(p['Channel']),
    phone: getPlainText(p['Phone']),
    email: getPlainText(p['Email']),
    remindersSent: getPlainText(p['Reminders Sent']) || 0,
    lastReminder: getPlainText(p['Last Reminder']),
    certificateId: getPlainText(p['Certificate ID']),
    certificateFile: getPlainText(p['Certificate File']),
    certificateStatus: getPlainText(p['Certificate Status']),
    certificateSentAt: getPlainText(p['Certificate Sent']),
    reviewed: !!getPlainText(p['Reviewed']),
    reviewedBy: getPlainText(p['Reviewed By']),
    reviewNote: getPlainText(p['Review Note']),
    needsFollowUp: !!getPlainText(p['Needs Follow-up'])
  };
}

async function getAssignment(assignmentId) {
  return assignmentFromPage(await getPage(assignmentId));
}

async function listAssignments(filter) {
  const pages = await queryDatabaseAll(MODULE_ASSIGNMENTS_DB_ID, filter);
  return pages.map(assignmentFromPage);
}

function personFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    role: getPlainText(p['Role']) || 'DSP',
    location: getPlainText(p['Location']),
    active: !!getPlainText(p['Active']),
    phone: getPlainText(p['Phone Number']),
    email: getPlainText(p['Email']),
    smsConsent: getPlainText(p['SMS Consent Status']) || 'Not Asked',
    trainingFolderUrl: getPlainText(p['Training Folder URL'])
  };
}

async function getPerson(personId) {
  return personFromPage(await getPage(personId));
}

async function staffAtLocations(locations) {
  const people = [];
  for (const location of locations) {
    const result = await queryDatabaseAll(configId('ASRS_PEOPLE_DB_ID'), {
      and: [
        { property: 'Type', select: { equals: 'Staff' } },
        { property: 'Location', select: { equals: location } },
        { property: 'Active', checkbox: { equals: true } }
      ]
    });
    result.forEach(function (page) { people.push(personFromPage(page)); });
  }
  return people.sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function assignmentText(assignment, mod, link) {
  return 'ASRS Training: Hi ' + firstName(assignment.personName) + ', you have a new training module, "' + mod.title + '"' +
    (mod.minutes ? ' (about ' + mod.minutes + ' min)' : '') + '. Please finish it by ' + prettyDate(assignment.dueDate) + ': ' + link +
    ' Reply STOP to opt out.';
}

function assignmentEmail(assignment, mod, link) {
  return {
    subject: 'Training module: ' + mod.title,
    message: 'Hi ' + firstName(assignment.personName) + ',\n\n' +
      'You have a new training module, "' + mod.title + '"' + (mod.minutes ? ' (about ' + mod.minutes + ' minutes)' : '') + '.\n' +
      'Please finish it by ' + prettyDate(assignment.dueDate) + '.\n\n' +
      'Open it here (no password needed):\n' + link + '\n\n' +
      'Thank you,\nArch Support Residential Services'
  };
}

// Sends the assignment notice by text when the person is Opted In with a
// phone number, otherwise by email. Returns the channel used.
async function sendAssignmentNotice(assignment, mod, deps) {
  const link = moduleLink(assignment, deps.site);
  const phone = normalizePhone(assignment.phone);
  if (phone && assignment.smsConsent === 'Opted In') {
    await deps.sendSms(phone, assignmentText(assignment, mod, link));
    return { channel: 'Text', link: link };
  }
  if (assignment.email) {
    const e = assignmentEmail(assignment, mod, link);
    await deps.sendEmail(assignment.email, assignment.personName, e.subject, e.message);
    return { channel: 'Email', link: link };
  }
  return { channel: '', link: link };
}

async function createAssignment(fields) {
  const props = {
    'Name': { title: [{ text: { content: fields.personName + ' · ' + fields.moduleTitle } }] },
    'Module': { relation: [{ id: fields.moduleId }] },
    'Module Version': { number: fields.moduleVersion },
    'Person': { relation: [{ id: fields.personId }] },
    'Person Name': richText(fields.personName),
    'Status': { select: { name: 'Assigned' } },
    'Assigned Date': { date: { start: todayIso() } },
    'Due Date': { date: { start: fields.dueDate } },
    'Assigned By': richText(fields.assignedBy),
    'Link Version': { number: 1 },
    'Reminders Sent': { number: 0 },
    'Progress': richText('{}')
  };
  if (fields.status) props['Status'] = { select: { name: fields.status } };
  if (fields.dueDate === null) delete props['Due Date'];
  if (fields.pathAssignmentId) {
    props['Path Assignment'] = { relation: [{ id: fields.pathAssignmentId }] };
    props['Path Step'] = { number: fields.pathStep };
  }
  if (fields.role) props['Role'] = { select: { name: fields.role } };
  if (fields.location) props['Location'] = { select: { name: fields.location } };
  if (fields.phone) props['Phone'] = { phone_number: fields.phone };
  if (fields.email) props['Email'] = { email: fields.email };
  return assignmentFromPage(await createPage(MODULE_ASSIGNMENTS_DB_ID, props));
}

// ---------- what the person has done ----------

// Checks saved progress against the module. Returns the list of things
// still missing (empty = ready to submit).
function missingForSubmit(mod, progress) {
  const missing = [];
  mod.steps.forEach(function (step) {
    const key = String(step.order);
    if (step.type === 'Video') {
      const v = progress.videos[key] || {};
      if (!v.watched) missing.push('Watch "' + step.title + '" to the end.');
    }
    if (step.type === 'Questions') {
      const answers = progress.answers[key] || [];
      step.questions.forEach(function (q, i) {
        if (wordCount(answers[i]) < mod.minWords) missing.push('Answer "' + q + '" in at least ' + mod.minWords + ' words.');
      });
    }
  });
  return missing;
}

// Merges what the page sends into saved progress. A video's furthest point
// only ever moves forward, by at most the real time since that video's
// last save (plus slack; 15 seconds for its first save), so the page
// can't jump a video to its end in one call. The page saves every few
// seconds while a video plays.
function mergeProgress(mod, saved, incoming, nowMs) {
  const out = { videos: Object.assign({}, saved.videos), answers: Object.assign({}, saved.answers), current: saved.current };
  const validOrders = {};
  mod.steps.forEach(function (s) { validOrders[String(s.order)] = s; });
  Object.keys((incoming && incoming.videos) || {}).forEach(function (key) {
    const step = validOrders[key];
    if (!step || step.type !== 'Video') return;
    const prev = out.videos[key] || { max: step.video.start, at: 0, watched: false };
    const sent = Number(incoming.videos[key].max) || 0;
    const allowed = prev.at ? prev.max + Math.max(0, (nowMs - prev.at) / 1000) * 1.25 + 5 : step.video.start + 15;
    const max = Math.min(step.video.end, Math.max(prev.max, Math.min(sent, allowed)));
    out.videos[key] = { max: max, at: nowMs, watched: prev.watched || max >= step.video.end - 0.5 };
  });
  Object.keys((incoming && incoming.answers) || {}).forEach(function (key) {
    const step = validOrders[key];
    if (!step || step.type !== 'Questions') return;
    out.answers[key] = step.questions.map(function (q, i) { return String((incoming.answers[key] || [])[i] || '').slice(0, 5000); });
  });
  if (incoming && typeof incoming.current === 'number') out.current = incoming.current;
  return out;
}

// What the page gets: no Notion IDs beyond the step order, no admin fields.
function publicModule(mod) {
  return {
    title: mod.title,
    minutes: mod.minutes,
    minWords: mod.minWords,
    certificateLine: mod.certificateLine,
    steps: mod.steps.map(function (s) {
      const out = { order: s.order, type: s.type, label: s.label, title: s.title, body: s.body };
      if (s.video) out.video = { kind: s.video.kind, id: s.video.id, hash: s.video.hash, src: s.video.src, start: s.video.start, end: s.video.end };
      if (s.questions) out.questions = s.questions;
      return out;
    })
  };
}

// ---------- certificate ----------

function certificateFilename(mod, personName, dateIso, prefix) {
  const who = String(personName || 'Unknown').trim().replace(/[^A-Za-z0-9 -]/g, '').replace(/\s+/g, '-');
  return (prefix || 'Module') + '_' + mod.key + '_' + who + '_' + dateIso + '.pdf';
}

async function newCertificateId() {
  const year = todayIso().slice(0, 4);
  for (let i = 0; i < 5; i++) {
    const candidate = 'ASRS-M-' + year + '-' + String(crypto.randomInt(1000, 10000));
    const hit = await queryDatabase(MODULE_ASSIGNMENTS_DB_ID, { property: 'Certificate ID', rich_text: { equals: candidate } });
    if (!(hit.results || []).length) return candidate;
  }
  return 'ASRS-M-' + year + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// One landscape letter page.
async function buildCertificatePdf(c) {
  const doc = await PDFDocument.create();
  doc.setTitle('Certificate of completion: ' + c.moduleTitle);
  doc.setAuthor('Arch Support Residential Services');
  const page = doc.addPage([792, 612]);
  const W = 792, H = 612;
  const gold = rgb(0.79, 0.64, 0.15), ink = rgb(0.11, 0.11, 0.1), muted = rgb(0.37, 0.36, 0.32), green = rgb(0.086, 0.2, 0.17);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: gold, borderWidth: 2.5 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: gold, borderWidth: 0.8 });

  function center(text, y, font, size, color) {
    const t = String(text || '');
    let s = size;
    while (font.widthOfTextAtSize(t, s) > W - 140 && s > 8) s -= 0.5;
    page.drawText(t, { x: (W - font.widthOfTextAtSize(t, s)) / 2, y: y, size: s, font: font, color: color || ink });
  }

  try {
    const logo = await doc.embedJpg(Buffer.from(require('./arch-support-logo'), 'base64'));
    const h = 70, w = logo.width * (h / logo.height);
    page.drawImage(logo, { x: (W - w) / 2, y: H - 70 - h, width: w, height: h });
  } catch (e) {
    console.error('Certificate logo failed to embed', e);
  }

  center('CERTIFICATE OF COMPLETION', H - 175, sansBold, 13, muted);
  center('This certifies that', H - 215, serif, 22, ink);
  center(c.personName, H - 265, serifItalic, 34, green);
  page.drawLine({ start: { x: W / 2 - 170, y: H - 277 }, end: { x: W / 2 + 170, y: H - 277 }, thickness: 0.8, color: gold });
  center(c.kindText || 'has completed the training module', H - 305, sans, 12, muted);
  center(c.moduleTitle, H - 340, serifBold, 24, ink);
  center(c.certificateLine, H - 365, sans, 11, muted);

  const cols = [['Completed', longDate(c.completedDate)], ['Location', c.location || '—'], ['Role', c.role || '—']]
    .concat(c.hideVersion ? [] : [['Module version', String(c.moduleVersion)]]).concat([['Certificate ID', c.certificateId]]);
  const colW = (W - 140) / cols.length;
  cols.forEach(function (col, i) {
    const cx = 70 + colW * i + colW / 2;
    const lw = sans.widthOfTextAtSize(col[0], 9);
    page.drawText(col[0], { x: cx - lw / 2, y: 120, size: 9, font: sans, color: muted });
    let s = 11;
    while (sansBold.widthOfTextAtSize(col[1], s) > colW - 10 && s > 7) s -= 0.5;
    page.drawText(col[1], { x: cx - sansBold.widthOfTextAtSize(col[1], s) / 2, y: 103, size: s, font: sansBold, color: ink });
  });
  page.drawLine({ start: { x: 70, y: 140 }, end: { x: W - 70, y: 140 }, thickness: 0.5, color: gold });
  center('Arch Support Residential Services', 62, sans, 9, muted);

  return doc.save();
}

// Sends the PDF to the "ASRS Module Certificates" Zap. The Zap doesn't
// trust anything in the post except the file: it asks
// module-certificate-resolve (with the assignment and certificate IDs)
// where the file goes and what to call it, the same pattern as the
// Medical Appointment uploads. It lands in the person's Training folder,
// or Facility Reporting/{Location}/Module Certificates when none is set.
async function uploadCertificate(pdfBytes, fields) {
  const url = process.env.ZAPIER_MODULE_CERTIFICATE_WEBHOOK_URL;
  if (!url) throw new Error('ZAPIER_MODULE_CERTIFICATE_WEBHOOK_URL is not set.');
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), fields.filename);
  form.append('assignmentId', fields.assignmentId);
  form.append('certificateId', fields.certificateId);
  form.append('site', fields.site || SITE_URL);
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Certificate webhook returned ' + res.status);
}

// What module-certificate-resolve hands the Zap: only for a Completed
// assignment whose Certificate ID matches.
async function certificateDestination(assignmentId, certificateId) {
  const assignment = await getAssignment(assignmentId);
  if (assignment.status !== 'Completed' || !certificateId || assignment.certificateId !== certificateId) {
    throw badRequest('Unknown certificate.', 404);
  }
  const person = assignment.personId ? await getPerson(assignment.personId).catch(function () { return null; }) : null;
  return {
    filename: assignment.certificateFile,
    folderId: driveFolderIdFromUrl(person && person.trainingFolderUrl),
    rootFolderId: configId('FACILITY_REPORTING_ROOT_FOLDER_ID'),
    locationFolderName: assignment.location,
    fallbackFolderName: 'Module Certificates'
  };
}

// Builds the certificate for a completed assignment and hands it to the
// Zap. Never throws: a failed hand-off leaves Certificate Status = Failed
// for the admin view. Pending = on its way; the Zap sets Saved.
async function issueCertificate(assignment, mod, site, options) {
  options = options || {};
  const completedDate = (assignment.completedAt || todayIso()).slice(0, 10);
  const certificateId = assignment.certificateId || await newCertificateId();
  const filename = certificateFilename(mod, assignment.personName, completedDate, options.filenamePrefix);
  await updatePage(assignment.id, {
    'Certificate ID': richText(certificateId),
    'Certificate File': richText(filename),
    'Certificate Status': { select: { name: 'Pending' } }
  });
  try {
    const pdf = await buildCertificatePdf({
      personName: assignment.personName, moduleTitle: mod.title, certificateLine: mod.certificateLine,
      completedDate: completedDate, location: assignment.location, role: assignment.role,
      moduleVersion: assignment.moduleVersion, certificateId: certificateId, kindText: mod.kindText,
      hideVersion: !!options.filenamePrefix
    });
    // Stays Pending until the Zap reports the file saved (module-certificate-resolve).
    await uploadCertificate(pdf, { filename: filename, certificateId: certificateId, assignmentId: assignment.id, site: site });
    await updatePage(assignment.id, { 'Certificate Sent': { date: { start: new Date().toISOString() } } }).catch(function (e) { console.error('Certificate Sent not recorded', e); });
    return { certificateId: certificateId, filename: filename, status: 'Pending' };
  } catch (err) {
    console.error('Certificate failed for assignment ' + assignment.id, err);
    await updatePage(assignment.id, { 'Certificate Status': { select: { name: 'Failed' } } }).catch(function () {});
    return { certificateId: certificateId, filename: filename, status: 'Failed' };
  }
}

// A completed assignment's certificate can be sent again when it Failed,
// or when it's still Pending (or was never recorded) 10 minutes after the
// module was completed or last sent.
const RESEND_AFTER_MS = 10 * 60 * 1000;
function canResendCertificate(assignment, nowMs) {
  if (assignment.status !== 'Completed') return false;
  if (assignment.certificateStatus === 'Saved') return false;
  if (assignment.certificateStatus === 'Failed') return true;
  const since = Date.parse(assignment.certificateSentAt || assignment.completedAt || '') || 0;
  return nowMs - since >= RESEND_AFTER_MS;
}

async function writeResponses(assignment, mod, progress) {
  for (const step of mod.steps) {
    if (step.type !== 'Questions') continue;
    const answers = progress.answers[String(step.order)] || [];
    for (let i = 0; i < step.questions.length; i++) {
      await createPage(MODULE_RESPONSES_DB_ID, {
        'Name': { title: [{ text: { content: assignment.personName + ' · ' + mod.title + ' · ' + step.order + '.' + (i + 1) } }] },
        'Assignment': { relation: [{ id: assignment.id }] },
        'Step': { number: step.order },
        'Number': { number: i + 1 },
        'Step Title': richText(step.title),
        'Question': richText(step.questions[i]),
        'Answer': richText(answers[i] || ''),
        'Words': { number: wordCount(answers[i]) }
      });
    }
  }
}

module.exports = {
  DEFAULT_MIN_WORDS, SITE_URL, siteFromEvent,
  badRequest, wordCount, parseTime, videoSource, richText, sameId, todayIso, prettyDate, normalizePhone,
  makeLinkToken, readLinkToken, linkExpiry, moduleLink,
  moduleFromPage, stepFromPage, loadModule, listModules,
  assignmentFromPage, getAssignment, listAssignments, createAssignment,
  getPerson, staffAtLocations, firstName, assignmentText, assignmentEmail, sendAssignmentNotice,
  missingForSubmit, mergeProgress, publicModule,
  certificateFilename, buildCertificatePdf, issueCertificate, certificateDestination, canResendCertificate, writeResponses
};
