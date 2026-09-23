const { queryDatabase, updatePage, createPage, getPlainText, driveFolderIdFromUrl } = require('./notion');
const { DEFAULT_SERVICE, findRecord, computeFolderName, oneYearLater } = require('./annual-planning');

const QUARTERLY_REPORTING_DB_ID = process.env.QUARTERLY_REPORTING_DB_ID;

// Tied entirely to Annual Planning — no independent effective date, no
// separate Drive folder link, no finalize step. Every quarter's window
// opens the instant the quarter before it ends (no lead time the way
// Staff Training/Annual Planning have — "opens up at the end of each
// quarterly period," per spec), and reports land inside a fixed
// "Quarterly Report" subfolder nested inside that cycle's existing
// dated Annual Planning folder.
const STEPS = [
  { key: 'QuarterlyProgressReport', label: 'Quarterly Progress Report' },
  { key: 'ClientSatisfactionInterview', label: 'Client Satisfaction Interview' },
  { key: 'ComprehensiveReAssessment', label: 'Comprehensive Re-Assessment' },
  { key: 'PersonCenteredAssessment', label: 'Person Centered Assessment' }
];
const STEP_KEYS = STEPS.map(function (s) { return s.key; });

const QUARTERLY_REPORT_SUBFOLDER_NAME = 'Quarterly Report';

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

function addMonthsISO(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  return isoDate(new Date(d.getFullYear(), d.getMonth() + months, d.getDate()));
}

function subtractDayISO(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

// Four 3-month quarters spanning the same year an Annual Planning cycle
// covers, anchored to that SAME effective date (never a separately-set
// one). Quarter due date = the day the *next* quarter begins — i.e. the
// window opens the instant the quarter itself ends, no lead time.
function computeQuarters(effectiveDate) {
  const starts = [
    effectiveDate,
    addMonthsISO(effectiveDate, 3),
    addMonthsISO(effectiveDate, 6),
    addMonthsISO(effectiveDate, 9),
    oneYearLater(effectiveDate)
  ];
  const quarters = [];
  for (let i = 0; i < 4; i++) {
    quarters.push({
      index: i + 1,
      start: starts[i],
      end: subtractDayISO(starts[i + 1]),
      dueDate: starts[i + 1]
    });
  }
  return quarters;
}

function itemFromPage(page) {
  return {
    id: page.id,
    stepKey: getPlainText(page.properties['Step Key']),
    done: !!page.properties['Done'].checkbox,
    filename: getPlainText(page.properties['Filename'])
  };
}

async function itemsForQuarter(location, resident, service, quarterStart) {
  const result = await queryDatabase(QUARTERLY_REPORTING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Service', select: { equals: service } },
      { property: 'Quarter Start Date', date: { equals: quarterStart } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || []).map(itemFromPage);
}

function fullStepList(items) {
  const byKey = {};
  items.forEach(function (i) { byKey[i.stepKey] = i; });
  return STEPS.map(function (step) {
    const item = byKey[step.key];
    return {
      key: step.key,
      label: step.label,
      done: item ? item.done : false,
      filename: item ? item.filename : ''
    };
  });
}

// The full picture for one resident/service: every quarter of the
// resident's ACTUAL stored Annual Planning cycle, each with its own
// open/locked state and 4 report items.
//
// Deliberately anchors on record.effectiveDate directly rather than
// computeAnnualPlanningWindow's targetEffectiveDate — that function
// intentionally projects forward to the NEXT cycle's effective date up
// to 6 weeks before the record physically rolls (so Annual Planning's
// own UI can unlock early), but the record itself, and therefore the
// REAL calendar quarters, doesn't move until someone actually visits
// that resident's Annual Planning detail screen and
// rollToNextCycleIfWindowJustOpened fires. Anchoring on the projected
// target here would make whichever quarter is genuinely open right
// now (from the cycle still on file) silently disappear for that same
// ~6-week stretch every year, with no way to complete it until the
// roll happens.
async function computeQuarterlyReportingForRecord(location, resident, service, record, now) {
  now = now || new Date();
  if (!record || !record.effectiveDate) {
    return { hasCycle: false, targetEffectiveDate: null, quarters: [] };
  }

  const quarters = computeQuarters(record.effectiveDate);
  const withItems = await Promise.all(quarters.map(async function (q) {
    const items = await itemsForQuarter(location, resident, service, q.start);
    const steps = fullStepList(items);
    const missingCount = steps.filter(function (s) { return !s.done; }).length;
    return Object.assign({}, q, {
      isOpen: now >= new Date(q.dueDate + 'T00:00:00'),
      steps: steps,
      missingCount: missingCount
    });
  }));

  return { hasCycle: true, targetEffectiveDate: record.effectiveDate, quarters: withItems };
}

// The one quarter driving the puzzle's yellow/spinning state and the
// "next due" date shown on a button: the earliest OPEN quarter that
// isn't fully done yet. null means nothing's currently actionable —
// either no quarter has opened yet this cycle, or every open quarter is
// already complete (locked/gray either way, just for different reasons;
// callers that care which can check quarters[0].isOpen).
function activeQuarter(quarters) {
  const open = quarters.filter(function (q) { return q.isOpen && q.missingCount > 0; });
  if (!open.length) return null;
  return open.reduce(function (a, b) { return a.index < b.index ? a : b; });
}

// Finds-or-creates the row for (location, resident, service, quarterStart,
// stepKey) and marks it done. Callers are expected to have already
// checked the quarter is open — see save-quarterly-reporting-step.js.
async function markQuarterlyStepDone(location, resident, service, quarterStart, stepKey, filename, updatedBy) {
  const result = await queryDatabase(QUARTERLY_REPORTING_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Service', select: { equals: service } },
      { property: 'Quarter Start Date', date: { equals: quarterStart } },
      { property: 'Step Key', select: { equals: stepKey } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  const existing = (result.results || [])[0];
  const today = new Date().toISOString().slice(0, 10);
  const props = {
    'Done': { checkbox: true },
    'Filename': { rich_text: filename ? [{ text: { content: filename } }] : [] },
    'Last Updated By': { rich_text: [{ text: { content: updatedBy } }] },
    'Last Updated Date': { date: { start: today } }
  };

  if (existing) {
    await updatePage(existing.id, props);
    return;
  }

  await createPage(QUARTERLY_REPORTING_DB_ID, Object.assign({
    'Record Title': { title: [{ text: { content: location + ' - ' + resident + ' - ' + service + ' - ' + quarterStart + ' - ' + stepKey } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Service': { select: { name: service } },
    'Quarter Start Date': { date: { start: quarterStart } },
    'Step Key': { select: { name: stepKey } },
    'Active': { checkbox: true }
  }, props));
}

module.exports = {
  STEPS,
  STEP_KEYS,
  DEFAULT_SERVICE,
  QUARTERLY_REPORT_SUBFOLDER_NAME,
  computeQuarters,
  computeFolderName,
  findRecord,
  itemsForQuarter,
  fullStepList,
  computeQuarterlyReportingForRecord,
  activeQuarter,
  markQuarterlyStepDone,
  driveFolderIdFromUrl
};
