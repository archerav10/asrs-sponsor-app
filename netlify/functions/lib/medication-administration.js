const { queryDatabase, createPage, getPlainText } = require('./notion');
const { findQuestionsForDate, isoDate, addDaysISO } = require('./daily-progress-notes');

const MAR_DB_ID = process.env.MAR_DB_ID;
const LOG_DB_ID = process.env.MEDICATION_ADMIN_LOG_DB_ID;

const TIME_SLOTS = ['AM', 'Noon', 'Afternoon', 'PM'];

// How far back a resident whose doses can't be skipped (see
// requiresStrictOrder below) is ever asked to catch up — bounds the
// window query below to a fixed size instead of walking this resident's
// entire history, which would only grow more expensive the longer this
// feature's been in use. Two weeks is generous slack for catching up a
// missed entry without turning this into an open-ended backlog.
const LOOKBACK_DAYS = 14;

function getMultiSelect(prop) {
  return prop && prop.multi_select ? prop.multi_select.map(function (o) { return o.name; }) : [];
}

// Every active medication row on file for this resident — Regular and
// PRN both included (Info rows, like Allergy Info/General Notes, are
// never relevant here and are filtered out) — UNFILTERED by Effective/
// Termination Date, so callers can slice the same fetch by date
// themselves (medicationsInEffectOn) without re-querying Notion per day.
async function fetchMedicationsRaw(location, resident) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  return (result.results || []).map(function (page) {
    return {
      id: page.id,
      itemName: getPlainText(page.properties['Item Name']),
      dosage: getPlainText(page.properties['Dosage']),
      medicationType: getPlainText(page.properties['Medication Type']), // Regular | PRN
      timesOfDay: getMultiSelect(page.properties['Times of Day']),
      effectiveDate: getPlainText(page.properties['Effective Date']),
      terminationDate: getPlainText(page.properties['Termination Date'])
    };
  }).sort(function (a, b) { return a.itemName.localeCompare(b.itemName); });
}

// Which of an already-fetched set of medication rows actually applied on
// a given date — a half-open [Effective Date, Termination Date) window,
// same convention as Daily Progress Notes' own template versioning. A
// blank Effective Date means "has always applied" (no backfill needed
// for rows entered before this field existed); a blank Termination Date
// means "still applies." This is what lets a medication change mid-month
// show the OLD medication's schedule on days before the switch and the
// NEW one from the switch day forward, instead of today's medication
// list being silently applied to every day in the lookback window.
function medicationsInEffectOn(allMeds, date) {
  return allMeds.filter(function (m) {
    if (m.effectiveDate && m.effectiveDate > date) return false;
    if (m.terminationDate && date >= m.terminationDate) return false;
    return true;
  });
}

// Convenience wrapper for a single date — used by the dose-logging
// endpoints, which only ever need one date's answer, not a whole
// lookback window's worth (resolveMedicationDayOptions below does its
// own single fetchMedicationsRaw + per-day filtering instead of calling
// this in a loop, to avoid re-querying Notion once per day).
async function medicationsForResidentOnDate(location, resident, date) {
  const all = await fetchMedicationsRaw(location, resident);
  return medicationsInEffectOn(all, date);
}

// Every (medication, slot) pair a complete day needs a log entry for —
// PRN meds never appear here, since there's no scheduled expectation to
// resolve for an as-needed dose. A Regular medication with no Times of
// Day set yet (admin hasn't filled it in) contributes nothing either,
// rather than silently blocking on a slot nobody configured.
function expectedSlotsForMedications(regularMeds) {
  const slots = [];
  regularMeds.forEach(function (med) {
    med.timesOfDay.forEach(function (slot) {
      slots.push({ medicationId: med.id, itemName: med.itemName, dosage: med.dosage, slot: slot });
    });
  });
  return slots;
}

function logFromPage(page) {
  return {
    id: page.id,
    date: getPlainText(page.properties['Date']),
    timeOfDay: getPlainText(page.properties['Time of Day']),
    itemName: getPlainText(page.properties['Item Name']),
    dosage: getPlainText(page.properties['Dosage']),
    status: getPlainText(page.properties['Status']),
    reason: getPlainText(page.properties['Reason']),
    givenBy: getPlainText(page.properties['Given By']),
    loggedAt: getPlainText(page.properties['Logged At'])
  };
}

