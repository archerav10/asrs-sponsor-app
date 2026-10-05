const { requireSession } = require('./lib/session');
const { TEMPLATES, listOpen, listRecentlyCompleted, summarize, sessionLocations } = require('./lib/shared-checklists');

// Every shared checklist the caller can see, with progress. The provider
// app gets only its own location's open checklists; the admin dashboard
// gets every granted location's open ones, plus recently completed ones
// and the templates/locations it needs to start a new checklist.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const locations = sessionLocations(session);
    const open = await summarize(await listOpen(locations));

    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 200, body: JSON.stringify({ open: open }) };
    }

    const completed = await summarize(await listRecentlyCompleted(locations));
    return {
      statusCode: 200,
      body: JSON.stringify({
        open: open,
        completed: completed,
        locations: locations,
        templates: TEMPLATES.map(function (t) { return { key: t.key, name: t.name }; })
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
