const { requireSession } = require('./lib/session');
const { createChecklist } = require('./lib/sponsor-checklists');

// Creates a checklist (its items read from the Google Sheet) and sends the
// location's checklist recipient its private link right away, by text when
// they're opted in, else by email. There's no separate "send" step.
// The site a request came in on, so a deploy preview's links point at itself.
function siteFor(event) {
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h.host || '';
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? 'https://' + host : '';
}

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

    const checklist = await createChecklist(location, title, message, dueDate, driveLink, session.email, session.name || session.email, siteFor(event));
    return { statusCode: 200, body: JSON.stringify({ checklist: checklist }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