// Every log entry in [fromDate, toDate] (inclusive) for this resident —
// one query covering the whole window rather than one per day.
async function logsInRange(location, resident, fromDate, toDate) {
  const result = await queryDatabase(LOG_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Resident Initials', rich_text: { equals: resident } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Date', date: { on_or_after: fromDate } },
      { property: 'Date', date: { on_or_before: toDate } }
    ]
  });
  return (result.results || []).map(logFromPage);
}

function logsForDate(allLogs, date) {
  return allLogs.filter(function (l) { return l.date === date; });
}

function isSlotLogged(logsForDay, itemName, slot) {
  return logsForDay.some(function (l) { return l.itemName === itemName && l.timeOfDay === slot; });
}

// A day is "complete" once every expected (medication, slot) pair has
// SOME log entry — Given, Refused, or Held are all valid resolutions,
// the same way a Missing medication is exempt from MAR Review's
// expiration check rather than treated as unresolved. No expected slots
// at all (no active Regular medications with Times of Day set) counts
// as complete — nothing required, nothing outstanding.
function isDayComplete(expectedSlots, logsForDay) {
  return expectedSlots.every(function (es) { return isSlotLogged(logsForDay, es.itemName, es.slot); });
}

// Whether this resident's medication log enforces "can't skip a day" —
// tied to their current Daily Progress Notes template's Times Covered
// Editable flag: a fixed-window template (one caregiver covering the
// whole day) means Give Medications must be completed day by day, same
// as Daily Progress Notes already is; an editable-window template
// (multiple caregivers splitting shifts within a day) is exempted, since
// forcing a single-threaded "finish yesterday before touching today"
// gate across different people's shifts isn't realistic. A resident with
// no Daily Progress Notes template on file at all defaults to flexible
// (no gate) — there's no signal either way, and blocking a brand-new
// feature on a template that doesn't exist would only get in the way.
async function requiresStrictOrder(location, resident, today) {
  const questions = await findQuestionsForDate(location, resident, today);
  if (!questions.length) return false;
  return !questions[0].timesCoveredEditable;
}

// Splits an already-fetched raw medication list into what applied on one
// specific date: Regular vs. PRN, plus that date's own expected slots —
// a medication that was discontinued or hadn't started yet on that date
// simply doesn't appear, so a day's completeness is judged against what
// was ACTUALLY prescribed that day, not whatever's prescribed today.
function medicationsForDate(allMeds, date) {
  const meds = medicationsInEffectOn(allMeds, date);
  const regularMeds = meds.filter(function (m) { return m.medicationType === 'Regular'; });
  const prnMeds = meds.filter(function (m) { return m.medicationType === 'PRN'; });
  return { regularMeds: regularMeds, prnMeds: prnMeds, expectedSlots: expectedSlotsForMedications(regularMeds) };
}

