const { queryDatabase, updatePage, createPage, getPlainText, getPage, driveFolderIdFromUrl } = require('./notion');

const STAFF_TRAINING_DB_ID = process.env.STAFF_TRAINING_DB_ID;
const ASRS_PEOPLE_DB_ID = process.env.ASRS_PEOPLE_DB_ID;

// Unlike Annual Planning or MAR Review, this process has no shared
// cycle date and no finalize step — each of the 19 items expires on its
// own schedule, set by the admin whenever that specific item is
// completed, and just gets renewed independently whenever it's next due.
// Puzzle turns yellow + starts spinning this many days before the
// earliest upcoming expiration across all 19 items.
const WINDOW_DAYS_BEFORE_DUE = 30;

// Keys match the Step Key select options on the Staff Training Items
// Notion database. `formUrl` is only set for steps with a preconfigured
// form today — every step still allows a plain upload regardless.
const STEPS = [
  { key: 'FirstAidCPR', label: 'First Aid/CPR' },
  { key: 'BehaviorManagement', label: 'Behavior Management Training' },
  { key: 'MedicationAdminRefresher', label: 'Medication Administration Refresher' },
  { key: 'HumanRights', label: 'Human Rights' },
  { key: 'HCBS', label: 'Home and Community Based Services (HCBS)' },
  { key: 'SeriousIncidentReporting', label: 'Serious Incident Reporting' },
  { key: 'UniversalPrecautions', label: 'Universal Precautions/Infectious Controls' },
  { key: 'EmergencyPreparation', label: 'Emergency Preparation/Crisis Management' },
  { key: 'HIPAATraining', label: 'HIPAA Training' },
  { key: 'DSPCompetencies', label: 'DSP Competencies Assessment Report' },
  { key: 'AnnualPerformanceEval', label: 'Annual Performance Evaluation & Review' },
  { key: 'RolesAndResponsibilities', label: 'ASRS Role and Responsibilities' },
  { key: 'TBTest', label: 'TB Test/Assessment' },
  { key: 'BehaviorSupports', label: 'Behavior Supports for DSPs' },
  { key: 'AutismSupports', label: 'Autism Supports for DSPs' },
  { key: 'PersonCenteredThinking', label: 'Person Centered Thinking Training' },
  { key: 'SharedPlanningGoals', label: 'Shared Planning & Goals' },
  { key: 'HowWeTreatResidents', label: 'How We Treat Our Residents' },
  { key: 'PsychologicalFirstAid', label: 'Psychological First Aid' }
];
const STEP_KEYS = STEPS.map(function (s) { return s.key; });

function sanitizeForFilename(s) { return (s || '').replace(/[^a-zA-Z0-9]+/g, ''); }

// Filename convention: "{location}_Staff_{staffId}_{stepKey}_{expDate}".
// Uses the staff member's ASRS People page ID rather than their name —
// unlike resident initials or the fixed SERVICES enum in
// lib/annual-planning.js, a full name ("Ovetis Cooper") loses
// information once sanitizeForFilename strips its spaces, so it can't
// be parsed back unambiguously. The page ID has no such problem and is
// the only channel available when a document reaches Drive through a
// form's own native "save to Drive" integration.
function buildFilename(location, staffId, stepKey, expDate) {
  return sanitizeForFilename(location) + '_Staff_' + sanitizeForFilename(staffId) + '_' + stepKey + '_' + expDate;
}

function parseFilename(filename) {
  const parts = (filename || '').split('_');
  if (parts.length !== 5 || parts[1] !== 'Staff') return null;
  const stepKey = STEP_KEYS.indexOf(parts[3]) !== -1 ? parts[3] : null;
  if (!stepKey) return null;
  return { location: parts[0], staffId: parts[2], stepKey: stepKey, expDate: parts[4] };
}

// Looks a staff member up directly by their ASRS People page ID (as
// embedded in a filename) rather than by name — Notion's API accepts
// page IDs with or without dashes, which is exactly the mangled form
// sanitizeForFilename produces.
async function staffInfoById(staffId) {
  const page = await getPage(staffId);
  return {
    id: page.id,
    name: getPlainText(page.properties['Name']),
    location: getPlainText(page.properties['Location']),
    trainingFolderUrl: getPlainText(page.properties['Training Folder URL'])
  };
}

