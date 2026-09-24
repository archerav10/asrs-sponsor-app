const crypto = require('crypto');
const { queryDatabase, queryDatabaseAll, updatePage, createPage, getPage, getPlainText } = require('./notion');
const { requireSession } = require('./session');

const INTAKES_DB_ID = process.env.SPONSOR_INTAKES_DB_ID;
const ITEMS_DB_ID = process.env.SPONSOR_INTAKE_ITEMS_DB_ID;
const TIME_ZONE = process.env.SPONSOR_INTAKE_TIME_ZONE || 'America/New_York';

// Sponsor intake is a one-time, stage-by-stage checklist for a
// prospective sponsor — unlike every other process in this app it has
// no location, no resident, and no recurring cycle. The sponsor never
// logs in: they only ever see (1) the request emails an admin sends from
// the dashboard, whose buttons open a single-item upload page or a
// JotForm, and (2) a read-only status page behind a private link.
//
// Stage numbers and step numbers follow "Sponsor Intake Process –
// Master 3.2", with the cleanups agreed during design: 1.7/1.8
// (insurance) dropped in favor of 4.14/4.15; the two unnumbered
// Assessment steps became 2.3a/2.4a; 7.8 moved to Forms & Review as
// 4.16; the ten signature forms became one Sponsor Agreements packet;
// and 2.8–2.10 are sponsor uploads.
const STAGES = [
  { num: 1, name: 'Application', sponsorNote: 'Reviewing your application documents' },
  { num: 2, name: 'Assessment', sponsorNote: 'Interviews and assessment' },
  { num: 3, name: 'Background', sponsorNote: 'Background checks in progress' },
  { num: 4, name: 'Forms & Review', sponsorNote: 'Reviewing your agreements and forms' },
  { num: 5, name: 'Home Prep', sponsorNote: 'Home preparation and inspections' },
  { num: 6, name: 'Training Phase 1', sponsorNote: 'Training Phase 1' },
  { num: 7, name: 'Training Phase 2', sponsorNote: 'Training Phase 2' },
  { num: 8, name: 'Training Phases 3-4', sponsorNote: 'Training Phases 3 and 4' },
  { num: 9, name: 'Final', sponsorNote: 'Final readiness steps' }
];

