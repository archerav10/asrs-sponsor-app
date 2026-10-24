const { requireSession } = require('./lib/session');
const { validateScheduleInput, isValidStatus, createAppointment } = require('./lib/medical-appointments');

// Lets a sponsor (or location-password admin) log or schedule an
// appointment — type, date, status (Planned/Completed/Cancelled) and
// whether they have visit notes, no document. Creates the same kind of
// row the admin dashboard's Medical tab does, just with an empty
// Filename; an admin attaches the actual document later from there once
// it's been collected (see get-medical-appointment-upload-config.js's
// appointmentId mode). Unlike the admin's log-and-upload flow, a future
// date is allowed here — Planned appointments haven't happened yet.
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
    const resident = body.resident;
    const typeKey = body.typeKey;
    const appointmentDate = body.appointmentDate;
    const status = body.status || 'Planned';
    const hasNotes = !!body.hasNotes;

    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!resident || residents.indexOf(resident) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that resident.' }) };
    }
    const invalid = validateScheduleInput(typeKey, appointmentDate);
    if (invalid) {
      return { statusCode: 400, body: JSON.stringify({ error: invalid }) };
    }
    if (!isValidStatus(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid status.' }) };
    }

    const loggedBy = session.name || session.email;
    await createAppointment(session.location, resident, typeKey, appointmentDate, '', loggedBy, status, hasNotes);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
