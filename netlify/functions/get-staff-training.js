const { requireSession } = require('./lib/session');
const { ROLES, loadRequirements, staffInfoById, staffTrainingStatus } = require('./lib/staff-training');

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

    const checklist = await loadRequirements({ fresh: true });
    const status = await staffTrainingStatus(staff.location, staff, checklist.requirements);
    const windowState = status.window;

    return {
      statusCode: 200,
      body: JSON.stringify({
        staff: {
          id: staff.id,
          name: staff.name,
          location: staff.location,
          role: staff.role,
          roleSet: staff.roleSet,
          folderUrl: staff.trainingFolderUrl || ''
        },
        roles: ROLES,
        steps: status.steps,
        window: {
          hasStarted: windowState.hasStarted,
          missingCount: windowState.missingCount,
          totalCount: windowState.totalCount,
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
