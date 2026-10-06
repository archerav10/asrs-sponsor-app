const { generateAllMedicationReportsForPreviousMonth } = require('./lib/medication-report');

// Scheduled (see netlify.toml) — fires once, on the 3rd of every month.
// Generates and uploads every location/resident's Medication
// Administration Report PDF for the month that just ended, to Google
// Drive (same Zapier pipeline as the Daily Progress Note PDFs). Running
// on the 3rd rather than the 1st gives the previous month's Give
// Medications catch-up window (14 days) a couple of days' room to close
// out before the month is treated as final.
exports.handler = async function () {
  const outcome = await generateAllMedicationReportsForPreviousMonth();
  const failures = outcome.results.filter(function (r) { return !r.success; });
  if (failures.length) {
    console.error('Medication report generation failures for ' + outcome.yearMonth, failures);
  }
  return { statusCode: 200, body: JSON.stringify(outcome) };
};
