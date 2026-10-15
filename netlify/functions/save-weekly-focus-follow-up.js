const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');

// Marks a Yellow/Red check-in as followed up, with an optional note.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    if (!body.responseId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'responseId is required.' }) };
    }
    const note = String(body.note || '').trim().slice(0, 4000);

    const response = await wf.getResponse(body.responseId);
    if ((session.grantedLocations || []).indexOf(response.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    await wf.markFollowedUp(response.id, note, session.name || session.email);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