// Step types:
//   upload   — sponsor uploads a document (single-item upload page)
//   form     — sponsor completes a JotForm (falls back to an upload link
//              if its formUrl isn't configured yet)
//   event    — admin records a date (and optional time); "Scheduled"
//              until marked complete. `agenda` lists talking points shown
//              on the admin page.
//   document — admin uploads a document ASRS produces or receives
//   training — admin records a completion date; `cert: true` adds an
//              optional certificate upload
// `visible: true` puts an admin-side step on the sponsor's status page
// (interviews they attend, trainings they take, milestone letters).
// Sponsor steps (upload/form) are always visible to the sponsor. Anything
// not visible — background checks especially — only ever shows up there
// as its stage's generic progress.
const STEPS = [
  // 1 · Application
  { key: '1.1', stage: 1, type: 'upload', label: 'Resume', licensing: true },
  { key: '1.2', stage: 1, type: 'form', label: 'Sponsor Application (includes reference checks and bio)', licensing: true, formEnv: 'SPONSOR_INTAKE_FORM_APPLICATION_URL' },
  { key: '1.3', stage: 1, type: 'upload', label: 'Photo ID', licensing: true },
  { key: '1.4', stage: 1, type: 'form', label: 'Monthly Budget Form', licensing: true, formEnv: 'SPONSOR_INTAKE_FORM_BUDGET_URL', defaultFormUrl: 'https://form.jotform.com/261867275422059' },
  { key: '1.5', stage: 1, type: 'upload', label: 'Proof of funds', licensing: true },
  { key: '1.6', stage: 1, type: 'upload', label: 'DMV driving record' },
  { key: '1.9', stage: 1, type: 'upload', label: 'Certificate of occupancy', licensing: true },
  { key: '1.10', stage: 1, type: 'upload', label: 'Diploma / certifications', licensing: true },

  // 2 · Assessment
  { key: '2.1', stage: 2, type: 'event', label: 'In-home tour and interview', visible: true, agenda: [] },
  { key: '2.2', stage: 2, type: 'document', label: 'Sponsor reference letter(s)', licensing: true },
  { key: '2.3', stage: 2, type: 'event', label: 'Sponsor interview #2', visible: true, agenda: [] },
  { key: '2.3a', stage: 2, type: 'event', label: 'Sponsor responsibilities review', visible: true, agenda: [] },
  { key: '2.4', stage: 2, type: 'document', label: 'Sponsor Intake Evaluation and Assessment', licensing: true },
  { key: '2.4a', stage: 2, type: 'event', label: 'Sponsor interview #3', visible: true, agenda: [] },
  { key: '2.5', stage: 2, type: 'document', label: 'Welcome and Acceptance Letter', licensing: true, visible: true },
  { key: '2.6', stage: 2, type: 'document', label: 'DBHDS Sponsor Certification & Attestation', licensing: true },
  { key: '2.7', stage: 2, type: 'document', label: 'DBHDS Family Member as Sponsor Provider', licensing: true },
  { key: '2.8', stage: 2, type: 'upload', label: 'Letter for Care at Home (Physician)', licensing: true },
  { key: '2.9', stage: 2, type: 'upload', label: 'Letter for Care at Home (Psychiatrist)', licensing: true },
  { key: '2.10', stage: 2, type: 'upload', label: 'Letter for Care at Home (Occupational Therapist)', licensing: true },

  // 3 · Background — admin side never visible to the sponsor
  { key: '3.1', stage: 3, type: 'form', label: 'ASRS Sponsor Background Check Disclosure Form', licensing: true, formEnv: 'SPONSOR_INTAKE_FORM_BACKGROUND_DISCLOSURE_URL' },
  { key: '3.2', stage: 3, type: 'form', label: 'Background Check Disclosure Form for all adults living in the home', licensing: true, formEnv: 'SPONSOR_INTAKE_FORM_HOUSEHOLD_DISCLOSURE_URL' },
  { key: '3.3', stage: 3, type: 'event', label: 'Initiate sponsor background check' },
  { key: '3.4', stage: 3, type: 'event', label: 'Initiate sponsor Central Registry check' },
  { key: '3.5', stage: 3, type: 'event', label: 'Initiate background checks for all adults in the home' },
  { key: '3.6', stage: 3, type: 'event', label: 'Initiate Central Registry checks for all adults in the home' },
  { key: '3.7', stage: 3, type: 'document', label: 'Completed sponsor background check', licensing: true },
  { key: '3.8', stage: 3, type: 'document', label: 'Completed sponsor Central Registry check', licensing: true },
  { key: '3.9', stage: 3, type: 'document', label: 'Completed background checks for all adults in the home', licensing: true },
  { key: '3.10', stage: 3, type: 'document', label: 'Completed Central Registry checks for all adults in the home', licensing: true },

  // 4 · Forms & Review
  {
    key: '4.1', stage: 4, type: 'form', label: 'Sponsor Agreements packet', licensing: true, formEnv: 'SPONSOR_INTAKE_FORM_AGREEMENTS_URL',
    includes: [
      'Direct Deposit form',
      'W-9 form',
      'Rent Rate Sheet',
      'Accountant declaration / statement of understanding / independent contractor',
      'Sponsor Roles & Responsibilities / Licensing Requirements / No Advances',
      'Sponsor as an Independent Contractor / Accountant Declaration',
      'Commitment to Excellence',
      'Communication Protocol',
      'Sponsor Training Requirements',
      'Sponsor Pay Schedule / Pay Requirements / No Advances'
    ]
  },
  { key: '4.4', stage: 4, type: 'document', label: 'TB Assessment', licensing: true },
  { key: '4.5', stage: 4, type: 'upload', label: 'ASRS Sponsor Physician Statement of Good Health' },
  { key: '4.13', stage: 4, type: 'form', label: 'Sponsor Relief Plan and Budget', formEnv: 'SPONSOR_INTAKE_FORM_RELIEF_PLAN_URL' },
  { key: '4.14', stage: 4, type: 'upload', label: 'Automobile insurance declaration page' },
  { key: '4.15', stage: 4, type: 'upload', label: 'Homeowner\'s insurance declaration page' },
  { key: '4.16', stage: 4, type: 'training', label: 'Sponsor/DSP Role and Responsibilities', licensing: true, cert: true, visible: true },

  // 5 · Home Prep
  { key: '5.1', stage: 5, type: 'document', label: 'Home maintenance and improvement report' },
  { key: '5.2', stage: 5, type: 'document', label: 'Home layout and evacuation route', licensing: true },
  { key: '5.3', stage: 5, type: 'document', label: 'Fire inspection', licensing: true, visible: true },
  { key: '5.4', stage: 5, type: 'document', label: 'Real estate inspection', licensing: true, visible: true },
  { key: '5.5', stage: 5, type: 'event', label: 'Home setup and preparation', visible: true, agenda: [] },
  { key: '5.6', stage: 5, type: 'event', label: 'First aid kit setup', visible: true, agenda: [] },
  { key: '5.7', stage: 5, type: 'event', label: 'Emergency supply kit setup', visible: true, agenda: [] },
  { key: '5.8', stage: 5, type: 'event', label: 'Fire inspection readiness setup', visible: true, agenda: [] },
  { key: '5.9', stage: 5, type: 'document', label: 'Physical environment inspection', visible: true },

  // 6 · Training Phase 1
  { key: '6.1', stage: 6, type: 'training', label: 'HIPAA Training', licensing: true, cert: true, visible: true },
  { key: '6.2', stage: 6, type: 'training', label: 'Medication Administration Refresher', licensing: true, cert: true, visible: true },
  { key: '6.3', stage: 6, type: 'training', label: 'First Aid/CPR', licensing: true, cert: true, visible: true },
  { key: '6.4', stage: 6, type: 'training', label: 'Behavior Management Training (TOVA)', licensing: true, cert: true, visible: true },
  { key: '6.5', stage: 6, type: 'training', label: 'Universal Precautions and Infectious Controls', licensing: true, cert: true, visible: true },

  // 7 · Training Phase 2
  { key: '7.1', stage: 7, type: 'training', label: 'DD Waiver Orientation Training & Assurance Form', licensing: true, cert: true, visible: true },
  { key: '7.2', stage: 7, type: 'training', label: '32 Hour Medication Administration Training', licensing: true, cert: true, visible: true },
  { key: '7.3', stage: 7, type: 'training', label: 'Human Rights', licensing: true, cert: true, visible: true },
  { key: '7.4', stage: 7, type: 'training', label: 'Home and Community Based Services', licensing: true, cert: true, visible: true },
  { key: '7.5', stage: 7, type: 'training', label: 'Fire extinguisher / video training', cert: true, visible: true },
  { key: '7.6', stage: 7, type: 'training', label: 'Serious Incident Reporting', licensing: true, cert: true, visible: true },
  { key: '7.7', stage: 7, type: 'training', label: 'ID Waiver Key Summary and Review', visible: true },
  { key: '7.9', stage: 7, type: 'training', label: 'ASRS – How We Treat Our Residents', cert: true, visible: true },

  // 8 · Training Phases 3 & 4
  { key: '8.1', stage: 8, type: 'training', label: 'Behavior Supports for DSPs', licensing: true, cert: true, visible: true },
  { key: '8.2', stage: 8, type: 'training', label: 'Autism Supports for DSPs', licensing: true, cert: true, visible: true },
  { key: '8.3', stage: 8, type: 'training', label: 'How We Treat and Serve Our Residents', visible: true },
  { key: '8.4', stage: 8, type: 'training', label: 'DBHDS/ASRS Documentation Requirements', visible: true },
  { key: '8.5', stage: 8, type: 'training', label: 'Therap Training: Progress Notes', visible: true },
  { key: '8.6', stage: 8, type: 'training', label: 'Therap Training: Medication Administration Records', visible: true },
  { key: '8.7', stage: 8, type: 'training', label: 'Using TalentLMS/TalentCards', visible: true },
  { key: '8.8', stage: 8, type: 'training', label: 'ASRS How To Complete Monthly Reports', visible: true },
  { key: '8.9', stage: 8, type: 'training', label: 'Sponsor Shared Annual Planning and Weekly Check-in Plan', visible: true },

  // 9 · Final
  { key: '9.1', stage: 9, type: 'training', label: '28 Days to Complete, Accurate, and Timely Notes', cert: true, visible: true },
  { key: '9.2', stage: 9, type: 'event', label: 'Sponsor interview, pictures, and video', visible: true, agenda: [] },
  { key: '9.3', stage: 9, type: 'event', label: 'Sponsor webpage and video setup', visible: true, agenda: [] },
  { key: '9.4', stage: 9, type: 'document', label: 'Sponsor Readiness Certification', visible: true },
  { key: '9.5', stage: 9, type: 'event', label: 'ASRS/DBHDS licensing visit simulation', visible: true, agenda: [] },
  { key: '9.6', stage: 9, type: 'document', label: 'ASRS Sponsor Service Plan' },
  { key: '9.7', stage: 9, type: 'document', label: 'DSP Competency Assessment' },
  { key: '9.8', stage: 9, type: 'document', label: 'ASRS Orientation Training Completion Report', licensing: true, visible: true },
  { key: '9.9', stage: 9, type: 'training', label: 'Person Centered Thinking', cert: true, visible: true }
];

