const { requireSession } = require('./lib/session');
const { loadRequirements, staffInfoById, markItemDone } = require('./lib/staff-training');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Records that an item's document has been captured — called after the
// browser's direct-to-Zapier upload already succeeded. The admin enters
// the date it was completed; the next due date is worked out from the
// item's Renews setting. No window/lock check: any item can be updated
// at any time, there's no cycle to gate against.
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
    const completedDate = body.completedDate;

    if (!staffId || !stepKey || !completedDate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId, stepKey, and completedDate are required.' }) };
    }
    if (!DATE_RE.test(completedDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'completedDate must be in YYYY-MM-DD format.' }) };
    }
    const req = (await loadRequirements()).byKey[stepKey];
    if (!req) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown item.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const stampedBy = session.name || session.email;
    await markItemDone(staff.location, staff.name, req, filename, completedDate, stampedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
