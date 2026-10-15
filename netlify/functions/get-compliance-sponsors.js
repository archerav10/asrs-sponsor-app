const { requireSession } = require('./lib/session');
const { activeSponsors } = require('./lib/weekly-focus');
const { parseResidents } = require('./lib/compliance');

// The admin dashboard's Compliance tab, step 1: every sponsor with app
// access at the admin's granted locations. The tab then loads each
// sponsor's compliance separately (get-sponsor-compliance), so one slow
// home never holds up — or times out — the whole page.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const granted = session.grantedLocations || [];
    const sponsors = (await activeSponsors())
      .filter(function (s) { return granted.indexOf(s.location) !== -1; })
      .map(function (s) { return { id: s.id, name: s.name, location: s.location, residents: parseResidents(s.residentInitials) }; })
      .sort(function (a, b) { return a.location.localeCompare(b.location) || a.name.localeCompare(b.name); });
    return { statusCode: 200, body: JSON.stringify({ locations: granted, sponsors: sponsors }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
