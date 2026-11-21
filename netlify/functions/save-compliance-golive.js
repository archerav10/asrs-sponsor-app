const { requireSession } = require('./lib/session');
const { setGoLive } = require('./lib/compliance-records');

// Admin Compliance tab: the date a location's Daily Progress Notes and
// Medication Administration checks start counting.
//   POST { location, date }   date '' clears it (checks read Not started)
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const body = JSON.parse(event.body || '{}');
    if ((session.grantedLocations || []).indexOf(body.location) === -1) return json(403, { error: 'Not authorized for that location.' });
    return json(200, await setGoLive(body.location, body.date || ''));
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
