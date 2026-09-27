const { requireSession } = require('./lib/session');
const { STEPS, staffListForLocation, itemsForStaff, computeStaffTrainingWindow } = require('./lib/staff-training');

// Read-only, sponsor-facing traffic light — one row per active staff
// member at the location (unlike Annual Planning/Quarterly Reporting,
// which roll up to one dot per resident, staff here are broken out by
// name since that's what the sponsor asked to see). Also surfaces WHY a
// yellow/red dot is that color — same reasoning as the admin
// dashboard's own staffPuzzleState, just with the client (not this
// endpoint) doing the date formatting, matching how every other
// provider-app status line works.
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

    const staff = await Promise.all(staffList.map(async function (member) {
      const items = await itemsForStaff(session.location, member.name);
      const windowState = computeStaffTrainingWindow(items);
      return {
        name: member.name,
        status: statusForWindow(windowState),
        missingCount: windowState.missingCount,
        doneCount: STEPS.length - windowState.missingCount,
        totalCount: STEPS.length,
        dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
        isOverdue: windowState.isOverdue
      };
    }));

    return { statusCode: 200, body: JSON.stringify({ staff: staff }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
