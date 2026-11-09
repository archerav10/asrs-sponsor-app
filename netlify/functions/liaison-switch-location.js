const { requireSession } = require('./lib/session');
const { encryptToken } = require('./lib/crypto');
const lz = require('./lib/liaison');

const SESSION_TTL_SECONDS = 12 * 60 * 60;

// Switches the Liaison app to another of the liaison's granted homes by
// issuing a new session for it (every sponsor app screen then works for
// that home).   POST { location }
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = requireSession(event);
    if (!session.liaison) throw lz.httpError(403, 'This is for the Liaison app.');
    const location = JSON.parse(event.body || '{}').location;
    if ((session.grantedLocations || []).indexOf(location) === -1) throw lz.httpError(403, 'Choose one of your locations.');
    const next = await lz.sessionForLocation(session, location);
    return { statusCode: 200, body: JSON.stringify({ sessionToken: encryptToken(next, SESSION_TTL_SECONDS), session: next }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
