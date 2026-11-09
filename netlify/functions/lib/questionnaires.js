const crypto = require('crypto');
const { queryDatabase, createPage, updatePage, getPlainText } = require('./notion');
const { id: configId } = require('./ids');

// Questionnaires (resident interview, sponsor / DSP questionnaire) are
// Jotforms. Which form opens is set in the Questionnaire Links table: a
// row for the home wins over the All Homes row for the same audience.
//
// The Liaison app opens the form with a hidden app_tracking value naming
// the home, resident, who the liaison spoke with, the liaison and the
// month, signed so it can't be made up or edited. Each form's webhook
// sends submissions to the "ASRS Questionnaires" Zapier workflow, which
// reads the answers from Jotform and posts them to questionnaire-submitted.
// That records the response here and files a PDF in Drive.

const LINKS_DB_ID = configId('QUESTIONNAIRE_LINKS_DB_ID');
const RESPONSES_DB_ID = configId('QUESTIONNAIRE_RESPONSES_DB_ID');
const AUDIENCES = ['Resident', 'Sponsor', 'DSP'];

function httpError(status, message) { const e = new Error(message); e.statusCode = status; return e; }

function richText(s) {
  const content = String(s == null ? '' : s);
  const chunks = [];
  for (let i = 0; i < content.length && chunks.length < 90; i += 2000) chunks.push({ text: { content: content.slice(i, i + 2000) } });
  return { rich_text: chunks };
}

function linkFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: getPlainText(p['Name']),
    audience: getPlainText(p['Audience']),
    location: getPlainText(p['Location']),
    formUrl: getPlainText(p['Form URL']),
    formId: getPlainText(p['Form ID']) || formIdFromUrl(getPlainText(p['Form URL'])),
    prefillNames: parsePrefillNames(getPlainText(p['Prefill Names']))
  };
}

function formIdFromUrl(url) { const m = /(\d{10,})/.exec(String(url || '')); return m ? m[1] : ''; }

