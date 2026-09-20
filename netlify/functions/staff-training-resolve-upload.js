const { parseFilename, staffInfoById, driveFolderIdFromUrl } = require('./lib/staff-training');

// Called by the reusable "any form template" Zap for this process —
// same shape as annual-planning-resolve-upload.js. A form's own native
// Google Drive integration drops the completed submission's PDF into a
// shared staging folder, with no other way for the Zap to know which
// staff member/step/expiration it's for — so this endpoint tells it,
// parsed entirely from the filename this app built when "Complete Form"
// was opened. No folder name to compute here (unlike Annual Planning) —
// every document goes straight into the staff member's one ongoing
// folder, no dated subfolder.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.ANNUAL_PLANNING_FORM_WEBHOOK_SECRET; // shared across admin-dashboard Zapier-facing endpoints
    if (!secret || body.secret !== secret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
    }

    const parsed = parseFilename(body.filename);
    if (!parsed) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not parse a staff/step/expiration from that filename.' }) };
    }

    const staff = await staffInfoById(parsed.staffId);
    if (!staff.trainingFolderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Drive folder is set up for that staff member yet.' }) };
    }

    const parentFolderId = driveFolderIdFromUrl(staff.trainingFolderUrl);
    if (!parentFolderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read a Drive folder ID from the stored folder link.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: staff.location,
        staffName: staff.name,
        stepKey: parsed.stepKey,
        expDate: parsed.expDate,
        filename: body.filename,
        parentFolderId: parentFolderId
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
