const { requireSession } = require('./lib/session');
const { latestSiteVisitDates } = require('./lib/monthly-checklist');

// Read-only — surfaces the two site-visit dates entered on the admin
// dashboard's Monthly Checklist for the sponsor's own location, for
// display on Home. Not resident-scoped (the checklist is per location).
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const dates = await latestSiteVisitDates(session.location);

    return { statusCode: 200, body: JSON.stringify(dates) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
