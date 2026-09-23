const { requireSession } = require('./lib/session');
const { STEP_KEYS, computeQuarters, effectiveDateForCycle, findRecord, markQuarterlyStepDone } = require('./lib/quarterly-reporting');

// Unlike Staff Training, this process IS gated the way Annual Planning
// is — a quarter genuinely has to be open before its reports can be
// uploaded, so this re-derives the current quarters server-side and
// checks the one being written to is actually open, rather than trusting
// whatever the client had rendered.
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
    const service = body.service;
    const quarterStart = body.quarterStart;
    const stepKey = body.stepKey;
    const filename = body.filename || '';

    if (!location || !resident || !service || !quarterStart || !stepKey) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, resident, service, quarterStart, and stepKey are required.' }) };
    }
    if (STEP_KEYS.indexOf(stepKey) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown step.' }) };
    }
    if ((session.grantedLocations || []).indexOf(location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const record = await findRecord(location, resident, service);
    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Annual Planning cycle is on file for that resident/service.' }) };
    }

    // Checks both the current cycle's quarters and the prior cycle's (see
    // computeQuarterlyReportingForRecord in lib/quarterly-reporting.js) —
    // a resident's Effective Date can move onto the next cycle while a
    // quarter from the outgoing one is still open and being caught up.
    // Quarter start dates a year apart are inherently unambiguous, so this
    // doesn't need to trust a client-supplied cycle flag.
    const currentQuarters = computeQuarters(record.effectiveDate);
    const priorQuarters = computeQuarters(effectiveDateForCycle(record, 'prior'));
    const quarter = currentQuarters.concat(priorQuarters).filter(function (q) { return q.start === quarterStart; })[0];
    if (!quarter) {
      return { statusCode: 400, body: JSON.stringify({ error: 'That quarter is not part of the current or prior annual cycle.' }) };
    }
    const now = new Date();
    if (now < new Date(quarter.dueDate + 'T00:00:00')) {
      return { statusCode: 403, body: JSON.stringify({ error: 'This quarter’s reporting window hasn’t opened yet.' }) };
    }

    const stampedBy = session.name || session.email;
    await markQuarterlyStepDone(location, resident, service, quarterStart, stepKey, filename, stampedBy);

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
