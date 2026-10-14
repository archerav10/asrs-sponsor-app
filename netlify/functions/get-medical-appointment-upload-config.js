const { requireSession } = require('./lib/session');
const { residentsForLocation, residentFullNameFor, validateAppointmentInput, buildFilename } = require('./lib/medical-appointments');

// Everything the browser needs to upload an appointment document
// straight to Drive via Zapier — same "don't route file bytes through a
// Netlify function" pattern as the other upload configs. No folder ID:
// the Zap finds the resident's folder by name (Location -> Residents ->
// full name -> Medical Appointments), the same chain the Medication
// Administration Report upload uses, so there's no one-time folder link
// to set up per resident. The filename is built here too, so the browser
// and the saved Notion row can never disagree about it.
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
    const location = params.location;
    const resident = params.resident;
    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location and resident are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const invalid = validateAppointmentInput(params.typeKey, params.appointmentDate);
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        webhookUrl: webhookUrl,
        residentFullName: residentFullName,
        filename: buildFilename(params.appointmentDate, params.typeKey, location, resident, params.extension || '')
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