const STEPS_BY_KEY = {};
STEPS.forEach(function (s) { STEPS_BY_KEY[s.key] = s; });

// Item statuses, stored in the Items database's Status select:
//   (no row) — not started
//   Requested — sponsor item emailed, waiting on the sponsor
//   Received  — sponsor submitted it, waiting on admin review
//   Returned  — admin sent it back with a reason; goes out again on the next request
//   Scheduled — event with a date set, not yet marked done
//   Complete  — done (accepted, recorded, or uploaded by an admin)
const STATUS = {
  REQUESTED: 'Requested',
  RECEIVED: 'Received',
  RETURNED: 'Returned',
  SCHEDULED: 'Scheduled',
  COMPLETE: 'Complete'
};

function isSponsorStep(step) {
  return step.type === 'upload' || step.type === 'form';
}

function formUrlFor(step) {
  if (step.type !== 'form') return '';
  return process.env[step.formEnv] || step.defaultFormUrl || '';
}

function stageFor(num) {
  return STAGES.filter(function (s) { return s.num === num; })[0];
}

// Drive layout: {root}/{Sponsor Name}/{n Stage}/file — every folder
// found-or-created by name in the Zap, same idempotent pattern as Annual
// Planning, so this app never needs a folder ID back from Zapier.
function stageFolderName(stageNum) {
  const stage = stageFor(stageNum);
  return stage.num + ' ' + stage.name;
}

