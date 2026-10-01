const { requireSuperAdmin } = require('./lib/super-admin-session');
const { generateAndUploadMedicationReport } = require('./lib/medication-report');

// On-demand counterpart to the scheduled generate-medication-reports.js —
// lets an admin generate (or re-generate) any resident/month's report
// immediately, e.g. to print on request or spot-check a month before
// the automatic run on the 3rd picks it up.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const body = JSON.parse(event.body || '{}');
    const location = body.location;
    const resident = body.resident;
    const yearMonth = body.yearMonth; // "YYYY-MM"

    if (!location || !resident || !/^\d{4}-\d{2}$/.test(yearMonth || '')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, and a year-month (YYYY-MM) are required.' }) };
    }

    const result = await generateAndUploadMedicationReport(location, resident, yearMonth);
    return { statusCode: 200, body: JSON.stringify({ success: true, filename: result.filename }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
