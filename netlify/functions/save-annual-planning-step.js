const { updatePage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { STEPS, SERVICES, DEFAULT_SERVICE, loadCurrentRecord } = require('./lib/annual-planning');

const STEP_KEYS = STEPS.map(function (s) { return s.key; });

// Records that a step's document has been captured — called after the
// browser's direct-to-Zapier upload (or the resident's completed form)
// already succeeded. This function never touches Drive itself; it only
// marks the corresponding step Done and stores the filename for display.
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
    const resident = body.resident;
    const service = body.service || DEFAULT_SERVICE;
    const stepKey = body.stepKey;
    const filename = body.filename || '';
    const done = body.done !== false; // allow explicitly un-marking a step

    if (!location || !resident || !stepKey) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location, resident, and step are required.' }) };
    }
    if (STEP_KEYS.indexOf(stepKey) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown step.' }) };
    }
    if (SERVICES.indexOf(service) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown service.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(location, resident, service);
    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set up this resident\'s annual planning cycle first (Step 1).' }) };
    }

    if (!windowState.isWindowOpen || windowState.isFinalizedForTarget) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This cycle is not open for changes.' }) };
    }

    const stampedBy = session.name || session.email;
    await updatePage(record.id, {
      [stepKey + ' Done']: { checkbox: done },
      [stepKey + ' Filename']: { rich_text: filename ? [{ text: { content: filename } }] : [] },
      'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
      'Last Updated Date': { date: { start: new Date().toISOString().slice(0, 10) } }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
