const { requireSession } = require('./lib/session');
const { staffListForLocation, itemsForStaff, computeStaffTrainingWindow } = require('./lib/staff-training');

// Read-only, sponsor-facing traffic light — one row per active staff
// member at the location (unlike Annual Planning/Quarterly Reporting,
// which roll up to one dot per resident, staff here are broken out by
// name since that's what the sponsor asked to see).
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
      return { name: member.name, status: statusForWindow(computeStaffTrainingWindow(items)) };
    }));

    return { statusCode: 200, body: JSON.stringify({ staff: staff }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
