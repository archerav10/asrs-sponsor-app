const { requireSession } = require('./lib/session');
const { staffListForLocation, itemsForStaff, computeStaffTrainingWindow } = require('./lib/staff-training');

function windowSummary(windowState) {
  return {
    hasStarted: windowState.hasStarted,
    missingCount: windowState.missingCount,
    dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
    isDueSoon: windowState.isDueSoon,
    isOverdue: windowState.isOverdue
  };
}

// Read-only status board, same shape as get-mar-review-oversight.js and
// get-annual-planning-oversight.js: for every staff member at every
// location the admin is granted, where their training checklist stands.
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
      const staffList = await staffListForLocation(location);

      const staff = await Promise.all(staffList.map(async function (member) {
        const items = await itemsForStaff(location, member.name);
        const windowState = computeStaffTrainingWindow(items);
        return Object.assign({ id: member.id, name: member.name, hasFolder: !!member.trainingFolderUrl }, windowSummary(windowState));
      }));

      return { location: location, staff: staff };
    }));

    return { statusCode: 200, body: JSON.stringify({ locations: locations }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
