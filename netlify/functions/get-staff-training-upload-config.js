const { requireSession } = require('./lib/session');
const { staffInfoById, driveFolderIdFromUrl } = require('./lib/staff-training');

// Everything the browser needs to upload a document straight to Drive
// via Zapier — same "don't route file bytes through a Netlify function"
// pattern as get-annual-planning-upload-config.js. No folder name here:
// unlike Annual Planning there's no per-cycle dated subfolder, every
// document lands directly in the staff member's one ongoing folder.
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
    const staffId = params.staffId;
    if (!staffId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId is required.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const webhookUrl = process.env.ZAPIER_STAFF_TRAINING_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Document uploads are not configured yet.' }) };
    }
    if (!staff.trainingFolderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set up this staff member\'s Drive folder first.' }) };
    }

    const parentFolderId = driveFolderIdFromUrl(staff.trainingFolderUrl);
    if (!parentFolderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read a Drive folder ID from the stored folder link.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ webhookUrl: webhookUrl, parentFolderId: parentFolderId, staffName: staff.name, location: staff.location })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
