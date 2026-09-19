const { updatePage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { STEPS, loadCurrentRecord } = require('./lib/annual-planning');

// Step 12 — locks the cycle. Once finalized, save-annual-planning-step.js
// refuses further changes and the resident's card in the dashboard shows
// only a link to the Drive folder, same "locked, link-only" behavior the
// checklist asks for.
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

    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location and resident are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(location, resident);
    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set up this resident\'s annual planning cycle first (Step 1).' }) };
    }

    if (windowState.isFinalizedForTarget) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Already finalized.' }) };
    }
    if (!windowState.isWindowOpen) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This cycle is not open yet.' }) };
    }

    const missing = STEPS.filter(function (step) { return !record.steps[step.key].done; }).map(function (step) { return step.label; });
    if (missing.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cannot finalize — missing: ' + missing.join(', ') + '.' }) };
    }

    const stampedBy = session.name || session.email;
    const today = new Date().toISOString().slice(0, 10);
    await updatePage(record.id, {
      'Finalized': { checkbox: true },
      'Finalized Date': { date: { start: today } },
      'Finalized By': { rich_text: [{ text: { content: stampedBy } }] },
      'Last Updated By': { rich_text: [{ text: { content: stampedBy } }] },
      'Last Updated Date': { date: { start: today } }
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
