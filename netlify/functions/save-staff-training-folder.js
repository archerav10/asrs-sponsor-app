const { updatePage } = require('./lib/notion');
const { requireSession } = require('./lib/session');
const { staffInfoById } = require('./lib/staff-training');

// Step 1 equivalent for this process — the one manual, one-time step:
// the app can't discover a staff member's Drive folder on its own, so
// an admin pastes the link once and it's remembered permanently on
// their ASRS People record (Training Folder URL). Unlike Annual
// Planning there's no effective date to set alongside it — this
// process has no shared cycle.
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
    const folderUrl = (body.folderUrl || '').trim();
    if (!staffId || !folderUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'staffId and folderUrl are required.' }) };
    }

    const staff = await staffInfoById(staffId);
    if ((session.grantedLocations || []).indexOf(staff.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }

    await updatePage(staffId, { 'Training Folder URL': { url: folderUrl } });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
