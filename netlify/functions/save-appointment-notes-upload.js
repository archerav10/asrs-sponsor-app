const { requireSession } = require('./lib/session');
const { appointmentById, recordNotesUploaded } = require('./lib/appointment-log');

// Called after the browser's direct-to-Zapier upload of a notes document
// already succeeded — flips Notes Uploaded on for that appointment, same
// "only record it once the document is actually in Drive" ordering as
// save-medical-appointment.js.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const appointmentId = body.appointmentId;
    const filename = body.filename;
    if (!appointmentId || !filename) {
      return { statusCode: 400, body: JSON.stringify({ error: 'appointmentId and filename are required.' }) };
    }

    const appointment = await appointmentById(appointmentId);
    if ((session.grantedLocations || []).indexOf(appointment.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    await recordNotesUploaded(appointmentId, filename);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
