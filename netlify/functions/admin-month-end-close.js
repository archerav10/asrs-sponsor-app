const { requireSession } = require('./lib/session');
const mec = require('./lib/month-end-close');
const lr = require('./lib/location-report');

// Admin dashboard: the month-end close card.
//   GET ?month=2026-11        (default: last month)
//   POST { month, action, ... }  see lib/month-end-close save()
exports.handler = async function (event) {
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for the admin dashboard.' }) };
    const locations = (session.grantedLocations || []).slice().sort();
    const who = session.name || session.email;
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const month = q.month || defaultMonth();
      return { statusCode: 200, body: JSON.stringify(await mec.load(month, locations)) };
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      lr.monthBounds(body.month);
      const result = await mec.save(body.month, body, who, locations);
      return { statusCode: 200, body: JSON.stringify({ success: true, result: result && result.snapshot ? Object.assign({}, result, { snapshot: undefined }) : result }) };
    }
    return { statusCode: 405, body: 'Method not allowed' };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};

function defaultMonth() {
  const t = lr.easternToday();
  const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
