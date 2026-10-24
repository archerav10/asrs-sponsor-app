const { requireSession } = require('./lib/session');
const { appointmentById, isValidStatus, updateAppointmentStatus } = require('./lib/appointment-log');

// Updates an existing appointment's status and/or "I have notes" flag.
// Either side (sponsor, location-password admin, or the admin dashboard)
// can update any appointment at a location they're authorized for — not
// just the ones they personally logged.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    const appointmentId = body.appointmentId;
    const status = body.status;
    const hasNotes = !!body.hasNotes;
    if (!appointmentId || !isValidStatus(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'appointmentId and a valid status are required.' }) };
    }

    const appointment = await appointmentById(appointmentId);

    if (session.accountType === 'admin-dashboard') {
      if ((session.grantedLocations || []).indexOf(appointment.location) === -1) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
      }
    } else {
      const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (appointment.location !== session.location || residents.indexOf(appointment.resident) === -1) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that appointment.' }) };
      }
    }

    await updateAppointmentStatus(appointmentId, status, hasNotes);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
