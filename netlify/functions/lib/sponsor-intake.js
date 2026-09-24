const crypto = require('crypto');
const { queryDatabase, queryDatabaseAll, updatePage, createPage, getPage, getPlainText } = require('./notion');
const { requireSession } = require('./session');

const INTAKES_DB_ID = process.env.SPONSOR_INTAKES_DB_ID;
const ITEMS_DB_ID = process.env.SPONSOR_INTAKE_ITEMS_DB_ID;
const TIME_ZONE = process.env.SPONSOR_INTAKE_TIME_ZONE || 'America/New_York';

// Sponsor intake is a one-time, stage-by-stage checklist for a
// prospective sponsor. Unlike every other process in this app it has
// no location, no resident, and no recurring cycle. The sponsor never
// logs in: they only ever see (1) the request emails an admin sends from
// the dashboard, whose buttons open a single-item upload page or a
// JotForm, and (2) a read-only status page behind a private link.
//
// The checklist itself lives in Notion, not in code, so it can be edited
// without a deploy: "Intake Stages" (SPONSOR_INTAKE_STAGES_DB_ID) and
// "Intake Steps" (SPONSOR_INTAKE_STEPS_DB_ID). Progress rows in the Items
// database are keyed by each step's Key, which is why a Key must never
// change once used — rename the Label instead.
const STAGES_DB_ID = process.env.SPONSOR_INTAKE_STAGES_DB_ID;
const STEPS_DB_ID = process.env.SPONSOR_INTAKE_STEPS_DB_ID;
const CHECKLIST_TTL_MS = 30 * 1000;

// Notion "Type" option -> internal type:
//   upload   — sponsor uploads a document (single-item upload page)
//   form     — sponsor completes a JotForm (falls back to an upload link
//              if its Form Link is blank)
//   event    — admin records a date (and optional time); "Scheduled"
//              until marked done. Agenda lines show on the admin page.
//   document — admin uploads a document ASRS produces or receives
//   training — admin records a completion date; Certificate adds an
//              optional certificate upload
const TYPE_MAP = {
  'Sponsor Upload': 'upload',
  'Sponsor Form': 'form',
  'Meeting / Event': 'event',
  'ASRS Document': 'document',
  'Training': 'training'
};
const KEY_RE = /^\d+\.\d+[a-z]?$/;

