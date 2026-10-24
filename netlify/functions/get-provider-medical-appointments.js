const { requireSession } = require('./lib/session');
const {
  APPOINTMENT_TYPES,
  appointmentsForResident,
  latestByType,
  computeMedicalCompliance
} = require('./lib/medical-appointments');

// Provider app's per-resident Medical screen: same data shape as the
// admin dashboard's get-medical-appointments.js, but scoped to the
// logged-in sponsor's (or location-password admin's) own resident list
// instead of a grantedLocations admin session — same pattern as
// get-medication-administration.js.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType === 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Use the Medical tab for the admin dashboard.' }) };
    }

    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const params = event.queryStringParameters || {};
    const requestedResident = params.resident;
    const resident = requestedResident && residents.indexOf(requestedResident) !== -1 ? requestedResident : residents[0];
    if (!resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No resident on file for this account.' }) };
    }

    const appointments = await appointmentsForResident(session.location, resident);

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: session.location,
        resident: resident,
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
