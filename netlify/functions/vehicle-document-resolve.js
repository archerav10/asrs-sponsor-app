const { decryptToken } = require('./lib/crypto');
const { id: configId } = require('./lib/ids');
const vh = require('./lib/vehicles');

// Zapier-facing, for the "ASRS Vehicle Documents" workflow. The ticket
// from get-vehicle-document-upload-config (encrypted, 2-hour, one entry
// and file) is the credential, so no secret lives in the workflow.
//   { action: 'resolve', ticket }        -> where the file goes:
//       Facility Reporting/{Location}/Vehicles/{filename}
//   { action: 'saved', ticket, link }    -> marks the entry Saved
// 'saved' only applies while the entry still names this ticket's file, so
// a late confirmation for an older upload can't overwrite a newer one.
const VEHICLES_FOLDER_NAME = 'Vehicles';

function json(statusCode, body) { return { statusCode: statusCode, body: JSON.stringify(body) }; }

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    let ticket;
    try {
      ticket = decryptToken(body.ticket || '');
    } catch (e) {
      return json(401, { error: 'Upload ticket expired or invalid.' });
    }
    if (ticket.kind !== 'vehicle-document' || !ticket.serviceId || !ticket.location || !ticket.filename) {
      return json(401, { error: 'Invalid upload ticket.' });
    }

    if ((body.action || 'resolve') === 'resolve') {
      return json(200, {
        rootFolderId: configId('FACILITY_REPORTING_ROOT_FOLDER_ID'),
        locationFolderName: ticket.location,
        vehiclesFolderName: VEHICLES_FOLDER_NAME,
        filename: ticket.filename
      });
    }

    if (body.action === 'saved') {
      const service = await vh.getService(ticket.serviceId);
      if (service.documentFilename !== ticket.filename) return json(409, { error: 'A newer document has replaced this one.' });
      const link = typeof body.link === 'string' && /^https:\/\//.test(body.link) ? body.link : '';
      await vh.markDocumentSaved(service.id, link);
      return json(200, { success: true });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};
