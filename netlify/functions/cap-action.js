const { requireSession } = require('./lib/session');
const cr = require('./lib/cap-review');

// CAP Review changes. Each is checked against the admin's granted locations.
//   { action: 'update', itemId, text, date?, olrStatus?, olrDate?, plannedDate? }
//   { action: 'close', itemId, reason, evidence, evidenceLink?, date? }
//   { action: 'reopen', itemId, reason }
//   { action: 'deleteCap', capId }
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const session = requireSession(event);
    if (session.accountType !== 'admin-dashboard') return json(403, { error: 'Not authorized for the admin dashboard.' });
    const locations = session.grantedLocations || [];
    const by = session.name || session.email;
    const body = JSON.parse(event.body || '{}');

    if (body.action === 'deleteCap') {
      const cap = await cr.capById(body.capId);
      if (locations.indexOf(cap.location) === -1) return json(403, { error: 'Not authorized for that location.' });
      await cr.deleteCap(cap.id);
      return json(200, { deleted: cap.title });
    }

    const item = await cr.itemById(body.itemId);
    if (locations.indexOf(item.location) === -1) return json(403, { error: 'Not authorized for that location.' });
    if (body.action === 'update') return json(200, { item: await cr.addUpdate(item.id, body, by) });
    if (body.action === 'close') return json(200, await cr.closeItem(item.id, body, by));
    if (body.action === 'reopen') return json(200, await cr.reopenItem(item.id, body, by));
    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return json(err.statusCode || 500, { error: err.message || 'Something went wrong.' });
  }
};

function json(status, body) { return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
