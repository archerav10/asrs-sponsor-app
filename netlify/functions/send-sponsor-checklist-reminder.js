const { requireSession } = require('./lib/session');
const { checklistById, sendReminder } = require('./lib/sponsor-checklists');

// Manual reminder send, per the user's "reminder emails would be sent
// out manually" — no automatic schedule, just a button on the dashboard.
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

    await sendReminder(checklistId);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
