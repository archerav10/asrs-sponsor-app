const { STEPS, SERVICES, markStepDone } = require('./lib/annual-planning');

const STEP_KEYS = STEPS.map(function (s) { return s.key; });

// Called by Zapier, not a logged-in admin, after a JotForm submission's
// PDF has already been uploaded to the resident's Drive folder — the
// other end of the "complete form" path, so it lands on the same record
// state (via markStepDone) as a browser upload does. Auth is a shared
// secret instead of a session token, same pattern as the other
// Zapier/cron-facing endpoints (see test-check-*.js).
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.ANNUAL_PLANNING_FORM_WEBHOOK_SECRET;
    if (!secret || body.secret !== secret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
    }

    const location = body.location;
    const resident = body.resident;
    const service = body.service;
    const stepKey = body.stepKey;
    const filename = body.filename || '';

    if (!location || !resident || !service || !stepKey) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, resident, service, and stepKey are required.' }) };
    }
    if (STEP_KEYS.indexOf(stepKey) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown step.' }) };
    }
    if (SERVICES.indexOf(service) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown service.' }) };
    }

    await markStepDone(location, resident, service, stepKey, filename, true, 'JotForm submission');

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
