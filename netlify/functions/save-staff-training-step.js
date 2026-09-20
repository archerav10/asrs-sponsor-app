const { requireSession } = require('./lib/session');
const { STEP_KEYS, staffInfoById, markItemDone } = require('./lib/staff-training');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Records that a step's document has been captured — called after the
// browser's direct-to-Zapier upload already succeeded. No window/lock
// check: any of the 19 items can be updated at any time, there's no
// cycle to gate against.
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
    const staffId = body.staffId;
    const stepKey = body.stepKey;
    const filename = body.filename || '';
    const expDate = body.expDate;

    if (!staffId || !stepKey || !expDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId, stepKey, and expDate are required.' }) };
    }
    if (STEP_KEYS.indexOf(stepKey) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown step.' }) };
    }
    if (!DATE_RE.test(expDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'expDate must be in YYYY-MM-DD format.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const stampedBy = session.name || session.email;
    await markItemDone(staff.location, staff.name, stepKey, filename, expDate, stampedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
