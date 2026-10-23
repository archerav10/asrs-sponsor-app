const { requireSession } = require('./lib/session');
const { encryptToken } = require('./lib/crypto');
const { appointmentById, residentFullNameFor, buildNotesFilename } = require('./lib/appointment-log');

const TICKET_TTL_SECONDS = 2 * 60 * 60;

// Everything the admin dashboard needs to upload a notes document for one
// appointment straight to Drive via Zapier — same ticket pattern as
// Medical Appointments: the browser gets an encrypted ticket naming the
// resident's folder and the final filename, never the webhook's payload
// itself, so a leaked webhook URL alone can't write into a resident's
// folder.
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
    const appointmentId = params.appointmentId;
    if (!appointmentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'appointmentId is required.' }) };
    }

    const appointment = await appointmentById(appointmentId);
    if ((session.grantedLocations || []).indexOf(appointment.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const webhookUrl = process.env.ZAPIER_APPOINTMENT_NOTES_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Appointment notes uploads are not configured yet.' }) };
    }

    const residentFullName = await residentFullNameFor(appointment.location, appointment.resident);
    if (!residentFullName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This resident has no full name on file, so their Drive folder can\'t be found. Add one in Daily Progress Notes -> Manage Question Templates first.' })
      };
    }

    const filename = buildNotesFilename(appointment.appointmentDate, appointment.location, appointment.resident, params.extension || '');
    const ticket = encryptToken({
      kind: 'appointment-notes-upload',
      location: appointment.location,
      residentFullName: residentFullName,
      filename: filename
    }, TICKET_TTL_SECONDS);

    return { statusCode: 200, body: JSON.stringify({ webhookUrl: webhookUrl, filename: filename, ticket: ticket }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
