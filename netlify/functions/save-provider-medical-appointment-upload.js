const { requireSession } = require('./lib/session');
const { buildFilename, appointmentById, attachFilename } = require('./lib/medical-appointments');

// Called after the browser's direct-to-Zapier upload already succeeded
// (see get-provider-medical-appointment-upload-config.js) — attaches the
// document to the sponsor's own appointment and marks it Completed, same
// as the admin dashboard's attach-a-missing-document flow.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType === 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Use the Medical tab for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const appointmentId = body.appointmentId;
    if (!appointmentId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'appointmentId is required.' }) };
    }

    const appointment = await appointmentById(appointmentId);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (appointment.location !== session.location || residents.indexOf(appointment.resident) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that appointment.' }) };
    }

    const filename = buildFilename(appointment.date, appointment.typeKey, appointment.location, appointment.resident, body.extension || '');
    await attachFilename(appointmentId, filename);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
