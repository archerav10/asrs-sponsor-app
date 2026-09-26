const { requireSession } = require('./lib/session');
const { resolveTarget } = require('./lib/monthly-checklist');

// Read-only status board, same shape as the other oversight endpoints:
// for every granted location, where its monthly checklist currently
// stands. No lead-time window here (see lib/monthly-checklist.js), so
// there's no "opens later" state to report — a location is either
// caught up and waiting on the current month, or overdue on one it
// fell behind on.
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }

    const grantedLocations = session.grantedLocations || [];

    const locations = await Promise.all(grantedLocations.map(async function (location) {
      const target = await resolveTarget(location);
      return {
        location: location,
        period: target.targetPeriod,
        dueDate: target.dueDate.toISOString().slice(0, 10),
        isOverdue: Date.now() >= target.dueDate.getTime(),
        hasStarted: !!target.record,
        // True only in the "finished this month early" case — the
        // target period is capped at the current month until the next
        // one actually begins (see resolveTarget), so a
        // finalized target here means the location is locked/caught up
        // and just waiting on the calendar, not that anything's wrong.
        isFinalizedForTarget: !!(target.record && target.record.finalized)
      };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
