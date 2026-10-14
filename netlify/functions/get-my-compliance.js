const { requireSession } = require('./lib/session');
const { homeCompliance, parseResidents } = require('./lib/compliance');

// The sponsor app's "My Home's Compliance": every area's light for the
// signed-in sponsor's home and residents.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (!session.location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No home is linked to this account.' }) };
    }
    const result = await homeCompliance(session.location, parseResidents(session.residentInitials));
    return { statusCode: 200, body: JSON.stringify(Object.assign({ location: session.location }, result)) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
