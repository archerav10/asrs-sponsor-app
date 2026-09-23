const { requireSession } = require('./lib/session');
const { findRecord, computeQuarterlyReportingForRecord } = require('./lib/quarterly-reporting');

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
          folderUrl: record.folderUrl || '',
          hasCycle: true,
          targetEffectiveDate: state.priorCycle.targetEffectiveDate,
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
