const { requireSession } = require('./lib/session');
const { ROLES, loadRequirements, staffInfoById, staffTrainingStatus, syncFromDrive } = require('./lib/staff-training');
const isp = require('./lib/isp-training');
const { normalizePhone } = require('./lib/twilio');

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

    // Documents put straight into the person's Training folder count too.
    // A Drive problem never stops the screen from loading.
    let drive;
    try {
      drive = await syncFromDrive(staff, checklist.requirements);
    } catch (e) {
      console.error('Staff Training Drive check failed', e);
      drive = { checked: false, added: [], unrecognized: [], error: 'Couldn\'t check the Training folder just now.' };
    }
    const status = await staffTrainingStatus(staff.location, staff, checklist.requirements);
    const windowState = status.window;
    // Resident plan lines carry the person's signing link for that plan.
    const site = isp.siteFor(event);
    status.steps.forEach(function (s) {
      if (s.plan) s.plan.link = isp.signingLink(site, staff, s.plan);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        staff: {
          id: staff.id,
          name: staff.name,
          location: staff.location,
          role: staff.role,
          roleSet: staff.roleSet,
          folderUrl: staff.trainingFolderUrl || '',
          canText: !!normalizePhone(staff.phone) && staff.smsConsent === 'Opted In'
        },
        roles: ROLES,
        drive: drive,
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
