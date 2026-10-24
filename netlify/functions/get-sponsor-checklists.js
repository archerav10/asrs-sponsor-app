const { requireSession } = require('./lib/session');
const { checklistsForLocations } = require('./lib/sponsor-checklists');

// The Checklists tab: every checklist at the admin's granted locations.
// Open ones lead, oldest first (longest outstanding at the top); closed
// ones follow, most recently closed first, for an optional "view closed" toggle.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const locations = session.grantedLocations || [];
    const checklists = await checklistsForLocations(locations);

    const open = checklists.filter(function (c) { return c.status === 'Open'; })
      .sort(function (a, b) { return a.createdDate < b.createdDate ? -1 : a.createdDate > b.createdDate ? 1 : 0; });
    const closed = checklists.filter(function (c) { return c.status !== 'Open'; })
      .sort(function (a, b) { return a.closedDate < b.closedDate ? 1 : a.closedDate > b.closedDate ? -1 : 0; });

    return { statusCode: 200, body: JSON.stringify({ me: session.email, locations: locations, open: open, closed: closed }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