async function staffListForLocation(location) {
  const result = await queryDatabase(ASRS_PEOPLE_DB_ID, {
    and: [
      { property: 'Type', select: { equals: 'Staff' } },
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(function (page) {
    return {
      id: page.id,
      name: getPlainText(page.properties['Name']),
      trainingFolderUrl: getPlainText(page.properties['Training Folder URL'])
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function itemFromPage(page) {
  return {
    id: page.id,
    stepKey: getPlainText(page.properties['Step Key']),
    done: !!page.properties['Done'].checkbox,
    filename: getPlainText(page.properties['Filename']),
    expDate: getPlainText(page.properties['Exp Date'])
  };
}

// Every active item row for a staff member — however many of the 19
// exist so far (a brand-new staff member has none yet; each gets
// created lazily the first time it's completed, see markItemDone).
async function itemsForStaff(location, staffName) {
  const result = await queryDatabase(STAFF_TRAINING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Staff Name', rich_text: { equals: staffName } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(itemFromPage);
}

// Fills in every one of the 19 steps, using a placeholder for whichever
// don't have a row yet — the UI needs a stable, complete list to render,
// not just however many happen to exist in Notion.
function fullStepList(items) {
  const byKey = {};
  items.forEach(function (i) { byKey[i.stepKey] = i; });
  return STEPS.map(function (step) {
    const item = byKey[step.key];
    return {
      key: step.key,
      label: step.label,
      formUrl: step.formUrl || '',
      done: item ? item.done : false,
      filename: item ? item.filename : '',
      expDate: item ? item.expDate : ''
    };
  });
}

// One week... no — literally the expiration date itself, per spec: "next
// due date will be when the next document expires," no offset the way
// MAR/Annual Planning/Supplies subtract a lead time from their due date.
// The 30-day lead time instead only controls when the puzzle icon turns
// yellow and starts spinning (see statusForStaffTraining below).
// Returns null if any of the 19 items has never been completed — that
// reads as "incomplete," a different (and more urgent) state than "due
// on a real date," same as a checklist that's never been reviewed at
// all elsewhere in this app.
function computeStaffDueDate(items) {
  const fullList = fullStepList(items);
  const missing = fullList.some(function (s) { return !s.done || !s.expDate; });
  if (missing) return null;
  const dates = fullList.map(function (s) { return new Date(s.expDate + 'T00:00:00'); });
  return new Date(Math.min.apply(null, dates));
}

// hasCycle mirrors the other processes' window-state shape for the
// client's convenience, even though there's no real "cycle" here.
function computeStaffTrainingWindow(items, now) {
  now = now || new Date();
  const missingCount = fullStepList(items).filter(function (s) { return !s.done || !s.expDate; }).length;
  const dueDate = computeStaffDueDate(items);

  if (missingCount > 0) {
    return { hasStarted: items.length > 0, missingCount: missingCount, dueDate: null, isDueSoon: false, isOverdue: false };
  }

  const windowOpenDate = new Date(dueDate);
  windowOpenDate.setDate(windowOpenDate.getDate() - WINDOW_DAYS_BEFORE_DUE);
  return {
    hasStarted: true,
    missingCount: 0,
    dueDate: dueDate,
    isDueSoon: now >= windowOpenDate && now < dueDate,
    isOverdue: now >= dueDate
  };
}

// Finds-or-creates the row for (location, staffName, stepKey) and marks
// it done — no window/lock checks the way Annual Planning has, since
// there's no cycle to gate: any item can be updated at any time.
async function markItemDone(location, staffName, stepKey, filename, expDate, updatedBy) {
  const result = await queryDatabase(STAFF_TRAINING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Staff Name', rich_text: { equals: staffName } },
      { property: 'Step Key', select: { equals: stepKey } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const existing = (result.results || [])[0];
  const today = new Date().toISOString().slice(0, 10);
  const props = {
    'Done': { checkbox: true },
    'Filename': { rich_text: filename ? [{ text: { content: filename } }] : [] },
    'Exp Date': { date: { start: expDate } },
    'Last Updated By': { rich_text: [{ text: { content: updatedBy } }] },
    'Last Updated Date': { date: { start: today } }
  };

  if (existing) {
    await updatePage(existing.id, props);
    return;
  }

  await createPage(STAFF_TRAINING_DB_ID, Object.assign({
    'Record Title': { title: [{ text: { content: location + ' - ' + staffName + ' - ' + stepKey } }] },
    'Location': { select: { name: location } },
    'Staff Name': { rich_text: [{ text: { content: staffName } }] },
    'Step Key': { select: { name: stepKey } },
    'Active': { checkbox: true }
  }, props));
}

module.exports = {
  STEPS,
  STEP_KEYS,
  WINDOW_DAYS_BEFORE_DUE,
  buildFilename,
  parseFilename,
  staffInfoById,
  staffListForLocation,
  itemsForStaff,
  fullStepList,
  computeStaffDueDate,
  computeStaffTrainingWindow,
  markItemDone,
  driveFolderIdFromUrl
};
