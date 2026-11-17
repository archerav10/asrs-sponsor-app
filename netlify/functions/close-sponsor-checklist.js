const { requireSession } = require('./lib/session');
const { checklistById, closeChecklist } = require('./lib/sponsor-checklists');

// Close (mark complete): anyone granted the location can close a
// checklist; who closed it is recorded, and the recipient is told it's
// complete (text or email, the way it went out).
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
    const checklistId = body.checklistId;
    if (!checklistId) return { statusCode: 400, body: JSON.stringify({ error: 'checklistId is required.' }) };

    const checklist = await checklistById(checklistId);
    if ((session.grantedLocations || []).indexOf(checklist.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const result = await closeChecklist(checklistId, session.name || session.email, siteFor(event));
    return { statusCode: 200, body: JSON.stringify({ checklist: result.checklist, notified: result.notified }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
