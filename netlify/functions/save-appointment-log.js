const { requireSession } = require('./lib/session');
const { residentsForLocation, validateAppointmentInput, isValidStatus, createAppointment } = require('./lib/appointment-log');

// Creates a new appointment log row. Callable from the provider app
// (sponsor, or admin logged in with a location's password) and from the
// admin dashboard — both sides can log appointments into the same
// per-location log, same as the README describes for this feature.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const body = JSON.parse(event.body || '{}');

    const isAdminDashboard = session.accountType === 'admin-dashboard';
    const location = isAdminDashboard ? body.location : session.location;
    const resident = body.resident;
    const appointmentType = (body.appointmentType || '').trim();
    const appointmentDate = body.appointmentDate;
    const status = body.status || 'Pending';
    const hasNotes = !!body.hasNotes;

    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location and resident are required.' }) };
    }
    const invalid = validateAppointmentInput(appointmentType, appointmentDate);
    if (invalid) {
      return { statusCode: 400, body: JSON.stringify({ error: invalid }) };
    }
    if (!isValidStatus(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid status.' }) };
    }

    if (isAdminDashboard) {
      if ((session.grantedLocations || []).indexOf(location) === -1) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
      }
      const residents = await residentsForLocation(location);
      if (residents.indexOf(resident) === -1) {
        return { statusCode: 404, body: JSON.stringify({ error: 'That resident was not found at this location.' }) };
      }
    } else {
      const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (residents.indexOf(resident) === -1) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that resident.' }) };
      }
    }

    const createdByRole = session.accountType === 'sponsor' ? 'Sponsor' : 'Admin';
    const loggedBy = session.name || session.email;
    const appointment = await createAppointment(location, resident, appointmentType, appointmentDate, status, hasNotes, createdByRole, loggedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true, appointment: appointment }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
