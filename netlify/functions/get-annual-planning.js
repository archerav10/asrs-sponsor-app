const { requireSession } = require('./lib/session');
const { STEPS, SERVICES, DEFAULT_SERVICE, loadCurrentRecord, computeFolderName } = require('./lib/annual-planning');

// Per-resident checklist detail. Read-only — lazily rolls a finalized
// record into the next cycle if that cycle's window just opened, same
// timing as get-mar-review's wipe. Everything an admin needs to render
// the 12-step screen: the record's own data, the computed window state,
// and the step definitions (label + whether it has a form option).
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
    const resident = params.resident;
    const service = params.service || DEFAULT_SERVICE;

    if (!location || !resident) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Location and resident are required.' }) };
    }
    if (SERVICES.indexOf(service) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown service.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const { record, windowState } = await loadCurrentRecord(location, resident, service);

    return {
      statusCode: 200,
      body: JSON.stringify({
        location: location,
        resident: resident,
        service: service,
        record: record,
        window: {
          hasCycle: windowState.hasCycle,
          targetEffectiveDate: windowState.targetEffectiveDate,
          dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
          windowOpenDate: windowState.windowOpenDate ? windowState.windowOpenDate.toISOString().slice(0, 10) : null,
          isWindowOpen: windowState.isWindowOpen,
          isFinalizedForTarget: windowState.isFinalizedForTarget,
          folderName: windowState.targetEffectiveDate ? computeFolderName(windowState.targetEffectiveDate) : null
        },
        steps: STEPS.map(function (s) { return { key: s.key, label: s.label, formUrl: s.formUrl || '' }; })
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
