const { requireSession } = require('./lib/session');
const { encryptToken } = require('./lib/crypto');
const { id: configId } = require('./lib/ids');
const vh = require('./lib/vehicles');

const TICKET_TTL_SECONDS = 2 * 60 * 60;

// Gives the browser what it needs to send a vehicle document (normally the
// insurance declarations page) straight to the "ASRS Vehicle Documents"
// Zapier workflow: the Catch Hook URL, the final filename, and an
// encrypted 2-hour ticket naming that one service entry and file. Works
// for the admin dashboard and the sponsor app; either way the session
// must be allowed to see the vehicle. Marks the entry Pending until the
// workflow confirms the file is saved (vehicle-document-resolve).
//   GET ?serviceId=...&extension=pdf
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    const params = event.queryStringParameters || {};
    if (!params.serviceId) throw vh.httpError(400, 'Choose the entry to attach it to.');

    const service = await vh.getService(params.serviceId);
    const vehicle = await vh.vehicleForSession(session, service.vehicleId);
    if (!vehicle.active) throw vh.httpError(409, 'This vehicle has been retired.');

    const webhookUrl = configId('VEHICLE_DOCUMENT_WEBHOOK_URL');
    if (!webhookUrl) throw vh.httpError(500, 'Vehicle document uploads are not configured yet.');

    const filename = vh.documentFilename(vehicle, service, params.extension);
    const ticket = encryptToken({ kind: 'vehicle-document', serviceId: service.id, location: vehicle.location, filename: filename }, TICKET_TTL_SECONDS);
    await vh.markDocumentPending(service.id, filename);

    return { statusCode: 200, body: JSON.stringify({ webhookUrl: webhookUrl, filename: filename, ticket: ticket }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
