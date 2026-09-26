const { requireSession } = require('./lib/session');
const { staffListForLocation, itemsForStaff, computeStaffTrainingWindow } = require('./lib/staff-training');
const { worstOf } = require('./lib/report-due-date');

// Read-only, sponsor-facing traffic light — one dot for the whole
// location (staff aren't scoped per-resident the way Annual Planning/
// Quarterly Reporting are), worst-of across every active staff member.
function statusForWindow(windowState) {
  if (windowState.missingCount > 0 || windowState.isOverdue) {
    return windowState.isOverdue ? 'red' : 'yellow';
  }
  if (windowState.isDueSoon) return 'yellow';
  return 'green';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    const staffList = await staffListForLocation(session.location);

    const statuses = await Promise.all(staffList.map(async function (member) {
      const items = await itemsForStaff(session.location, member.name);
      return statusForWindow(computeStaffTrainingWindow(items));
    }));

    return { statusCode: 200, body: JSON.stringify({ status: statuses.length ? worstOf(statuses) : 'green' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
