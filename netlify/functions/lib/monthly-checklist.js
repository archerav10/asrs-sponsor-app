const { queryDatabase, updatePage, createPage, getPlainText } = require('./notion');

const MONTHLY_CHECKLIST_DB_ID = process.env.MONTHLY_CHECKLIST_DB_ID;

// Fixed, code-level list — same convention as Quarterly Reporting's and
// Staff Training's STEPS arrays. Adding/removing an item means editing
// this array (and the matching Notion property), not a self-service
// admin UI: there's only one shared template for every location, so a
// code change here already applies everywhere at once.
//
// The 9 yes/no items are stored as a Notion select (Yes/No), not a
// checkbox — a checkbox can't distinguish "answered No" from "never
// answered yet," which finalizing needs to tell apart.
const ITEMS = [
  { key: 'LastSiteVisit', property: 'Last Site Visit', label: 'Last site visit', type: 'date' },
  { key: 'TherapNotesCompleted', property: 'Therap Notes Completed', label: 'Therap notes completed for visit', type: 'yesno' },
  { key: 'AdminMedicationReview', property: 'Admin Medication Review', label: 'Administrative medication review', type: 'yesno' },
  { key: 'TherapMarConfigCompleted', property: 'Therap MAR Config Completed', label: 'Therap monthly MAR configuration completed?', type: 'yesno' },
  { key: 'LicensingComplianceCheck', property: 'Licensing Compliance Check', label: 'Licensing compliance check completed', type: 'yesno' },
  { key: 'PhysicalEnvironmentWalkthrough', property: 'Physical Environment Walkthrough', label: 'Physical environment walk-thru?', type: 'yesno' },
  { key: 'RiskAssessmentReview', property: 'Risk Assessment Review', label: 'Risk Assessment Review', type: 'yesno' },
  { key: 'QualityImprovementReview', property: 'Quality Improvement Review', label: 'Quality Improvement Review', type: 'yesno' },
  { key: 'AppointmentNotesProcessed', property: 'Appointment Notes Processed', label: 'Appointment Notes Processed', type: 'yesno' },
  { key: 'ImprovementNotes', property: 'Improvement Notes', label: 'What are we getting better at this month?', type: 'text' },
  { key: 'NextPlannedSiteVisit', property: 'Next Planned Site Visit', label: 'Next planned site visit', type: 'date' }
];

function pad2(n) { return String(n).padStart(2, '0'); }

function periodToDate(period) {
  const parts = period.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
}

function dateToPeriod(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
}

