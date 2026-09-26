const { requireSession } = require('./lib/session');
const { ITEMS, resolveTarget, missingItems } = require('./lib/monthly-checklist');

// Per-location checklist detail. No early-unlock window to gate on here
// (see resolveTarget's comment in lib/monthly-checklist.js) — this just
// resolves whichever period is current right now and hands back its
// record. That record can come back already finalized if the location
// finished this month early; the client should render that as
// locked/waiting for next month, the same way Annual Planning treats
// isFinalizedForTarget.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const params = event.queryStringParameters || {};
    const location = params.location;
    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const target = await resolveTarget(location);

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        period: target.targetPeriod,
        dueDate: target.dueDate.toISOString().slice(0, 10),
        record: target.record,
        items: ITEMS.map(function (i) { return { key: i.key, label: i.label, type: i.type }; }),
        missingItems: missingItems(target.record)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