function sponsorFolderName(intake) {
  return (intake.name || 'Unnamed sponsor').replace(/[\/\\]+/g, '-').trim();
}

function todayIso() {
  return dateInTimeZone(new Date()).date;
}

// { date: 'YYYY-MM-DD', time: 'HH:mm' } for an instant, in TIME_ZONE.
function dateInTimeZone(d) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  return { date: parts.year + '-' + parts.month + '-' + parts.day, time: parts.hour + ':' + parts.minute };
}

// A stored Notion date is either 'YYYY-MM-DD' or a full timestamp with
// an offset; hand the UI back plain local date/time strings either way.
function splitEventDate(raw) {
  if (!raw) return { date: '', time: '' };
  if (raw.length <= 10) return { date: raw, time: '' };
  return dateInTimeZone(new Date(raw));
}

function sanitizeFilenamePart(s) {
  return (s || '').replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

// Human-readable name for a direct upload, e.g.
// "1.3 Photo ID - Maria Lopez - 2026-09-24 (1 of 2).pdf".
function uploadFilename(intake, step, part, total, ext) {
  let name = step.key + ' ' + sanitizeFilenamePart(step.label) + ' - ' + sanitizeFilenamePart(intake.name) + ' - ' + todayIso();
  if (total > 1) name += ' (' + part + ' of ' + total + ')';
  if (ext) name += '.' + ext;
  return name;
}

// JotForm path: the form's own native Google Drive integration saves the
// submission PDF into a shared staging folder named after the prefilled
// hidden `app_filename` field — the only channel that tells the reusable
// Zap which sponsor/step the PDF belongs to (same idea as Annual
// Planning). Dots in step keys become dashes so the whole thing survives
// as one token; the intake's Notion page ID is used instead of the name
// since a name can't be recovered losslessly.
function formFilename(intakeId, stepKey) {
  return 'Intake_' + intakeId.replace(/-/g, '') + '_' + stepKey.replace(/\./g, '-');
}

function parseFormFilename(filename) {
  const m = (filename || '').match(/Intake_([0-9a-fA-F]{32})_(\d+-\d+[a-z]?)/);
  if (!m) return null;
  const stepKey = m[2].replace('-', '.');
  if (!STEPS_BY_KEY[stepKey]) return null;
  return { intakeId: m[1], stepKey: stepKey };
}

function newStatusToken() {
  return crypto.randomBytes(24).toString('hex');
}

function richText(s) {
  return { rich_text: s ? [{ text: { content: String(s).slice(0, 2000) } }] : [] };
}

function intakeFromPage(page) {
  return {
    id: page.id,
    name: getPlainText(page.properties['Sponsor Name']),
    email: getPlainText(page.properties['Email']),
    phone: getPlainText(page.properties['Phone']),
    statusToken: getPlainText(page.properties['Status Token']),
    startedDate: getPlainText(page.properties['Started Date']),
    lastRequestSent: getPlainText(page.properties['Last Request Sent']),
    active: !!(page.properties['Active'] && page.properties['Active'].checkbox)
  };
}

function itemFromPage(page) {
  const p = page.properties;
  return {
    pageId: page.id,
    stepKey: getPlainText(p['Step Key']),
    status: getPlainText(p['Status']),
    eventDate: getPlainText(p['Event Date']),
    requestedDate: getPlainText(p['Requested Date']),
    receivedDate: getPlainText(p['Received Date']),
    completedDate: getPlainText(p['Completed Date']),
    filename: getPlainText(p['Filename']),
    returnReason: getPlainText(p['Return Reason']),
    notes: getPlainText(p['Notes']),
    lastUpdatedBy: getPlainText(p['Last Updated By'])
  };
}

async function listIntakes() {
  const pages = await queryDatabaseAll(INTAKES_DB_ID, { property: 'Active', checkbox: { equals: true } });
  return pages.map(intakeFromPage);
}

// Addressed directly by page ID (from a ticket, a filename, or the admin
// page), so confirm it really is a Sponsor Intakes row before trusting it.
async function getIntake(intakeId) {
  const page = await getPage(intakeId);
  if (!page.properties || !page.properties['Status Token']) {
    const err = new Error('Sponsor intake not found.');
    err.statusCode = 404;
    throw err;
  }
  return intakeFromPage(page);
}

async function findIntakeByToken(token) {
  if (!token || !/^[0-9a-f]{48}$/.test(token)) return null;
  const result = await queryDatabase(INTAKES_DB_ID, { property: 'Status Token', rich_text: { equals: token } });
  const page = (result.results || [])[0];
  if (!page) return null;
  const intake = intakeFromPage(page);
  return intake.active ? intake : null;
}

async function createIntake(name, email, phone, createdBy) {
  const page = await createPage(INTAKES_DB_ID, {
    'Sponsor Name': { title: [{ text: { content: name } }] },
    'Email': { email: email },
    'Phone': { phone_number: phone || null },
    'Status Token': richText(newStatusToken()),
    'Started Date': { date: { start: todayIso() } },
    'Created By': richText(createdBy),
    'Active': { checkbox: true }
  });
  return intakeFromPage(page);
}

async function itemsForIntake(intakeId) {
  const pages = await queryDatabaseAll(ITEMS_DB_ID, { property: 'Intake ID', rich_text: { equals: normalizeId(intakeId) } });
  const byKey = {};
  pages.forEach(function (page) {
    const item = itemFromPage(page);
    if (STEPS_BY_KEY[item.stepKey]) byKey[item.stepKey] = item;
  });
  return byKey;
}

// Notion hands back page IDs dashed; filenames carry them undashed.
// Stored and compared in the dashed form everywhere.
function normalizeId(id) {
  const hex = (id || '').replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) return id;
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

// Finds-or-creates the row for (intake, step) and applies `props` —
// rows are created lazily the first time anything happens to a step, the
// same way Staff Training items are.
async function upsertItem(intake, stepKey, props, existing) {
  const step = STEPS_BY_KEY[stepKey];
  if (existing === undefined) {
    const result = await queryDatabase(ITEMS_DB_ID, {
      and: [
        { property: 'Intake ID', rich_text: { equals: normalizeId(intake.id) } },
        { property: 'Step Key', rich_text: { equals: stepKey } }
      ]
    });
    existing = (result.results || [])[0] ? itemFromPage(result.results[0]) : null;
  }
  if (existing) {
    await updatePage(existing.pageId, props);
    return;
  }
  await createPage(ITEMS_DB_ID, Object.assign({
    'Record Title': { title: [{ text: { content: intake.name + ' - ' + stepKey + ' ' + step.label } }] },
    'Intake ID': richText(normalizeId(intake.id)),
    'Step Key': richText(stepKey)
  }, props));
}

function statusProp(status) {
  return { select: status ? { name: status } : null };
}

function dateProp(iso) {
  return { date: iso ? { start: iso } : null };
}

// Full ordered checklist for the admin page, with each step's current
// item state merged in (placeholders for steps with no row yet).
function fullItemList(itemsByKey) {
  return STEPS.map(function (step) {
    const item = itemsByKey[step.key] || {};
    const event = splitEventDate(item.eventDate);
    return {
      key: step.key,
      stage: step.stage,
      type: step.type,
      label: step.label,
      licensing: !!step.licensing,
      visibleToSponsor: isSponsorStep(step) || !!step.visible,
      sponsorStep: isSponsorStep(step),
      cert: !!step.cert,
      includes: step.includes || [],
      agenda: step.agenda || [],
      formConfigured: step.type === 'form' ? !!formUrlFor(step) : null,
      status: item.status || '',
      eventDate: event.date,
      eventTime: event.time,
      requestedDate: item.requestedDate || '',
      receivedDate: item.receivedDate || '',
      completedDate: item.completedDate || '',
      filename: item.filename || '',
      returnReason: item.returnReason || '',
      notes: item.notes || '',
      lastUpdatedBy: item.lastUpdatedBy || ''
    };
  });
}

// Per-stage progress plus the current stage (the first one with anything
// not yet Complete). null currentStage = intake complete.
function stageSummary(itemsByKey) {
  const stages = STAGES.map(function (stage) {
    const steps = STEPS.filter(function (s) { return s.stage === stage.num; });
    const complete = steps.filter(function (s) {
      const item = itemsByKey[s.key];
      return item && item.status === STATUS.COMPLETE;
    }).length;
    return { num: stage.num, name: stage.name, total: steps.length, complete: complete, isComplete: complete === steps.length };
  });
  const current = stages.filter(function (s) { return !s.isComplete; })[0] || null;
  return { stages: stages, currentStage: current ? current.num : null };
}

function pipelineSummary(intake, itemsByKey) {
  const summary = stageSummary(itemsByKey);
  let waitingOnSponsor = 0;
  let needsReview = 0;
  let oldestRequest = '';
  Object.keys(itemsByKey).forEach(function (key) {
    const item = itemsByKey[key];
    if (item.status === STATUS.REQUESTED || item.status === STATUS.RETURNED) {
      waitingOnSponsor++;
      if (item.requestedDate && (!oldestRequest || item.requestedDate < oldestRequest)) oldestRequest = item.requestedDate;
    }
    if (item.status === STATUS.RECEIVED) needsReview++;
  });
  const done = summary.stages.reduce(function (n, s) { return n + s.complete; }, 0);
  return {
    id: intake.id,
    name: intake.name,
    email: intake.email,
    startedDate: intake.startedDate,
    currentStage: summary.currentStage,
    currentStageName: summary.currentStage ? stageFor(summary.currentStage).name : 'Complete',
    completeCount: done,
    totalCount: STEPS.length,
    waitingOnSponsor: waitingOnSponsor,
    needsReview: needsReview,
    oldestRequest: oldestRequest
  };
}

function siteBaseUrl() {
  return (process.env.SPONSOR_INTAKE_BASE_URL || process.env.URL || '').replace(/\/+$/, '');
}

function statusPageUrl(intake) {
  return siteBaseUrl() + '/intake/?t=' + intake.statusToken;
}

// The link a sponsor step's button points to — in the request email and
// on the status page alike. A form step whose JotForm isn't configured
// yet falls back to the upload page, so the sponsor can still send a
// completed copy.
function sponsorActionUrl(intake, step) {
  const formUrl = formUrlFor(step);
  if (formUrl) {
    const url = new URL(formUrl);
    url.searchParams.set('app_filename', formFilename(intake.id, step.key));
    return url.toString();
  }
  return siteBaseUrl() + '/intake/upload.html?t=' + intake.statusToken + '&step=' + encodeURIComponent(step.key);
}

function sponsorActionLabel(step) {
  return formUrlFor(step) ? 'Complete form' : 'Upload';
}

// Sponsor-safe status payload. Deliberately built from an allowlist —
// only sponsor steps and `visible` admin steps are named, never notes,
// filenames, return history beyond the current reason, or anything from
// the Background stage's admin side.
function sponsorStatus(intake, itemsByKey) {
  const summary = stageSummary(itemsByKey);
  const now = dateInTimeZone(new Date());

  const stages = summary.stages.map(function (s) {
    const state = s.isComplete ? 'complete' : (s.num === summary.currentStage ? 'current' : 'upcoming');
    const items = STEPS.filter(function (step) {
      return step.stage === s.num && (isSponsorStep(step) || step.visible);
    }).map(function (step) {
      const item = itemsByKey[step.key] || {};
      const event = splitEventDate(item.eventDate);
      let itemState = 'not-started';
      if (item.status === STATUS.COMPLETE) itemState = 'complete';
      else if (item.status === STATUS.RECEIVED) itemState = 'under-review';
      else if (item.status === STATUS.REQUESTED || item.status === STATUS.RETURNED) itemState = 'action-needed';
      else if (item.status === STATUS.SCHEDULED) itemState = 'scheduled';
      return {
        key: step.key,
        label: step.label,
        state: itemState,
        eventDate: step.type === 'event' ? event.date : '',
        eventTime: step.type === 'event' ? event.time : '',
        completedDate: item.status === STATUS.COMPLETE ? (item.completedDate || '') : ''
      };
    });
    return { num: s.num, name: s.name, state: state, items: items };
  });

  const actionNeeded = STEPS.filter(function (step) {
    const item = itemsByKey[step.key];
    return isSponsorStep(step) && item && (item.status === STATUS.REQUESTED || item.status === STATUS.RETURNED);
  }).map(function (step) {
    const item = itemsByKey[step.key];
    return {
      key: step.key,
      label: step.label,
      includes: step.includes || [],
      returnReason: item.status === STATUS.RETURNED ? item.returnReason : '',
      actionUrl: sponsorActionUrl(intake, step),
      actionLabel: sponsorActionLabel(step)
    };
  });

  const upcoming = STEPS.filter(function (step) {
    const item = itemsByKey[step.key];
    if (step.type !== 'event' || !step.visible || !item || item.status !== STATUS.SCHEDULED) return false;
    const event = splitEventDate(item.eventDate);
    return event.date && event.date >= now.date;
  }).map(function (step) {
    const event = splitEventDate(itemsByKey[step.key].eventDate);
    return { label: step.label, date: event.date, time: event.time };
  }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });

  return {
    name: intake.name,
    startedDate: intake.startedDate,
    currentStage: summary.currentStage,
    currentStageNote: summary.currentStage ? stageFor(summary.currentStage).sponsorNote : '',
    stages: stages,
    actionNeeded: actionNeeded,
    underReview: STEPS.filter(function (step) {
      const item = itemsByKey[step.key];
      return isSponsorStep(step) && item && item.status === STATUS.RECEIVED;
    }).map(function (step) { return { key: step.key, label: step.label }; }),
    upcoming: upcoming
  };
}

