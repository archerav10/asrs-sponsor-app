const { requireSession } = require('./lib/session');
const { findRecord, computeQuarterlyReportingForRecord, syncFromDrive } = require('./lib/quarterly-reporting');

function quarterOut(q) {
  return {
    index: q.index,
    start: q.start,
    end: q.end,
    dueDate: q.dueDate,
    isOpen: q.isOpen,
    missingCount: q.missingCount,
    steps: q.steps
  };
}

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
    const service = params.service;
    const cycle = params.cycle === 'prior' ? 'prior' : 'current';
    if (!location || !resident || !service) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, resident, and service are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const record = await findRecord(location, resident, service);
    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Annual Planning cycle is on file for that resident/service yet.' }) };
    }

    // Reports put straight into the cycle's Quarterly Report folder count
    // too, so check Drive before working out where things stand. A Drive
    // problem never stops the screen from loading.
    let drive;
    try {
      drive = await syncFromDrive(location, resident, service, record);
    } catch (e) {
      console.error('Quarterly Reporting Drive check failed', e);
      drive = { checked: false, added: [], unrecognized: [], error: 'Couldn\'t check the Drive folder just now.' };
    }

    const state = await computeQuarterlyReportingForRecord(location, resident, service, record);

    if (cycle === 'prior') {
      if (!state.priorCycle) {
        return { statusCode: 400, body: JSON.stringify({ error: 'No prior cycle with outstanding items is on file for that resident/service.' }) };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          resident: resident,
          service: service,
          cycle: 'prior',
          drive: drive,
          folderUrl: record.folderUrl || '',
          hasCycle: true,
          targetEffectiveDate: state.priorCycle.targetEffectiveDate,
          // The record's own current cycle start — Annual Planning can
          // roll this onto the NEXT period up to 6 weeks before it's
          // actually reached, so until that date genuinely arrives, this
          // "prior" cycle is still the real, active period. The client
          // uses it to decide whether "prior period" is an accurate
          // label yet.
          currentCycleStartDate: record.effectiveDate,
          quarters: state.priorCycle.quarters.map(quarterOut)
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        resident: resident,
        service: service,
        cycle: 'current',
        drive: drive,
        folderUrl: record.folderUrl || '',
        hasCycle: state.hasCycle,
        targetEffectiveDate: state.targetEffectiveDate,
        quarters: state.quarters.map(quarterOut)
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
