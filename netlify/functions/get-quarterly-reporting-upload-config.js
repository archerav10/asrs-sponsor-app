const { requireSession } = require('./lib/session');
const { findRecord, computeFolderName, QUARTERLY_REPORT_SUBFOLDER_NAME, driveFolderIdFromUrl } = require('./lib/quarterly-reporting');

// Reports nest two folders deep inside the resident's EXISTING Annual
// Planning folder — no separate one-time folder link for this process.
// The Zap needs both folder names to Find/Create its way down:
// AnnualPlanningFolder -> {cycleFolderName, e.g. "20261101-20271031"}
// -> "Quarterly Report" -> the uploaded file.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const params = event.queryStringParameters || {};
    const location = params.location;
    const resident = params.resident;
    const service = params.service;
    if (!location || !resident || !service) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, resident, and service are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const webhookUrl = process.env.ZAPIER_QUARTERLY_REPORTING_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ZAPIER_QUARTERLY_REPORTING_WEBHOOK_URL is not configured.' }) };
    }

    const record = await findRecord(location, resident, service);
    if (!record || !record.folderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This resident/service has no Annual Planning Drive folder set up yet.' }) };
    }

    const parentFolderId = driveFolderIdFromUrl(record.folderUrl);
    if (!parentFolderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read a Drive folder ID from the Annual Planning folder link.' }) };
    }

    // The record's actual stored effective date, not a projected future
    // one — see the comment on computeQuarterlyReportingForRecord in
    // lib/quarterly-reporting.js for why that distinction matters. This
    // has to match the SAME dated folder Annual Planning's own Zap
    // already created, not a not-yet-existing next cycle's.
    const cycleFolderName = computeFolderName(record.effectiveDate);

    return {
      statusCode: 200,
      body: JSON.stringify({
        webhookUrl: webhookUrl,
        parentFolderId: parentFolderId,
        cycleFolderName: cycleFolderName,
        subfolderName: QUARTERLY_REPORT_SUBFOLDER_NAME
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
