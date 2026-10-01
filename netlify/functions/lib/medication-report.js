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

// Builds this resident's full-month data: a grid row per scheduled
// (Regular, Time-of-Day-set) medication/slot pair, each day resolved as
// not-applicable (medication wasn't in effect that day — see
// medicationsInEffectOn), missing (in effect, nothing logged), or the
// logged Status/Given By — plus every PRN dose in the month as a flat
// list. One query for the whole month's logs, not one per day.
async function gatherMedicationReportData(location, resident, yearMonth) {
  const total = daysInMonth(yearMonth);
  const monthStart = yearMonth + '-01';
  const monthEnd = yearMonth + '-' + pad2(total);

  const allMeds = await fetchMedicationsRaw(location, resident);
  const regularMeds = allMeds.filter(function (m) { return m.medicationType === 'Regular' && m.timesOfDay.length; });
  const logs = await logsInRange(location, resident, monthStart, monthEnd);

  const medicationRows = [];
  regularMeds.forEach(function (med) {
    med.timesOfDay.forEach(function (slot) {
      const cellsByDay = {};
      for (let day = 1; day <= total; day++) {
        const date = yearMonth + '-' + pad2(day);
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

  return { medicationRows: medicationRows, prnLogs: prnLogs, residentFullName: residentFullName };
}

// The single entry point both the scheduled monthly job and the
// on-demand admin button go through — gathers this resident's month,
// renders the PDF, and hands it to the same Zapier Catch Hook -> Find/
// Create Folder -> Upload File pattern the Daily Progress Note PDFs
// already use, landing in a sibling "Medication Administration Reports"
// Drive folder.
async function generateAndUploadMedicationReport(location, resident, yearMonth) {
  if (!WEBHOOK_URL) {
    const err = new Error('ZAPIER_MEDICATION_REPORT_WEBHOOK_URL is not configured.');
    err.statusCode = 500;
    throw err;
  }

  const data = await gatherMedicationReportData(location, resident, yearMonth);
  const pdfBytes = await buildMedicationReportPdf({
    location: location,
    residentInitials: resident,
    residentFullName: data.residentFullName,
    yearMonth: yearMonth,
    medicationRows: data.medicationRows,
    prnLogs: data.prnLogs
  });

  const filename = 'MedicationReport_' + sanitizeForFilename(location) + '_' + sanitizeForFilename(resident) + '_' + yearMonth + '.pdf';

  const formData = new FormData();
  formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);
  formData.append('location', location);
  formData.append('residentInitials', resident);
  formData.append('residentFullName', data.residentFullName);
  formData.append('yearMonth', yearMonth);
  formData.append('filename', filename);

  const uploadRes = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
  if (!uploadRes.ok) {
    throw new Error('Upload webhook returned ' + uploadRes.status);
  }

  return { filename: filename };
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
        const result = await generateAndUploadMedicationReport(location, resident, yearMonth);
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
  gatherMedicationReportData,
  generateAndUploadMedicationReport,
  previousYearMonth,
  generateAllMedicationReportsForPreviousMonth
};
