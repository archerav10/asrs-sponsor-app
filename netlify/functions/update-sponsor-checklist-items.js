const { requireSession } = require('./lib/session');
const { checklistById, updateItemsFromSheet } = require('./lib/sponsor-checklists');

// Update from Sheet: re-reads an open checklist's Google Sheet.
//   { checklistId }               -> what would change (added, removed, unchanged)
//   { checklistId, apply: true }  -> makes the changes
// Unchanged items keep the recipient's answers; nothing is sent to them.
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

    const result = await updateItemsFromSheet(checklistId, body.apply === true);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
