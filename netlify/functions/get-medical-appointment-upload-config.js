const { requireSession } = require('./lib/session');
const { encryptToken } = require('./lib/crypto');
const { residentsForLocation, residentFullNameFor, validateAppointmentInput, buildFilename, appointmentById } = require('./lib/medical-appointments');

const TICKET_TTL_SECONDS = 2 * 60 * 60;

// Everything the browser needs to upload an appointment document
// straight to Drive via Zapier — same "don't route file bytes through a
// Netlify function" pattern as the other upload configs. Like Sponsor
// Intake, the browser gets a short-lived encrypted ticket instead of any
// folder details; the workflow trades it at
// medical-appointment-resolve-upload for where the file goes (Facility
// Reporting -> Location -> Residents -> full name -> Medical
// Appointments). So a leaked webhook URL alone can't write into a
// resident's folder, and the resident's name never travels through the
// webhook payload. The filename is built here too, so the browser and
// the saved Notion row can never disagree about it.
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

    // Two modes: issuing a ticket for a brand-new log-and-upload (the
    // original flow, location/resident/typeKey/appointmentDate all come
    // from the picker), or attaching a document to a row a sponsor
    // already logged with no file (appointmentId alone — everything else
    // is read off that existing row so it can't disagree with it).
    let location, resident, typeKey, appointmentDate;
    if (params.appointmentId) {
      const appointment = await appointmentById(params.appointmentId);
      location = appointment.location;
      resident = appointment.resident;
      typeKey = appointment.typeKey;
      appointmentDate = appointment.date;
    } else {
      location = params.location;
      resident = params.resident;
      typeKey = params.typeKey;
      appointmentDate = params.appointmentDate;
    }
    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location and resident are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const invalid = validateAppointmentInput(typeKey, appointmentDate);
    if (invalid) {
      return { statusCode: 400, body: JSON.stringify({ error: invalid }) };
    }

    const webhookUrl = process.env.ZAPIER_MEDICAL_APPOINTMENT_WEBHOOK_URL;
    if (!webhookUrl) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Medical appointment uploads are not configured yet.' }) };
    }

    const results = await Promise.all([residentsForLocation(location), residentFullNameFor(location, resident)]);
    if (results[0].indexOf(resident) === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'That resident was not found at this location.' }) };
    }
    const residentFullName = results[1];
    if (!residentFullName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'This resident has no full name on file, so their Drive folder can\'t be found. Add one in Daily Progress Notes -> Manage Question Templates first.' })
      };
    }

    const filename = buildFilename(appointmentDate, typeKey, location, resident, params.extension || '');
    const ticket = encryptToken({
      kind: 'medical-upload',
      location: location,
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
