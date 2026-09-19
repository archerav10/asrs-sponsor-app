const { queryDatabase, updatePage, createPage, getPlainText } = require('./notion');

const ANNUAL_PLANNING_DB_ID = process.env.ANNUAL_PLANNING_DB_ID;

// A resident can be enrolled in more than one service at once (e.g.
// Congregate Residential AND Non-Center-Based Day Support), each with
// its own entirely separate Drive folder and its own independent annual
// cycle. Congregate Residential is the default every resident gets a
// button for automatically (residents are scoped by physical Location
// everywhere else in this app, which is how that service's folders are
// organized); the others only show up once an admin explicitly adds one
// for a resident who needs it.
const SERVICES = ['Congregate Residential', 'Non-Center-Based Day Support', 'Positive Behavior Support'];
const DEFAULT_SERVICE = SERVICES[0];

// How many weeks before the due date a resident's card unlocks (puzzle
// turns yellow + starts rotating, steps become clickable). A named
// constant, not inlined, since this is exactly the kind of number that's
// likely to get tuned later — same reasoning as MAR's WINDOW_DAYS_BEFORE_DUE.
const WINDOW_WEEKS_BEFORE_DUE = 6;

// The 10 document steps, in checklist order. `formUrl` is only set for
// steps that have a preconfigured form today — every step still allows a
// plain upload regardless. Add a formUrl here later to light up the
// "Complete Form" option for another step; no other code changes needed.
const STEPS = [
  { key: 'MeetingNotes', label: 'Annual Planning Meeting Notes' },
  { key: 'CompAssessment', label: 'Comprehensive Assessment' },
  { key: 'ISP', label: 'Individualized Service Plan' },
  { key: 'AuthRelease', label: 'Authorization for Release of Information', formUrl: process.env.ANNUAL_PLANNING_AUTH_RELEASE_FORM_URL || '' },
  { key: 'FallRisk', label: 'Fall Risk Assessment' },
  { key: 'HealthHistory', label: 'Consumer Health History' },
  { key: 'HumanRights', label: 'Human Rights' },
  { key: 'HCBS', label: 'Home and Community Based Services' },
  { key: 'FaceSheet', label: 'Face Sheet' },
  { key: 'Lease', label: 'Lease' }
];

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// Due date is one year after the effective date, minus a day (the same
// "remains in effect for one year from the date above" language as the
// Authorization for Release template itself) — e.g. 2026-02-01 through
// 2027-01-31.
function computeDueDate(effectiveDateStr) {
  const d = new Date(effectiveDateStr + 'T00:00:00');
  const due = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
  due.setDate(due.getDate() - 1);
  return due;
}

function computeWindowOpenDate(dueDate) {
  const d = new Date(dueDate);
  d.setDate(d.getDate() - WINDOW_WEEKS_BEFORE_DUE * 7);
  return d;
}

// The Drive folder name for a cycle, e.g. "20260201-20270131" — matches
// the convention already in use in Drive (Annual Planning/<this>/...).
function computeFolderName(effectiveDateStr) {
  const start = new Date(effectiveDateStr + 'T00:00:00');
  const due = computeDueDate(effectiveDateStr);
  const fmt = function (dt) { return dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()); };
  return fmt(start) + '-' + fmt(due);
}

function oneYearLater(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return isoDate(new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()));
}

async function findRecord(location, resident, service) {
  // An unset Service (empty select — e.g. a row created by hand, or
  // before this field existed) is treated as the default service, same
  // as recordFromPage's own `|| DEFAULT_SERVICE` fallback below. Notion's
  // select-equals filter does not match an empty value, so this needs
  // its own branch rather than just filtering on equals(service).
  const serviceFilter = service === DEFAULT_SERVICE
    ? { or: [{ property: 'Service', select: { equals: service } }, { property: 'Service', select: { is_empty: true } }] }
    : { property: 'Service', select: { equals: service } };

  const result = await queryDatabase(ANNUAL_PLANNING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      serviceFilter,
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || [])[0] || null;
}