// The single entry point get/save-medication-dose.js both go through to
// resolve which date(s) are currently valid to act on, mirroring
// resolveDayOptions in daily-progress-notes.js:
//   - strict:false (flexible, or no DPN template on file) -> always just
//     today; no backlog, nothing to catch up on.
//   - strict:true -> every day in the last LOOKBACK_DAYS that isn't yet
//     complete, oldest first (today always included even if complete,
//     so there's still something to show/re-view).
// medicationsByDate holds each walked day's OWN medication list (see
// medicationsForDate) — not one list reused across every day — so a
// medication change mid-window is reflected correctly on each side of
// the change.
async function resolveMedicationDayOptions(location, resident, now) {
  now = now || new Date();
  const today = isoDate(now);
  const strict = await requiresStrictOrder(location, resident, today);
  const allMeds = await fetchMedicationsRaw(location, resident);

  if (!strict) {
    const todaysLogs = await logsInRange(location, resident, today, today);
    const logsByDate = {};
    logsByDate[today] = todaysLogs;
    const medicationsByDate = {};
    medicationsByDate[today] = medicationsForDate(allMeds, today);
    return {
      strict: false,
      today: today,
      outstandingDates: [today],
      medicationsByDate: medicationsByDate,
      logsByDate: logsByDate
    };
  }

  const windowFloor = addDaysISO(today, -(LOOKBACK_DAYS - 1));
  const allLogs = await logsInRange(location, resident, windowFloor, today);
  const earliestLogged = allLogs.reduce(function (min, l) { return !min || l.date < min ? l.date : min; }, null);
  const walkStart = earliestLogged && earliestLogged > windowFloor ? earliestLogged : windowFloor;

  const logsByDate = {};
  const medicationsByDate = {};
  const days = [];
  let cursor = walkStart;
  while (cursor <= today) {
    const dayLogs = logsForDate(allLogs, cursor);
    const dayMeds = medicationsForDate(allMeds, cursor);
    logsByDate[cursor] = dayLogs;
    medicationsByDate[cursor] = dayMeds;
    days.push({ date: cursor, complete: isDayComplete(dayMeds.expectedSlots, dayLogs) });
    cursor = addDaysISO(cursor, 1);
  }

  let outstandingDates = days.filter(function (d) { return !d.complete; }).map(function (d) { return d.date; });
  if (!outstandingDates.length) outstandingDates = [today];

  return {
    strict: true,
    today: today,
    outstandingDates: outstandingDates,
    medicationsByDate: medicationsByDate,
    logsByDate: logsByDate
  };
}

// Logs one scheduled (Regular) medication's dose for a given date/slot.
// Rejects a slot that's already logged outright (append-only — a
// mis-logged entry is corrected directly in Notion, same "known gap"
// tradeoff as other soft-delete-only data in this app) rather than
// silently overwriting it.
async function logScheduledDose(location, resident, date, medication, slot, status, reason, givenBy) {
  const recordTitle = location + ' - ' + resident + ' - ' + date + ' - ' + slot + ' - ' + medication.itemName;
  await createPage(LOG_DB_ID, {
    'Record Title': { title: [{ text: { content: recordTitle } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Date': { date: { start: date } },
    'Time of Day': { select: { name: slot } },
    'Item Name': { rich_text: [{ text: { content: medication.itemName } }] },
    'Dosage': { rich_text: [{ text: { content: medication.dosage || '' } }] },
    'Status': { select: { name: status } },
    'Reason': { rich_text: [{ text: { content: reason || '' } }] },
    'Given By': { rich_text: [{ text: { content: givenBy || '' } }] },
    'Logged At': { date: { start: new Date().toISOString() } },
    'Active': { checkbox: true }
  });
}

// Logs an as-needed (PRN) dose — always "now," always Status Given
// (there's no scheduled expectation to mark Refused/Held against), and
// always Slot "PRN" rather than one of the four fixed times.
async function logPrnDose(location, resident, medication, reason, givenBy) {
  const today = isoDate(new Date());
  const recordTitle = location + ' - ' + resident + ' - ' + today + ' - PRN - ' + medication.itemName;
  await createPage(LOG_DB_ID, {
    'Record Title': { title: [{ text: { content: recordTitle } }] },
    'Location': { select: { name: location } },
    'Resident Initials': { rich_text: [{ text: { content: resident } }] },
    'Date': { date: { start: today } },
    'Time of Day': { select: { name: 'PRN' } },
    'Item Name': { rich_text: [{ text: { content: medication.itemName } }] },
    'Dosage': { rich_text: [{ text: { content: medication.dosage || '' } }] },
    'Status': { select: { name: 'Given' } },
    'Reason': { rich_text: [{ text: { content: reason || '' } }] },
    'Given By': { rich_text: [{ text: { content: givenBy || '' } }] },
    'Logged At': { date: { start: new Date().toISOString() } },
    'Active': { checkbox: true }
  });
}

module.exports = {
  TIME_SLOTS,
  fetchMedicationsRaw,
  medicationsInEffectOn,
  medicationsForResidentOnDate,
  expectedSlotsForMedications,
  logsInRange,
  logsForDate,
  isSlotLogged,
  isDayComplete,
  requiresStrictOrder,
  resolveMedicationDayOptions,
  logScheduledDose,
  logPrnDose,
  isoDate,
  addDaysISO
};
