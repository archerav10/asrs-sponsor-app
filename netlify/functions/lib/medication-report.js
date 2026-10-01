const { queryDatabase, getPlainText } = require('./notion');
const { findAllQuestionRows, facilityToday } = require('./daily-progress-notes');
const { fetchMedicationsRaw, medicationsInEffectOn, logsInRange } = require('./medication-administration');
const { buildMedicationReportPdf, daysInMonth } = require('./medication-report-pdf');

const MAR_DB_ID = process.env.MAR_DB_ID;
const WEBHOOK_URL = process.env.ZAPIER_MEDICATION_REPORT_WEBHOOK_URL;
const LOCATIONS = ['Longstreet', 'Mylan', 'Reigel', 'Janeway', 'BlossomView', 'Philray'];

function pad2(n) { return String(n).padStart(2, '0'); }
function sanitizeForFilename(s) { return (s || '').replace(/[^a-zA-Z0-9]+/g, ''); }

// Distinct resident initials with at least one non-Info medication on
// file at this location — same derivation every other scheduled check
// in this app uses (there's no independent resident registry); its own
// private copy here, matching the convention of mar-alert-check.js,
// mar-reminder-check.js, etc. rather than a new shared abstraction.
async function residentsForLocation(location) {
  const result = await queryDatabase(MAR_DB_ID, {
    and: [
      { property: 'Location', select: { equals: location } },
      { property: 'Active', checkbox: { equals: true } },
      { property: 'Medication Type', select: { does_not_equal: 'Info' } }
    ]
  });
  const seen = {};
  (result.results || []).forEach(function (page) {
    const resident = getPlainText(page.properties['Resident Initials']);
    if (resident) seen[resident] = true;
  });
  return Object.keys(seen).sort();
}

// Drive's resident folders are named by full name, not initials (same
// as the Daily Progress Note PDF pipeline) — sourced from that same
// resident's Daily Progress Notes template, since the MAR database has
// no full-name field of its own. A resident with medications but no DPN
// template at all has no full name on file anywhere in this app; falls
// back to initials so the upload still has SOMETHING to match a Drive
// folder name against, rather than failing outright.
async function residentFullNameFor(location, resident) {
  const rows = await findAllQuestionRows(location, resident);
  return (rows.length && rows[0].residentFullName) ? rows[0].residentFullName : resident;
}

// A report's date range must fall within a single calendar month — the
// grid's day-of-month columns and header (see medication-report-pdf.js)
// are built around one month's numbering, not a rolling window that
// could cross a month boundary. Returns the shared month label plus the
// first/last day-of-month to actually draw columns for, so a partial
// (ad hoc) range only shows the days it actually covers rather than a
// full 1-31 grid with the uncovered days misleadingly blank.
function resolveDateRange(startDate, endDate) {
  const startMonth = startDate.slice(0, 7);
  const endMonth = endDate.slice(0, 7);
  if (startMonth !== endMonth) {
    const err = new Error('Start and end date must be in the same month.');
    err.statusCode = 400;
    throw err;
  }
  if (endDate < startDate) {
    const err = new Error('End date must be on or after the start date.');
    err.statusCode = 400;
    throw err;
  }
  return { yearMonth: startMonth, startDay: Number(startDate.slice(8, 10)), endDay: Number(endDate.slice(8, 10)) };
}

// Builds this resident's data for [startDate, endDate]: a grid row per
// scheduled (Regular, Time-of-Day-set) medication/slot pair, each day in
// range resolved as not-applicable (medication wasn't in effect that
// day — see medicationsInEffectOn), missing (in effect, nothing
// logged), or the logged Status/Given By — plus every PRN dose in range
// as a flat list. One query for the whole range's logs, not one per day.
async function gatherMedicationReportData(location, resident, startDate, endDate) {
  const range = resolveDateRange(startDate, endDate);

  const allMeds = await fetchMedicationsRaw(location, resident);
  const regularMeds = allMeds.filter(function (m) { return m.medicationType === 'Regular' && m.timesOfDay.length; });
  const logs = await logsInRange(location, resident, startDate, endDate);

  const medicationRows = [];
  regularMeds.forEach(function (med) {
    med.timesOfDay.forEach(function (slot) {
      const cellsByDay = {};
      for (let day = range.startDay; day <= range.endDay; day++) {
        const date = range.yearMonth + '-' + pad2(day);
        if (!medicationsInEffectOn([med], date).length) {
          cellsByDay[day] = { status: 'not-applicable' };
          continue;
        }
        const log = logs.find(function (l) { return l.date === date && l.itemName === med.itemName && l.timeOfDay === slot; });
        cellsByDay[day] = log ? { status: log.status.toLowerCase(), givenBy: log.givenBy } : { status: 'missing' };
      }
      medicationRows.push({ itemName: med.itemName, dosage: med.dosage, slot: slot, cellsByDay: cellsByDay });
    });
  });
  medicationRows.sort(function (a, b) {
    return a.itemName !== b.itemName ? a.itemName.localeCompare(b.itemName) : a.slot.localeCompare(b.slot);
  });

  const prnLogs = logs
    .filter(function (l) { return l.timeOfDay === 'PRN'; })
    .sort(function (a, b) { return (a.date + a.loggedAt) < (b.date + b.loggedAt) ? -1 : 1; });

  const residentFullName = await residentFullNameFor(location, resident);

  return { medicationRows: medicationRows, prnLogs: prnLogs, residentFullName: residentFullName, range: range };
}

