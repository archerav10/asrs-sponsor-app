const { requireSession } = require('./lib/session');
const { createChecklist } = require('./lib/sponsor-checklists');

// Creates a checklist and emails it right away to the location's
// primary sponsor — there's no separate "send" step, matching the
// user's "send sponsors a checklist" framing.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const location = body.location;
    const title = (body.title || '').trim();
    const message = (body.message || '').trim();
    const dueDate = body.dueDate;
    const driveLink = (body.driveLink || '').trim();

    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    if (!title) return { statusCode: 400, body: JSON.stringify({ error: 'A title is required.' }) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return { statusCode: 400, body: JSON.stringify({ error: 'Choose a due date.' }) };
    if (!/^https:\/\//.test(driveLink)) return { statusCode: 400, body: JSON.stringify({ error: 'Paste the Google Sheet\'s link.' }) };

    const checklist = await createChecklist(location, title, message, dueDate, driveLink, session.email, session.name || session.email);
    return { statusCode: 200, body: JSON.stringify({ checklist: checklist }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