// Every active record for this resident at this location, regardless of
// service — used by the oversight board to work out which non-default
// services (if any) already have a cycle tracked, without having to
// query each of SERVICES individually.
async function findRecordsForResident(location, resident) {
  const result = await queryDatabase(ANNUAL_PLANNING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(recordFromPage);
}

function recordFromPage(page) {
  if (!page) return null;
  const record = {
    id: page.id,
    service: getPlainText(page.properties['Service']) || DEFAULT_SERVICE,
    folderUrl: getPlainText(page.properties['Annual Planning Folder URL']),
    effectiveDate: getPlainText(page.properties['Effective Date']),
    finalized: !!page.properties['Finalized'].checkbox,
    finalizedDate: getPlainText(page.properties['Finalized Date']),
    finalizedBy: getPlainText(page.properties['Finalized By']),
    steps: {}
  };
  STEPS.forEach(function (step) {
    record.steps[step.key] = {
      done: !!page.properties[step.key + ' Done'].checkbox,
      filename: getPlainText(page.properties[step.key + ' Filename'])
    };
  });
  return record;
}

// Same shape as computeMarWindow in lib/mar-review-state.js: given
// whatever's on file, works out the cycle currently being targeted, its
// due date, when its window opens, and whether it's already finalized.
// With no record yet (a resident who's never been through this process
// in the app), there's no due date to gate on, so the window is always
// open — Step 1 has to be reachable to bootstrap the very first cycle.
//
// A finalized record stays "finalized for target" (locked, link-only)
// for its own full shelf life — it does NOT roll forward the instant
// it's finalized the way MAR's target period does. It only rolls once
// the NEXT cycle's own window opens (handled by
// rollToNextCycleIfWindowJustOpened below), which is also the point
// isFinalizedForTarget naturally flips back to false and isWindowOpen
// flips true for the new cycle.
function computeAnnualPlanningWindow(record, now) {
  now = now || new Date();

  if (!record || !record.effectiveDate) {
    return { hasCycle: false, targetEffectiveDate: null, dueDate: null, windowOpenDate: null, isWindowOpen: true, isFinalizedForTarget: false };
  }

  const dueDate = computeDueDate(record.effectiveDate);
  const windowOpenDate = computeWindowOpenDate(dueDate);

  if (record.finalized) {
    const nextEffectiveDate = oneYearLater(record.effectiveDate);
    const nextDueDate = computeDueDate(nextEffectiveDate);
    const nextWindowOpenDate = computeWindowOpenDate(nextDueDate);

    if (now < nextWindowOpenDate) {
      return { hasCycle: true, targetEffectiveDate: record.effectiveDate, dueDate: dueDate, windowOpenDate: windowOpenDate, isWindowOpen: false, isFinalizedForTarget: true };
    }
    return { hasCycle: true, targetEffectiveDate: nextEffectiveDate, dueDate: nextDueDate, windowOpenDate: nextWindowOpenDate, isWindowOpen: true, isFinalizedForTarget: false };
  }

  return { hasCycle: true, targetEffectiveDate: record.effectiveDate, dueDate: dueDate, windowOpenDate: windowOpenDate, isWindowOpen: now >= windowOpenDate, isFinalizedForTarget: false };
}

// If the next cycle's window has opened and the record still reflects
// the PRIOR (finalized) cycle, roll it forward: blank every step and
// stamp the new target's effective date, so the resident's card starts
// clean. Lazy, one-time-per-cycle, same timing as MAR's
// wipeIfWindowJustOpened — this is the single place that owns "should
// this cycle's data still be here."
async function rollToNextCycleIfWindowJustOpened(options) {
  const location = options.location;
  const resident = options.resident;
  const record = options.record;
  const windowState = options.windowState;

  const needsRoll = windowState.hasCycle && windowState.isWindowOpen &&
    record.finalized && record.effectiveDate !== windowState.targetEffectiveDate;
  if (!needsRoll) {
    return { rolled: false, record: record };
  }

  const props = {
    'Effective Date': { date: { start: windowState.targetEffectiveDate } },
    'Finalized': { checkbox: false },
    'Finalized Date': { date: null },
    'Finalized By': { rich_text: [] }
  };
  STEPS.forEach(function (step) {
    props[step.key + ' Done'] = { checkbox: false };
    props[step.key + ' Filename'] = { rich_text: [] };
  });

  const updated = await updatePage(record.id, props);
  return { rolled: true, record: recordFromPage(updated) };
}

// Single entry point every endpoint should use: find the record, compute
// its window, and roll it into a fresh cycle if that's due — all in one
// call, so no endpoint can act on a stale finalized record just because
// it skipped the roll step (which previously only get-annual-planning.js
// performed).
async function loadCurrentRecord(location, resident, service, now) {
  const page = await findRecord(location, resident, service);
  let record = recordFromPage(page);
  let windowState = computeAnnualPlanningWindow(record, now);

  if (record) {
    const rollResult = await rollToNextCycleIfWindowJustOpened({ location: location, resident: resident, record: record, windowState: windowState });
    if (rollResult.rolled) {
      record = rollResult.record;
      windowState = computeAnnualPlanningWindow(record, now);
    }
  }

  return { record: record, windowState: windowState };
}

async function createRecord(location, resident, service, effectiveDate, folderUrl) {
  const props = {
    'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + service } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Service': { select: { name: service } },
    'Active': { checkbox: true },
    'Effective Date': { date: { start: effectiveDate } }
  };
  if (folderUrl) props['Annual Planning Folder URL'] = { url: folderUrl };
  const page = await createPage(ANNUAL_PLANNING_DB_ID, props);
  return recordFromPage(page);
}

module.exports = {
  STEPS,
  SERVICES,
  DEFAULT_SERVICE,
  WINDOW_WEEKS_BEFORE_DUE,
  ANNUAL_PLANNING_DB_ID,
  computeDueDate,
  computeWindowOpenDate,
  computeFolderName,
  findRecord,
  findRecordsForResident,
  recordFromPage,
  computeAnnualPlanningWindow,
  rollToNextCycleIfWindowJustOpened,
  loadCurrentRecord,
  createRecord
};
