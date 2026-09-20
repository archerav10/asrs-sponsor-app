const { STEP_KEYS, markItemDone } = require('./lib/staff-training');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Called by Zapier after a JotForm submission's PDF has already been
// moved into the staff member's Drive folder — the other end of the
// "complete form" path. Auth is a shared secret, not a session — same
// pattern as annual-planning-form-submitted.js.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const secret = process.env.ANNUAL_PLANNING_FORM_WEBHOOK_SECRET; // shared across admin-dashboard Zapier-facing endpoints
    if (!secret || body.secret !== secret) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
    }

    const location = body.location;
    const staffName = body.staffName;
    const stepKey = body.stepKey;
    const expDate = body.expDate;
    const filename = body.filename || '';

    if (!location || !staffName || !stepKey || !expDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, staffName, stepKey, and expDate are required.' }) };
    }
    if (STEP_KEYS.indexOf(stepKey) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown step.' }) };
    }
    if (!DATE_RE.test(expDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'expDate must be in YYYY-MM-DD format.' }) };
    }

    await markItemDone(location, staffName, stepKey, filename, expDate, 'JotForm submission');

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