// Admin dashboard gate: any admin-dashboard session, optionally narrowed
// to SPONSOR_INTAKE_ADMIN_EMAILS (comma-separated) — intake files hold
// background check results, which not every location admin needs.
function requireIntakeAdmin(event) {
  const session = requireSession(event);
  if (session.accountType !== 'admin-dashboard') {
    const err = new Error('Not authorized for the admin dashboard.');
    err.statusCode = 403;
    throw err;
  }
  const allow = (process.env.SPONSOR_INTAKE_ADMIN_EMAILS || '').split(',')
    .map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (allow.length && allow.indexOf((session.email || '').toLowerCase()) === -1) {
    const err = new Error('Not authorized for Sponsor Intake.');
    err.statusCode = 403;
    throw err;
  }
  return session;
}

function json(statusCode, body) {
  return { statusCode: statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function errorResponse(err) {
  console.error(err);
  return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
}

module.exports = {
  STAGES,
  STEPS,
  STEPS_BY_KEY,
  STATUS,
  TIME_ZONE,
  isSponsorStep,
  formUrlFor,
  stageFor,
  stageFolderName,
  sponsorFolderName,
  todayIso,
  dateInTimeZone,
  uploadFilename,
  formFilename,
  parseFormFilename,
  richText,
  statusProp,
  dateProp,
  listIntakes,
  getIntake,
  findIntakeByToken,
  createIntake,
  itemsForIntake,
  upsertItem,
  normalizeId,
  fullItemList,
  stageSummary,
  pipelineSummary,
  siteBaseUrl,
  statusPageUrl,
  sponsorActionUrl,
  sponsorActionLabel,
  sponsorStatus,
  requireIntakeAdmin,
  json,
  errorResponse
};
