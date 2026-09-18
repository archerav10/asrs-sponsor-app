const { queryDatabase, updatePage, createPage, getPlainText } = require('./notion');
const { computeMarTarget } = require('./mar-period');

const MAR_PERIODS_DB_ID = process.env.MAR_PERIODS_DB_ID;

// How many days before the due date the submission window opens. A named
// constant (not inlined at each call site) since due-date itself is also
// expected to change later ("before end of month" instead of "end of
// month") — when that happens, only computeMarWindow needs to change.
const WINDOW_DAYS_BEFORE_DUE = 7;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// The full "where do things stand right now" picture for a period, built
// on top of computeMarTarget: which period is being targeted, when it's
// due, and when the submission window for it opens. Single source of
// truth for get-mar-review, confirm-mar-review, and finalize-mar-review.
function computeMarWindow(lastFinalizedPeriod, now) {
  now = now || new Date();
  const { targetPeriod, dueDate } = computeMarTarget(lastFinalizedPeriod, now);
  const windowOpenDate = addDays(dueDate, -WINDOW_DAYS_BEFORE_DUE);
  return {
    targetPeriod: targetPeriod,
    dueDate: dueDate,
    windowOpenDate: windowOpenDate,
    isWindowOpen: now >= windowOpenDate
  };
}

async function findPeriodPage(location, resident) {
  const result = await queryDatabase(MAR_PERIODS_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } }
    ]
  });
  return (result.results || [])[0] || null;
}

// If the submission window for the current target period has opened and
// the medication rows still hold the PRIOR period's working data (tracked
// via "Last Wiped Period" on the tracker page, compared against the
// current target), blank them out — Missing, Current Exp Date, Quantity,
// and the delivery date. This is the single place that owns "should this
// period's data still be here," so get-mar-review, confirm-mar-review,
// and finalize-mar-review don't each reimplement the staleness check.
//
// medicationIds should be the ACTUAL medication rows only (not Allergy
// Info / General Notes / Medication Delivery Date, which have their own
// lifecycle and aren't part of "the current period's working data").
async function wipeIfWindowJustOpened(options) {
  const location = options.location;
  const resident = options.resident;
  const periodPage = options.periodPage;
  const medicationIds = options.medicationIds || [];
  const deliveryDateId = options.deliveryDateId;
  const windowState = options.windowState;

  const lastWipedPeriod = periodPage ? getPlainText(periodPage.properties['Last Wiped Period']) : null;
  if (!windowState.isWindowOpen || lastWipedPeriod === windowState.targetPeriod) {
    return { wiped: false, periodPage: periodPage };
  }

  for (const id of medicationIds) {
    await updatePage(id, {
      'Missing': { checkbox: false },
      'Current Exp Date': { date: null },
      'Quantity': { rich_text: [] }
    });
  }
  if (deliveryDateId) {
    await updatePage(deliveryDateId, { 'Date Delivered': { date: null } });
  }

  const wipeProps = { 'Last Wiped Period': { rich_text: [{ text: { content: windowState.targetPeriod } }] } };
  let updatedPage = periodPage;
  if (periodPage) {
    updatedPage = await updatePage(periodPage.id, wipeProps);
  } else {
    updatedPage = await createPage(MAR_PERIODS_DB_ID, Object.assign({
      'Period Title': { title: [{ text: { content: location + ' - ' + resident } }] },
      'Location': { select: { name: location } },
      'Resident Initials': { rich_text: [{ text: { content: resident } }] },
      'Active': { checkbox: true }
    }, wipeProps));
  }

  return { wiped: true, periodPage: updatedPage };
}

module.exports = { computeMarWindow, findPeriodPage, wipeIfWindowJustOpened, WINDOW_DAYS_BEFORE_DUE, MAR_PERIODS_DB_ID: MAR_PERIODS_DB_ID };
