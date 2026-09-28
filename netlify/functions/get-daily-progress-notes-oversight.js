const { requireSession } = require('./lib/session');
const { findResidentsForLocation, resolveTarget } = require('./lib/daily-progress-notes');

// Read-only status board, same shape as the other oversight endpoints:
// for every granted location, every resident with a question template on
// file, and where their Daily Progress Notes currently stand — caught up
// (today, unsigned yet), overdue (stuck on a prior day), or fully signed
// for today already.
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
    const today = new Date().toISOString().slice(0, 10);

    const locations = await Promise.all(grantedLocations.map(async function (location) {
      const residents = await findResidentsForLocation(location);
      const residentRows = await Promise.all(residents.map(async function (resident) {
        const target = await resolveTarget(location, resident);
        return {
          resident: resident,
          targetDate: target.targetDate,
          isOverdue: target.targetDate < today,
          isSignedForTarget: !!(target.cover && target.cover.signedAt)
        };
      }));
      return { location: location, residents: residentRows };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
