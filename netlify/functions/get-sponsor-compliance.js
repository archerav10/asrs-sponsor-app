const { requireSession } = require('./lib/session');
const { activeSponsors, normId } = require('./lib/weekly-focus');
const { homeCompliance, parseResidents } = require('./lib/compliance');

// The admin dashboard's Compliance tab, step 2: one sponsor's home, the
// same view that sponsor sees in the app.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const sponsorId = (event.queryStringParameters || {}).sponsorId;
    const sponsor = (await activeSponsors()).filter(function (s) { return normId(s.id) === normId(sponsorId); })[0];
    if (!sponsor) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Sponsor not found.' }) };
    }
    if ((session.grantedLocations || []).indexOf(sponsor.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    const result = await homeCompliance(sponsor.location, parseResidents(sponsor.residentInitials));
    return { statusCode: 200, body: JSON.stringify(Object.assign({ sponsorId: sponsor.id }, result)) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
