const { requireSession } = require('./lib/session');
const { activeSponsors } = require('./lib/weekly-focus');
const { locationCompliance } = require('./lib/compliance');

// The admin dashboard's Compliance tab, one location at a time (the tab
// loads its granted locations a few at a time, so one slow home never
// holds up or times out the whole page). Same view the location's
// sponsor sees under My Home's Compliance, plus who the sponsor is.
//   (no location)      just the admin's granted locations, to list
//   ?location=Janeway  that location's compliance
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const location = (event.queryStringParameters || {}).location;
    const granted = (session.grantedLocations || []).slice().sort();
    if (!location) {
      return { statusCode: 200, body: JSON.stringify({ locations: granted }) };
    }
    if (granted.indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const results = await Promise.all([locationCompliance(location), activeSponsors()]);
    const sponsors = results[1].filter(function (s) { return s.location === location; }).map(function (s) { return s.name; }).sort();
    return { statusCode: 200, body: JSON.stringify(Object.assign({ sponsors: sponsors }, results[0])) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
