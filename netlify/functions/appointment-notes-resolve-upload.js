const { decryptToken } = require('./lib/crypto');
const { id: configId } = require('./lib/ids');
const { NOTES_FOLDER_NAME } = require('./lib/appointment-log');

// Zapier-facing: tells the Appointment Notes workflow where an uploaded
// document goes. Same shape as medical-appointment-resolve-upload.js: the
// ticket (from get-appointment-notes-upload-config.js — encrypted,
// 2-hour, one resident and file) is the credential, so no secret has to
// live in the workflow. Returns the Facility Reporting root folder ID
// plus the folder names to walk: Location -> Residents -> full name ->
// Appointment Notes.
function json(statusCode, body) {
  return { statusCode: statusCode, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const rootFolderId = configId('FACILITY_REPORTING_ROOT_FOLDER_ID');

    let ticket;
    try {
      ticket = decryptToken(body.ticket || '');
    } catch (e) {
      return json(401, { error: 'Upload ticket expired or invalid.' });
    }
    if (ticket.kind !== 'appointment-notes-upload' || !ticket.location || !ticket.residentFullName || !ticket.filename) {
      return json(401, { error: 'Invalid upload ticket.' });
    }

    return json(200, {
      rootFolderId: rootFolderId,
      locationFolderName: ticket.location,
      residentFolderName: ticket.residentFullName,
      notesFolderName: NOTES_FOLDER_NAME,
      filename: ticket.filename
    });
  } catch (err) {
    console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};