// Shared core both naming conventions below go through — gathers the
// range, renders the PDF, and hands it to the same Zapier Catch Hook ->
// Find/Create Folder -> Upload File pattern the Daily Progress Note
// PDFs already use, landing in that resident's flat "Medication
// Administration Records" Drive folder (no month subfolder — one file
// per report, already named with its own date range).
async function buildAndUploadReport(location, resident, startDate, endDate, filename) {
  if (!WEBHOOK_URL) {
    const err = new Error('ZAPIER_MEDICATION_REPORT_WEBHOOK_URL is not configured.');
    err.statusCode = 500;
    throw err;
  }

  const data = await gatherMedicationReportData(location, resident, startDate, endDate);
  const pdfBytes = await buildMedicationReportPdf({
    location: location,
    residentInitials: resident,
    residentFullName: data.residentFullName,
    yearMonth: data.range.yearMonth,
    startDay: data.range.startDay,
    endDay: data.range.endDay,
    medicationRows: data.medicationRows,
    prnLogs: data.prnLogs
  });

  const formData = new FormData();
  formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
  formData.append('location', location);
  formData.append('residentInitials', resident);
  formData.append('residentFullName', data.residentFullName);
  formData.append('yearMonth', data.range.yearMonth);
  formData.append('filename', filename);

  const uploadRes = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
  if (!uploadRes.ok) {
    throw new Error('Upload webhook returned ' + uploadRes.status);
  }

  return { filename: filename };
}

// The automatic monthly report — always a full calendar month, filename
// prefixed by that month so it sorts chronologically in Drive
// alongside every other month's report for that resident.
async function generateScheduledMedicationReport(location, resident, yearMonth) {
  const startDate = yearMonth + '-01';
  const endDate = yearMonth + '-' + pad2(daysInMonth(yearMonth));
  const filename = yearMonth + '_MedicationReport_' + sanitizeForFilename(location) + '_' + sanitizeForFilename(resident) + '.pdf';
  return buildAndUploadReport(location, resident, startDate, endDate, filename);
}

// The on-demand admin report — any range an admin picks, which may be a
// partial month (e.g. a resident discharged mid-month, or spot-checking
// before the month is over). Named distinctly from the scheduled
// report's convention, and always carries its own exact date range in
// the filename, since it's never safe to assume it covers a full month.
async function generateAdhocMedicationReport(location, resident, startDate, endDate) {
  const filename = 'Adhoc_MedicationReport_' + sanitizeForFilename(location) + '_' + sanitizeForFilename(resident) + '_' + startDate + '_to_' + endDate + '.pdf';
  return buildAndUploadReport(location, resident, startDate, endDate, filename);
}

function previousYearMonth(today) {
  const parts = today.slice(0, 7).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

// Every location/resident, the previous calendar month, always — run on
// the 3rd (see netlify.toml) rather than the 1st, giving Give
// Medications' 14-day catch-up window a couple of days' room to close
// out the month before it's treated as final. Failures are collected
// per resident rather than aborting the whole run, same as
// generate-daily-progress-note-pdfs.js's own loop.
async function generateAllMedicationReportsForPreviousMonth(now) {
  const today = facilityToday(now);
  const yearMonth = previousYearMonth(today);
  const results = [];
  for (const location of LOCATIONS) {
    const residents = await residentsForLocation(location);
    for (const resident of residents) {
      try {
        const result = await generateScheduledMedicationReport(location, resident, yearMonth);
        results.push({ location: location, resident: resident, yearMonth: yearMonth, success: true, filename: result.filename });
      } catch (err) {
        results.push({ location: location, resident: resident, yearMonth: yearMonth, success: false, error: err.message });
      }
    }
  }
  return { yearMonth: yearMonth, results: results };
}

module.exports = {
  residentsForLocation,
  residentFullNameFor,
  resolveDateRange,
  gatherMedicationReportData,
  generateScheduledMedicationReport,
  generateAdhocMedicationReport,
  previousYearMonth,
  generateAllMedicationReportsForPreviousMonth
};
