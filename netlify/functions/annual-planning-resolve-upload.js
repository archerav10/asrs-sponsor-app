const { loadCurrentRecord, computeFolderName, parseFilename, driveFolderIdFromUrl } = require('./lib/annual-planning');

// Called by the one reusable "any form template" Zap: a form's own
// native Google Drive integration drops the completed submission's PDF
// into a single shared staging folder, with no other way for the Zap to
// know which resident/service/step it belongs to — so this endpoint
// tells it, parsed entirely from the filename this app itself built
// when the "Complete Form" link was opened (see parseFilename). Auth is
// a shared secret, not a session — Zapier calling server-to-server, same
// pattern as annual-planning-form-submitted.js.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.ANNUAL_PLANNING_FORM_WEBHOOK_SECRET;
    if (!secret || body.secret !== secret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
    }

    const parsed = parseFilename(body.filename);
    if (!parsed) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not parse a location/resident/service/step from that filename.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(parsed.location, parsed.resident, parsed.service);
    if (!record || !record.folderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Annual Planning folder is set up for that resident/service yet.' }) };
    }

    const parentFolderId = driveFolderIdFromUrl(record.folderUrl);
    if (!parentFolderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not read a Drive folder ID from the stored folder link.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: parsed.location,
        resident: parsed.resident,
        service: parsed.service,
        stepKey: parsed.stepKey,
        filename: body.filename,
        parentFolderId: parentFolderId,
        folderName: computeFolderName(windowState.targetEffectiveDate)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
