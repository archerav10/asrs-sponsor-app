const { requireSession } = require('./lib/session');
const { resolveTarget, missingItems, finalize } = require('./lib/monthly-checklist');

// Validates first: every one of the 11 items must have a real value —
// mirrors MAR Review's Finalize gate. Failing blocks finalizing with a
// message naming which items still need attention.
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
    const location = body.location;

    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const target = await resolveTarget(location);
    if (target.record && target.record.finalized) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This period is already finalized.' }) };
    }

    const missing = missingItems(target.record);
    if (missing.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Still needs: ' + missing.join(', ') }) };
    }

    const finalizedBy = session.name || session.email;
    await finalize(location, target.targetPeriod, finalizedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true, period: target.targetPeriod }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
