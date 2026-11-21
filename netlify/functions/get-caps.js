const { requireSession } = require('./lib/session');
const { capsForLocations, capDetail, OLR_STATUSES } = require('./lib/cap-review');

// CAP Review tab.
//   GET                 the CAPs at the admin's granted locations, with counts
//   GET ?capId=...      one CAP with its citations and their updates
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const locations = session.grantedLocations || [];
    const q = event.queryStringParameters || {};
    if (q.capId) {
      const detail = await capDetail(q.capId);
      if (locations.indexOf(detail.cap.location) === -1) return json(403, { error: 'Not authorized for that location.' });
      return json(200, Object.assign({ olrStatuses: OLR_STATUSES }, detail));
    }
    return json(200, { locations: locations, caps: await capsForLocations(locations), olrStatuses: OLR_STATUSES });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
