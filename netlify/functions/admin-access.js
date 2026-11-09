const { requireSuperAdmin } = require('./lib/super-admin-session');
const access = require('./lib/access');

// Super admin: Access by Location.
//   GET                                     homes, admins, sponsors
//   POST { kind:'admin', id, adminLocations, liaisonLocations }
//   POST { kind:'sponsor', id, location?, residentInitials?, enabled? }
exports.handler = async function (event) {
  try {
    requireSuperAdmin(event);
    if (event.httpMethod === 'GET') return { statusCode: 200, body: JSON.stringify(await access.overview()) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
    const body = JSON.parse(event.body || '{}');
    const data = await access.overview();
    const valid = data.homes.map(function (h) { return h.location; });
    if (body.kind === 'admin') {
      if (!data.admins.some(function (a) { return a.id === body.id; })) return { statusCode: 404, body: JSON.stringify({ error: 'That admin wasn’t found.' }) };
      return { statusCode: 200, body: JSON.stringify({ success: true, admin: await access.saveAdmin(body, valid) }) };
    }
    if (body.kind === 'sponsor') {
      const current = data.sponsors.filter(function (s) { return s.id === body.id; })[0];
      if (!current) return { statusCode: 404, body: JSON.stringify({ error: 'That sponsor wasn’t found.' }) };
      await access.saveSponsor(body, valid, current);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown change.' }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
