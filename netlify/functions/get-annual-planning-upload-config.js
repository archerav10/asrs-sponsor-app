const { requireSession } = require('./lib/session');
const { loadCurrentRecord, computeFolderName } = require('./lib/annual-planning');

function driveFolderIdFromUrl(url) {
  const match = (url || '').match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

// Everything the browser needs to upload a document straight to Drive via
// Zapier, same "don't route file bytes through a Netlify function"
// pattern as get-event-upload-config.js. The Zap's "Find a Folder (or
// Create it)" step is idempotent, so every document for the same cycle
// resolves to the same folder without this app ever needing to learn a
// folder ID back from Zapier.
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
    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location and resident are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const webhookUrl = process.env.ZAPIER_ANNUAL_PLANNING_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Document uploads are not configured yet.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(location, resident);

    if (!record || !record.folderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set up this resident\'s Annual Planning folder first.' }) };
    }
    if (!windowState.isWindowOpen) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This cycle isn\'t open yet.' }) };
    }

    const parentFolderId = driveFolderIdFromUrl(record.folderUrl);
    if (!parentFolderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read a Drive folder ID from the stored folder link.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        webhookUrl: webhookUrl,
        parentFolderId: parentFolderId,
        folderName: computeFolderName(windowState.targetEffectiveDate),
        effectiveDate: windowState.targetEffectiveDate
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
