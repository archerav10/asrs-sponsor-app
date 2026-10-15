const { requireSession } = require('./lib/session');
const { locationCompliance } = require('./lib/compliance');

// The sponsor app's "My Home's Compliance": every area's light for the
// signed-in sponsor's home (their location) and every resident there —
// exactly what the admin dashboard's Compliance tab shows for it.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (!session.location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No home is linked to this account.' }) };
    }
    const result = await locationCompliance(session.location);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
