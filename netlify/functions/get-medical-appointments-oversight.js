const { requireSession } = require('./lib/session');
const { residentsForLocation, appointmentsForResident, computeMedicalCompliance } = require('./lib/medical-appointments');

// Read-only status board, same loop-over-granted-locations shape as the
// other oversight endpoints: every resident, with the compliance status
// of their four annual appointment types (Physical, Dental, Labwork,
// TB Test).
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
      const residents = await residentsForLocation(location);
      const rows = await Promise.all(residents.map(async function (resident) {
        const appointments = await appointmentsForResident(location, resident);
        return { resident: resident, compliance: computeMedicalCompliance(appointments) };
      }));
      return { location: location, residents: rows };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