function lines(text) {
  return (text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
}

function checkbox(prop) {
  return !!(prop && prop.checkbox);
}

let checklistCache = null;

// Loads and validates the checklist. A bad row never breaks the app: it
// is skipped and described in `problems`, which the admin dashboard shows
// so whoever edited Notion can fix it. Cached for 30s per function
// instance; admin pages pass { fresh: true } so an edit shows up on the
// next reload.
async function loadChecklist(options) {
  options = options || {};
  if (!options.fresh && checklistCache && Date.now() - checklistCache.at < CHECKLIST_TTL_MS) {
    return checklistCache.value;
  }
  if (!STAGES_DB_ID || !STEPS_DB_ID) {
    const err = new Error('Sponsor Intake checklist is not configured (SPONSOR_INTAKE_STAGES_DB_ID / SPONSOR_INTAKE_STEPS_DB_ID).');
    err.statusCode = 500;
    throw err;
  }

  const results = await Promise.all([queryDatabaseAll(STAGES_DB_ID), queryDatabaseAll(STEPS_DB_ID)]);
  const problems = [];

  const allStages = {};
  const stages = [];
  results[0].forEach(function (page) {
    const p = page.properties;
    const name = getPlainText(p['Name']);
    const num = getPlainText(p['Number']);
    const active = checkbox(p['Active']);
    if (!active) {
      if (typeof num === 'number') allStages[num] = false;
      return;
    }
    if (typeof num !== 'number' || !name) {
      problems.push('Stage "' + (name || '(untitled)') + '" skipped: it needs a Name and a Number.');
      return;
    }
    if (allStages[num]) {
      problems.push('Stage "' + name + '" skipped: another active stage already uses Number ' + num + '.');
      return;
    }
    const stage = { num: num, name: name, sponsorNote: getPlainText(p['Sponsor Note']) || name };
    allStages[num] = stage;
    stages.push(stage);
  });
  stages.sort(function (a, b) { return a.num - b.num; });
  stages.forEach(function (s, i) { s.position = i + 1; });

  const steps = [];
  const byKey = {};
  results[1].forEach(function (page) {
    const p = page.properties;
    if (!checkbox(p['Active'])) return;
    const label = getPlainText(p['Label']);
    const key = (getPlainText(p['Key']) || '').trim();
    const stageNum = getPlainText(p['Stage']);
    const typeName = getPlainText(p['Type']);
    const name = '"' + (label || key || '(untitled)') + '"';
    if (!label || !key) return problems.push('Step ' + name + ' skipped: it needs both a Label and a Key.');
    if (!KEY_RE.test(key)) return problems.push('Step ' + name + ' skipped: Key "' + key + '" must look like 2.3 or 2.3a.');
    if (byKey[key]) return problems.push('Step ' + name + ' skipped: Key ' + key + ' is already used by "' + byKey[key].label + '".');
    if (!TYPE_MAP[typeName]) return problems.push('Step ' + name + ' skipped: choose a Type.');
    if (allStages[stageNum] === false) return; // stage retired: its steps quietly retire with it
    if (!allStages[stageNum]) return problems.push('Step ' + name + ' skipped: Stage ' + (stageNum == null ? '(blank)' : stageNum) + ' is not an active stage.');

    const type = TYPE_MAP[typeName];
    const formUrl = getPlainText(p['Form Link']) || '';
    if (type === 'form' && formUrl && !/^https?:\/\//i.test(formUrl)) {
      problems.push('Step ' + name + ': Form Link must start with https://, so the sponsor gets an upload link for now.');
    }
    const order = getPlainText(p['Order']);
    const step = {
      key: key,
      stage: stageNum,
      order: typeof order === 'number' ? order : 9999,
      type: type,
      label: label,
      licensing: checkbox(p['Licensing']),
      visible: checkbox(p['Visible to Sponsor']),
      cert: type === 'training' && checkbox(p['Certificate']),
      formUrl: type === 'form' && /^https?:\/\//i.test(formUrl) ? formUrl : '',
      includes: lines(getPlainText(p['Includes'])),
      agenda: lines(getPlainText(p['Agenda']))
    };
    byKey[key] = step;
    steps.push(step);
  });

  steps.sort(function (a, b) {
    return (a.stage - b.stage) || (a.order - b.order) || a.key.localeCompare(b.key, undefined, { numeric: true });
  });

  const value = { stages: stages, steps: steps, byKey: byKey, problems: problems };
  checklistCache = { at: Date.now(), value: value };
  return value;
}

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

// For the Zapier/upload paths, where a file is already on its way: if its
// step was retired in Notion after being requested, still file it
// (under "Other") rather than lose it.
function stepOrPlaceholder(cl, key) {
  return cl.byKey[key] || { key: key, stage: null, type: 'upload', label: 'Document', includes: [], agenda: [], formUrl: '' };
}

function formUrlFor(step) {
  return step.type === 'form' ? step.formUrl : '';
}

function stageFor(cl, num) {
  return cl.stages.filter(function (s) { return s.num === num; })[0];
}

// Drive layout: {root}/{Sponsor Name}/{n Stage}/file — every folder
// found-or-created by name in the Zap, same idempotent pattern as Annual
// Planning, so this app never needs a folder ID back from Zapier.
function stageFolderName(cl, stageNum) {
  const stage = stageFor(cl, stageNum);
  return stage ? stage.num + ' ' + stage.name.replace(/[\/\\]+/g, '-') : 'Other';
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
  return { intakeId: m[1], stepKey: m[2].replace('-', '.') };
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
    if (item.stepKey) byKey[item.stepKey] = item;
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
async function upsertItem(intake, step, props, existing) {
  const stepKey = step.key;
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
function fullItemList(cl, itemsByKey) {
  return cl.steps.map(function (step) {
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
      includes: step.includes,
      agenda: step.agenda,
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
function stageSummary(cl, itemsByKey) {
  const stages = cl.stages.map(function (stage) {
    const steps = cl.steps.filter(function (s) { return s.stage === stage.num; });
    const complete = steps.filter(function (s) {
      const item = itemsByKey[s.key];
      return item && item.status === STATUS.COMPLETE;
    }).length;
    return { num: stage.num, position: stage.position, name: stage.name, total: steps.length, complete: complete, isComplete: complete === steps.length };
  });
  const current = stages.filter(function (s) { return !s.isComplete; })[0] || null;
  return {
    stages: stages,
    stageCount: stages.length,
    currentStage: current ? current.num : null,
    currentPosition: current ? current.position : null
  };
}

function pipelineSummary(cl, intake, itemsByKey) {
  const summary = stageSummary(cl, itemsByKey);
  let waitingOnSponsor = 0;
  let needsReview = 0;
  let oldestRequest = '';
  cl.steps.forEach(function (step) {
    const item = itemsByKey[step.key];
    if (!item) return;
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
    currentPosition: summary.currentPosition,
    stageCount: summary.stageCount,
    currentStageName: summary.currentStage ? stageFor(cl, summary.currentStage).name : 'Complete',
    completeCount: done,
    totalCount: cl.steps.length,
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
function sponsorStatus(cl, intake, itemsByKey) {
  const summary = stageSummary(cl, itemsByKey);
  const now = dateInTimeZone(new Date());

  const stages = summary.stages.map(function (s) {
    const state = s.isComplete ? 'complete' : (s.num === summary.currentStage ? 'current' : 'upcoming');
    const items = cl.steps.filter(function (step) {
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

  const actionNeeded = cl.steps.filter(function (step) {
    const item = itemsByKey[step.key];
    return isSponsorStep(step) && item && (item.status === STATUS.REQUESTED || item.status === STATUS.RETURNED);
  }).map(function (step) {
    const item = itemsByKey[step.key];
    return {
      key: step.key,
      label: step.label,
      includes: step.includes,
      returnReason: item.status === STATUS.RETURNED ? item.returnReason : '',
      actionUrl: sponsorActionUrl(intake, step),
      actionLabel: sponsorActionLabel(step)
    };
  });

  const upcoming = cl.steps.filter(function (step) {
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
    currentPosition: summary.currentPosition,
    stageCount: summary.stageCount,
    currentStageNote: summary.currentStage ? stageFor(cl, summary.currentStage).sponsorNote : '',
    stages: stages,
    actionNeeded: actionNeeded,
    underReview: cl.steps.filter(function (step) {
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
  loadChecklist,
  stepOrPlaceholder,
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
