const { requireSession } = require('./lib/session');
const { getChecklist, assertCanAccess, setCompleted } = require('./lib/shared-checklists');

// Admin dashboard only: marks a shared checklist complete (which drops it
// off the provider app), or reopens it with `completed: false`. Doesn't
// require every item be checked — the admin decides when it's done.
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
    if (!body.id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Checklist ID is required.' }) };
    }

    const checklist = await getChecklist(body.id);
    assertCanAccess(session, checklist);

    const completed = body.completed !== false;
    await setCompleted(checklist, completed, session.name || session.email);

    return { statusCode: 200, body: JSON.stringify({ success: true, completed: completed }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
