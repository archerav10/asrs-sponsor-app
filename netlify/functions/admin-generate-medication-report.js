const { requireSuperAdmin } = require('./lib/super-admin-session');
const { generateAdhocMedicationReport } = require('./lib/medication-report');

// On-demand counterpart to the scheduled generate-medication-reports.js —
// lets an admin generate any resident's report for an arbitrary date
// range immediately (printing on request, spot-checking before the
// automatic run reaches it, or a partial-month range a resident's
// situation calls for — e.g. discharged mid-month). Always uploaded
// under the "Adhoc" filename convention (see generateAdhocMedicationReport),
// distinct from the scheduled report's month-prefixed one, since an
// on-demand report is never safe to assume covers a full month.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    requireSuperAdmin(event);

    const body = JSON.parse(event.body || '{}');
    const location = body.location;
    const resident = body.resident;
    const startDate = body.startDate; // "YYYY-MM-DD"
    const endDate = body.endDate; // "YYYY-MM-DD"

    if (!location || !resident || !/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, a start date, and an end date (YYYY-MM-DD) are required.' }) };
    }

    const result = await generateAdhocMedicationReport(location, resident, startDate, endDate);
    return { statusCode: 200, body: JSON.stringify({ success: true, filename: result.filename }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
