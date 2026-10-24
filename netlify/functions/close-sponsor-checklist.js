const { requireSession } = require('./lib/session');
const { checklistById, closeChecklist } = require('./lib/sponsor-checklists');

// Closing is restricted to whoever created the checklist — the dashboard
// only hides the button for everyone else, so this re-checks server-side.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const checklistId = body.checklistId;
    if (!checklistId) return { statusCode: 400, body: JSON.stringify({ error: 'checklistId is required.' }) };

    const checklist = await checklistById(checklistId);
    if ((session.grantedLocations || []).indexOf(checklist.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const closed = await closeChecklist(checklistId, session.email);
    return { statusCode: 200, body: JSON.stringify({ checklist: closed }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