// "app_tracking=q26_textbox24; location=q3_textbox1" -> { app_tracking: 'q26_textbox24', ... }
// A form built by Jotform's AI keeps generated field names (q26_textbox24),
// so the Questionnaire Links row can name them.
function parsePrefillNames(text) {
  const out = {};
  String(text || '').split(/[;\n,]+/).forEach(function (part) {
    const m = /^\s*([A-Za-z_]+)\s*=\s*([A-Za-z0-9_]+)\s*$/.exec(part);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

async function activeLinks() {
  const result = await queryDatabase(LINKS_DB_ID, { property: 'Active', checkbox: { equals: true } });
  return (result.results || []).map(linkFromPage).filter(function (l) { return l.formUrl && AUDIENCES.indexOf(l.audience) !== -1; });
}

// The form for this home and audience: the home's own row, else All Homes.
function pickLink(links, location, audience) {
  return links.filter(function (l) { return l.audience === audience && l.location === location; })[0] ||
    links.filter(function (l) { return l.audience === audience && (l.location === 'All Homes' || !l.location); })[0] || null;
}

// ---- Tracking value ----

function hmacKey() {
  const hex = process.env.APP_ENCRYPTION_KEY || '';
  return crypto.createHmac('sha256', Buffer.from(hex, 'hex')).update('asrs-questionnaire-tracking').digest();
}

function signTracking(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', hmacKey()).update(body).digest('hex').slice(0, 24);
  return 'Q1.' + body + '.' + sig;
}

// Returns the payload, or null if the value wasn't made by this app.
function verifyTracking(value) {
  const m = /^Q1\.([A-Za-z0-9_-]+)\.([0-9a-f]{24})$/.exec(String(value || '').trim());
  if (!m) return null;
  const expected = crypto.createHmac('sha256', hmacKey()).update(m[1]).digest('hex').slice(0, 24);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    if (AUDIENCES.indexOf(p.a) === -1 || !p.l || !p.p) return null;
    return p;
  } catch (e) { return null; }
}

// The URL the liaison opens: the form with its prefilled fields.
function buildFormUrl(link, payload, tracking) {
  // Jotform prefills a field by its unique name. The forms set these names
  // (app_tracking, location, resident, liaison, spokeWith); the extra
  // spellings cover a copied or newly made form that kept Jotform's
  // automatic names. Unknown parameters are ignored.
  const u = new URL(link.formUrl);
  tracking = tracking || signTracking(payload);
  const own = link.prefillNames || {};
  const set = function (key, names, value) {
    if (!value) return;
    (own[key] ? [own[key]] : []).concat(names).forEach(function (n) { u.searchParams.set(n, value); });
  };
  set('app_tracking', ['app_tracking', 'apptracking', 'appTracking'], tracking);
  set('location', ['location'], payload.l);
  set('resident', ['resident', 'residentinitials', 'residentInitials'], payload.r);
  set('liaison', ['liaison'], payload.n);
  set('spokeWith', ['spokeWith', 'sponsor', 'dsp'], payload.s);
  return u.toString();
}

// ---- Responses ----

function responseFromPage(page) {
  const p = page.properties;
  return {
    id: page.id,
    audience: getPlainText(p['Audience']),
    location: getPlainText(p['Location']),
    resident: getPlainText(p['Resident Initials']),
    spokeWith: getPlainText(p['Spoke With']),
    liaison: getPlainText(p['Liaison']),
    period: getPlainText(p['Period']),
    submittedAt: getPlainText(p['Submitted At']),
    submissionId: getPlainText(p['Submission ID']),
    pdfStatus: getPlainText(p['PDF Status']),
    pdfLink: getPlainText(p['PDF Link'])
  };
}

async function responsesForLocation(location) {
  const result = await queryDatabase(RESPONSES_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(responseFromPage);
}

async function responseBySubmission(submissionId) {
  const result = await queryDatabase(RESPONSES_DB_ID, { property: 'Submission ID', rich_text: { equals: String(submissionId) } });
  return (result.results || [])[0] || null;
}

async function createResponse(payload, info) {
  return createPage(RESPONSES_DB_ID, {
    'Record Title': { title: [{ text: { content: payload.l + ' - ' + payload.a + (payload.r ? ' - ' + payload.r : '') + ' - ' + payload.p } }] },
    'Audience': { select: { name: payload.a } },
    'Location': { select: { name: payload.l } },
    'Resident Initials': richText(payload.r || ''),
    'Spoke With': richText(payload.s || ''),
    'Liaison': richText(payload.n || ''),
    'Period': richText(payload.p),
    'Submitted At': { date: { start: info.submittedAt || new Date().toISOString() } },
    'Form ID': richText(info.formId || ''),
    'Submission ID': richText(info.submissionId || ''),
    'Answers': richText(JSON.stringify(info.answers || [])),
    'PDF Status': { select: { name: 'Pending' } },
    'Active': { checkbox: true }
  });
}

// ---- Opened links ----
// When a liaison opens a questionnaire the app keeps a row (PDF Status
// Opened, not Active) holding the signed tracking value. A submission that
// arrives without its hidden tracking field (a form whose field names
// don't match) is matched back to that row: same form, opened in the last
// 14 days, and the home / resident typed on the form when it has them.

async function recordOpened(payload, link, tracking) {
  return createPage(RESPONSES_DB_ID, {
    'Record Title': { title: [{ text: { content: payload.l + ' - ' + payload.a + (payload.r ? ' - ' + payload.r : '') + ' - opened' } }] },
    'Audience': { select: { name: payload.a } },
    'Location': { select: { name: payload.l } },
    'Resident Initials': richText(payload.r || ''),
    'Spoke With': richText(payload.s || ''),
    'Liaison': richText(payload.n || ''),
    'Period': richText(payload.p),
    'Submitted At': { date: { start: new Date(payload.t || Date.now()).toISOString() } },
    'Form ID': richText(link.formId || ''),
    'Tracking': richText(tracking),
    'PDF Status': { select: { name: 'Opened' } },
    'Active': { checkbox: false }
  });
}

function answerFor(answers, re) {
  const a = (answers || []).filter(function (x) { return re.test(String(x.question || '')); })[0];
  return a ? String(a.answer || '').trim() : '';
}

async function findOpened(formId, answers, now) {
  if (!formId) return null;
  const result = await queryDatabase(RESPONSES_DB_ID, {
    and: [
      { property: 'Form ID', rich_text: { equals: String(formId) } },
      { property: 'PDF Status', select: { equals: 'Opened' } }
    ]
  });
  const cutoff = (now || Date.now()) - 14 * 86400000;
  const loc = answerFor(answers, /^location/i).toLowerCase();
  const res = answerFor(answers, /^resident/i).toUpperCase();
  const rows = (result.results || []).map(function (page) {
    return { page: page, payload: verifyTracking(getPlainText(page.properties['Tracking'])), openedAt: Date.parse(getPlainText(page.properties['Submitted At'])) || 0 };
  }).filter(function (r) { return r.payload && r.openedAt >= cutoff; })
    .filter(function (r) { return (!loc || r.payload.l.toLowerCase() === loc) && (!res || !r.payload.r || r.payload.r.toUpperCase() === res); })
    .sort(function (a, b) { return b.openedAt - a.openedAt; });
  return rows[0] || null;
}

// The opened row for a tracking value that did come back on the form.
async function openedByTracking(tracking) {
  if (!tracking) return null;
  const result = await queryDatabase(RESPONSES_DB_ID, {
    and: [
      { property: 'Tracking', rich_text: { equals: String(tracking) } },
      { property: 'PDF Status', select: { equals: 'Opened' } }
    ]
  });
  return (result.results || [])[0] || null;
}

async function markOpenedUsed(pageId) {
  return updatePage(pageId, { 'PDF Status': { select: { name: 'Used' } } });
}

// Status for one resident and audience this month: green done this month,
// yellow not yet, red if last month was missed too.
function monthStatus(responses, audience, resident, today, previousPeriod) {
  const period = String(today).slice(0, 7);
  const mine = responses.filter(function (r) { return r.audience === audience && (!resident || r.resident === resident); })
    .sort(function (a, b) { return a.submittedAt < b.submittedAt ? 1 : -1; });
  const last = mine[0] || null;
  const status = !last ? 'red' : last.period === period ? 'green' : last.period === previousPeriod(period) ? 'yellow' : 'red';
  return { status: status, last: last ? { date: String(last.submittedAt).slice(0, 10), spokeWith: last.spokeWith, liaison: last.liaison } : null };
}

async function buildResponsePdf(payload, info) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 50, CW = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const clean = function (s) { return String(s == null ? '' : s).replace(/[^\x20-\x7E\n]/g, function (ch) { return ({ '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '·': '-' })[ch] || ''; }); };
  function draw(text, opts) {
    opts = opts || {};
    const size = opts.size || 10, f = opts.bold ? bold : font, indent = opts.indent || 0;
    clean(text).split('\n').forEach(function (para) {
      let line = '';
      const flush = function () {
        if (y - size < M) { page = doc.addPage([W, H]); y = H - M; }
        page.drawText(line, { x: M + indent, y: y - size, size: size, font: f, color: opts.color || rgb(0, 0, 0) });
        y -= size + 4;
      };
      para.split(/\s+/).forEach(function (w) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > CW - indent && line) { flush(); line = w; } else line = t;
      });
      flush();
    });
  }
  const title = payload.a === 'Resident' ? 'Resident Interview' : payload.a + ' Questionnaire';
  draw('Arch Support Residential Services', { size: 10, color: rgb(0.3, 0.3, 0.3) });
  draw(info.formTitle || title, { size: 16, bold: true });
  y -= 4;
  draw('Location: ' + payload.l + (payload.r ? ' - Resident: ' + payload.r : ''), { bold: true });
  draw('Liaison: ' + (payload.n || '') + (payload.s ? ' - With: ' + payload.s : '') + ' - Submitted ' + String(info.submittedAt || new Date().toISOString()).slice(0, 10));
  y -= 8;
  (info.answers || []).forEach(function (a) {
    draw(a.question, { bold: true });
    draw(a.answer || '-', { indent: 12 });
    y -= 4;
  });
  return doc.save();
}

module.exports = {
  AUDIENCES, httpError, activeLinks, pickLink, signTracking, verifyTracking, buildFormUrl,
  parsePrefillNames, recordOpened, findOpened, openedByTracking, markOpenedUsed,
  responsesForLocation, responseBySubmission, createResponse, responseFromPage, monthStatus, buildResponsePdf,
  RESPONSES_DB_ID
};
