const { requireSession } = require('./lib/session');
const { ITEMS, resolveTarget, saveProgress } = require('./lib/monthly-checklist');

// Saves whatever's currently entered, complete or not — no validation,
// safe to leave and come back to, same as every other process's "Save
// Progress." Only ever writes to the period the server itself resolves
// as current, never whatever period the client happened to send, so a
// stale screen can't accidentally save into the wrong month.
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
    const fields = body.fields || {};

    if (!location) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location is required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const validKeys = ITEMS.map(function (i) { return i.key; });
    const cleanFields = {};
    Object.keys(fields).forEach(function (key) {
      if (validKeys.indexOf(key) !== -1) cleanFields[key] = fields[key];
    });

    const target = await resolveTarget(location);
    if (target.record && target.record.finalized) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This period is already finalized.' }) };
    }

    await saveProgress(location, target.targetPeriod, cleanFields);

    return { statusCode: 200, body: JSON.stringify({ success: true, period: target.targetPeriod }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
