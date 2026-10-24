const { requireSession } = require('./lib/session');
const { appointmentById, isValidStatus, updateAppointment } = require('./lib/medical-appointments');

// Lets a sponsor (or location-password admin) reschedule (change the
// date), change the status, or flip "I have notes" on an appointment
// they're authorized for. Never touches Filename — an edit here doesn't
// imply a document exists.
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
    if (body.appointmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.appointmentDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Choose a valid appointment date.' }) };
    }
    if (body.status && !isValidStatus(body.status)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid status.' }) };
    }

    const appointment = await appointmentById(appointmentId);
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (appointment.location !== session.location || residents.indexOf(appointment.resident) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that appointment.' }) };
    }

    await updateAppointment(appointmentId, {
      appointmentDate: body.appointmentDate,
      status: body.status,
      hasNotes: typeof body.hasNotes === 'boolean' ? body.hasNotes : undefined
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