// A period's due date is always the first of the NEXT month — "must be
// completed by the end of EACH month."
function dueDateForPeriod(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function recordFromPage(page) {
  if (!page) return null;
  const record = {
    id: page.id,
    period: getPlainText(page.properties['Period']),
    finalized: !!page.properties['Finalized'].checkbox,
    finalizedDate: getPlainText(page.properties['Finalized Date']),
    finalizedBy: getPlainText(page.properties['Finalized By']),
    fields: {}
  };
  ITEMS.forEach(function (item) {
    record.fields[item.key] = getPlainText(page.properties[item.property]);
  });
  return record;
}

async function findRecord(location, period) {
  const result = await queryDatabase(MONTHLY_CHECKLIST_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Period', rich_text: { equals: period } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return recordFromPage((result.results || [])[0]);
}

// Every row ever finalized for a location, most recent period first —
// used only to find the latest non-blank Last/Next Site Visit values
// for the provider app (a resident's checklist keeps going long after
// any one month's own record stops being "current").
async function findAllRecords(location) {
  const result = await queryDatabase(MONTHLY_CHECKLIST_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || [])
    .map(recordFromPage)
    .sort(function (a, b) { return b.period < a.period ? -1 : b.period > a.period ? 1 : 0; });
}

// The most recently reported "Last Site Visit" and "Next Planned Site
// Visit" values across every month on file — not necessarily from the
// same row, since a new month's own visit may not have happened yet
// even though its next-planned date was already set.
async function latestSiteVisitDates(location) {
  const records = await findAllRecords(location);
  let lastSiteVisit = null;
  let nextPlannedSiteVisit = null;
  records.forEach(function (record) {
    if (!lastSiteVisit && record.fields.LastSiteVisit) lastSiteVisit = record.fields.LastSiteVisit;
    if (!nextPlannedSiteVisit && record.fields.NextPlannedSiteVisit) nextPlannedSiteVisit = record.fields.NextPlannedSiteVisit;
  });
  return { lastSiteVisit: lastSiteVisit, nextPlannedSiteVisit: nextPlannedSiteVisit };
}

// Resolves which period a location is currently working on, and that
// period's record (or null if it hasn't been touched yet). Target is
// the EARLIEST month, from the earliest one this location has any
// record for through the current month, that isn't finalized — walked
// month by month rather than jumped to straight from the last
// finalized period, so a month that was started (or even never
// touched) but never finalized stays the target instead of quietly
// getting stepped over once the calendar moves past it. If nothing at
// all is on file yet, there's nothing to catch up on, so the target is
// just the current month.
//
// save/finalize below only ever accept writes to whatever this
// function currently resolves as the target, so a location can never
// finalize a later month while an earlier one is still open — that
// invariant is what keeps this walk safe to start from "the earliest
// record on file" rather than needing some separately-tracked epoch.
async function resolveTarget(location, now) {
  now = now || new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const all = await findAllRecords(location);

  if (!all.length) {
    return { targetPeriod: dateToPeriod(currentMonthStart), dueDate: dueDateForPeriod(currentMonthStart), record: null };
  }

  const byPeriod = {};
  all.forEach(function (r) { byPeriod[r.period] = r; });
  const ascending = all.slice().sort(function (a, b) { return a.period < b.period ? -1 : a.period > b.period ? 1 : 0; });

  let cursor = periodToDate(ascending[0].period);
  while (cursor < currentMonthStart) {
    const record = byPeriod[dateToPeriod(cursor)] || null;
    if (!record || !record.finalized) {
      return { targetPeriod: dateToPeriod(cursor), dueDate: dueDateForPeriod(cursor), record: record };
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // Every month through the one before this is finalized — target is
  // the current month itself, which may already be finalized too (the
  // "finished early, locked until next month" state).
  const record = byPeriod[dateToPeriod(currentMonthStart)] || null;
  return { targetPeriod: dateToPeriod(currentMonthStart), dueDate: dueDateForPeriod(currentMonthStart), record: record };
}

function fieldsToProps(fields) {
  const props = {};
  ITEMS.forEach(function (item) {
    const value = fields[item.key];
    if (value === undefined) return;
    if (item.type === 'date') {
      props[item.property] = { date: value ? { start: value } : null };
    } else if (item.type === 'yesno') {
      props[item.property] = { select: value ? { name: value } : null };
    } else {
      props[item.property] = { rich_text: value ? [{ text: { content: value } }] : [] };
    }
  });
  return props;
}

// Saves whatever's currently entered, complete or not — no validation,
// same as every other process's "Save Progress."
async function saveProgress(location, period, fields) {
  const existing = await findRecord(location, period);
  const props = fieldsToProps(fields);

  if (existing) {
    await updatePage(existing.id, props);
    return;
  }

  await createPage(MONTHLY_CHECKLIST_DB_ID, Object.assign({
    'Record Title': { title: [{ text: { content: location + ' - ' + period } }] },
    'Location': { select: { name: location } },
    'Period': { rich_text: [{ text: { content: period } }] },
    'Active': { checkbox: true },
    'Finalized': { checkbox: false }
  }, props));
}

// Every item must have a real value before finalizing — mirrors MAR
// Review's Finalize validation gate. Returns a list of the still-blank
// item labels (empty = ready to finalize).
function missingItems(record) {
  if (!record) return ITEMS.map(function (i) { return i.label; });
  return ITEMS.filter(function (item) { return !record.fields[item.key]; }).map(function (item) { return item.label; });
}

async function finalize(location, period, finalizedBy) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await findRecord(location, period);
  if (!existing) {
    const err = new Error('No checklist entry is on file for that period yet.');
    err.statusCode = 400;
    throw err;
  }

  await updatePage(existing.id, {
    'Finalized': { checkbox: true },
    'Finalized Date': { date: { start: today } },
    'Finalized By': { rich_text: [{ text: { content: finalizedBy } }] }
  });
}

module.exports = {
  ITEMS,
  resolveTarget,
  findRecord,
  findAllRecords,
  latestSiteVisitDates,
  saveProgress,
  missingItems,
  finalize
};
