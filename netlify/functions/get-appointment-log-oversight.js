const { requireSession } = require('./lib/session');
const { appointmentsForLocation, residentsForLocation } = require('./lib/appointment-log');

// Admin dashboard's Appointments tab: every appointment logged (by
// either side) at every location this admin is granted, plus each
// location's resident list so the "log an appointment" picker doesn't
// need a second round trip.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const grantedLocations = session.grantedLocations || [];
    const locations = await Promise.all(grantedLocations.map(async function (location) {
      const results = await Promise.all([appointmentsForLocation(location), residentsForLocation(location)]);
      return { location: location, appointments: results[0], residents: results[1] };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
