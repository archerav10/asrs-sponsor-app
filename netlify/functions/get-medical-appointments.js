const { requireSession } = require('./lib/session');
const {
  APPOINTMENT_TYPES,
  residentsForLocation,
  residentFullNameFor,
  appointmentsForResident,
  latestByType,
  computeMedicalCompliance
} = require('./lib/medical-appointments');

// One resident's Medical Appointments screen: the latest appointment of
// every type that has any history, the four compliance types' status,
// and the full type list for the "log an appointment" picker.
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

    const results = await Promise.all([
      residentsForLocation(location),
      appointmentsForResident(location, resident),
      residentFullNameFor(location, resident)
    ]);
    if (results[0].indexOf(resident) === -1) {
      return { statusCode: 404, body: JSON.stringify({ error: 'That resident was not found at this location.' }) };
    }
    const appointments = results[1];

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        resident: resident,
        residentFullName: results[2],
        appointmentTypes: APPOINTMENT_TYPES,
        byType: latestByType(appointments),
        compliance: computeMedicalCompliance(appointments)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
