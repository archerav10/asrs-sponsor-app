const { updatePage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { ROLES, staffInfoById } = require('./lib/staff-training');

// Sets a staff member's Role on their ASRS People record, which decides
// which Training Requirements apply to them (House Managers are DSP).
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
    const staffId = body.staffId;
    const role = body.role;
    if (!staffId || ROLES.indexOf(role) === -1) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId and a role (' + ROLES.join(', ') + ') are required.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    await updatePage(staffId, { 'Role': { select: { name: role } } });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
