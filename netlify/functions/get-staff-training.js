const { requireSession } = require('./lib/session');
const { staffInfoById, itemsForStaff, fullStepList, computeStaffTrainingWindow } = require('./lib/staff-training');

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
    const staffId = params.staffId;
    if (!staffId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId is required.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    const items = await itemsForStaff(staff.location, staff.name);
    const windowState = computeStaffTrainingWindow(items);

    return {
      statusCode: 200,
      body: JSON.stringify({
        staff: { id: staff.id, name: staff.name, location: staff.location, folderUrl: staff.trainingFolderUrl || '' },
        steps: fullStepList(items),
        window: {
          hasStarted: windowState.hasStarted,
          missingCount: windowState.missingCount,
          dueDate: windowState.dueDate ? windowState.dueDate.toISOString().slice(0, 10) : null,
          isDueSoon: windowState.isDueSoon,
          isOverdue: windowState.isOverdue
        }
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
