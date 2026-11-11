const { requireSession } = require('./lib/session');
const { markRevised } = require('./lib/isp-training');

// Plan revised (Annual Planning screen): records a mid-year ISP revision,
// after which every staff member at the location needs ISP training on it.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    }
    const body = JSON.parse(event.body || '{}');
    if (!body.location || !body.resident || !/^\d{4}-\d{2}-\d{2}$/.test(body.revisedDate || '')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'location, resident and the revision date are required.' }) };
    }
    if ((session.grantedLocations || []).indexOf(body.location) === -1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for that location.' }) };
    }
    await markRevised(body.location, body.resident, body.revisedDate, session.name || session.email);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
