const { requireSession } = require('./lib/session');
const { encryptToken } = require('./lib/crypto');
const { residentFullNameFor, validateAppointmentInput, buildFilename, appointmentById } = require('./lib/medical-appointments');

const TICKET_TTL_SECONDS = 2 * 60 * 60;

// The provider app's version of get-medical-appointment-upload-config.js's
// appointmentId mode — lets a sponsor (or location-password admin) attach
// a document to an appointment they already logged, straight from their
// phone, instead of waiting for an admin to do it at the monthly
// meeting. Only that mode: sponsors never get the admin's combined
// log-and-upload flow, since Log an Appointment and attaching a document
// are separate steps here. Same ticket shape, same Catch Hook — no
// second Zapier workflow needed.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType === 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Use the Medical tab for the admin dashboard.' }) };
    }

    const params = event.queryStringParameters || {};
    const appointmentId = params.appointmentId;
    if (!appointmentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'appointmentId is required.' }) };
    }

    const appointment = await appointmentById(appointmentId);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (appointment.location !== session.location || residents.indexOf(appointment.resident) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that appointment.' }) };
    }
    const invalid = validateAppointmentInput(appointment.typeKey, appointment.date);
    if (invalid) {
      return { statusCode: 400, body: JSON.stringify({ error: invalid }) };
    }

    const webhookUrl = process.env.ZAPIER_MEDICAL_APPOINTMENT_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Medical appointment uploads are not configured yet.' }) };
    }

    const residentFullName = await residentFullNameFor(appointment.location, appointment.resident);
    if (!residentFullName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This resident has no full name on file, so their Drive folder can\'t be found. Ask an admin to add one in Daily Progress Notes -> Manage Question Templates.' })
      };
    }

    const filename = buildFilename(appointment.date, appointment.typeKey, appointment.location, appointment.resident, params.extension || '');
    const ticket = encryptToken({
      kind: 'medical-upload',
      location: appointment.location,
      residentFullName: residentFullName,
      filename: filename
    }, TICKET_TTL_SECONDS);

    return {
      statusCode: 200,
      body: JSON.stringify({ webhookUrl: webhookUrl, filename: filename, ticket: ticket })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
