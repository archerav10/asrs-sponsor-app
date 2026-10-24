const { requireSession } = require('./lib/session');
const { appointmentsForLocation } = require('./lib/appointment-log');

// Provider app (sponsor or admin-acting-as-location session): every
// appointment logged at this location, for residents on this account —
// including ones the other side (sponsor vs admin) entered, so each sees
// the other's work.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType === 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Use the Appointments tab for the admin dashboard.' }) };
    }

    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const all = await appointmentsForLocation(session.location);
    const appointments = all.filter(function (a) { return residents.indexOf(a.resident) !== -1; });

    return { statusCode: 200, body: JSON.stringify({ location: session.location, residents: residents, appointments: appointments }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
