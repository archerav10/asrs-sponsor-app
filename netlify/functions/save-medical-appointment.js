const { requireSession } = require('./lib/session');
const { residentsForLocation, validateAppointmentInput, buildFilename, createAppointment, appointmentById, attachFilename } = require('./lib/medical-appointments');

// Records an appointment — called after the browser's direct-to-Zapier
// upload already succeeded, so a row here always has a document behind
// it (once this returns). Two modes: the original flow creates a new
// row; passing appointmentId instead attaches the just-uploaded document
// to a row a sponsor already logged with no file, rather than creating a
// duplicate.
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
    const extension = body.extension || '';

    if (body.appointmentId) {
      const appointment = await appointmentById(body.appointmentId);
      if ((session.grantedLocations || []).indexOf(appointment.location) === -1) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
      }
      const filename = buildFilename(appointment.date, appointment.typeKey, appointment.location, appointment.resident, extension);
      await attachFilename(body.appointmentId, filename);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    const location = body.location;
    const resident = body.resident;
    const typeKey = body.typeKey;
    const appointmentDate = body.appointmentDate;

    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location and resident are required.' }) };
    }
    const invalid = validateAppointmentInput(typeKey, appointmentDate);
    if (invalid) {
      return { statusCode: 400, body: JSON.stringify({ error: invalid }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const residents = await residentsForLocation(location);
    if (residents.indexOf(resident) === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'That resident was not found at this location.' }) };
    }

    const stampedBy = session.name || session.email;
    const filename = buildFilename(appointmentDate, typeKey, location, resident, extension);
    await createAppointment(location, resident, typeKey, appointmentDate, filename, stampedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
