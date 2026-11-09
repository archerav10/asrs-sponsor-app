const lz = require('./lib/liaison');
const lr = require('./lib/location-report');

// Liaison app: concerns the liaison flags (from an interview,
// questionnaire, visit or call). Flags become findings on the Monthly
// Location Compliance Report; the liaison records whether each one was
// escalated to the QA/Issues log.
//   GET                          this home's flags from the last 90 days
//   POST { action: 'create', concern, resident, source, details, escalation }
//   POST { action: 'update', id, escalation, resolved }
exports.handler = async function (event) {
  try {
    const session = lz.requireLiaison(event);
    if (event.httpMethod === 'GET') {
      const since = lz.easternDate(new Date(Date.now() - 90 * 86400000));
      const flags = await lr.flagsFor([{ property: 'Location', select: { equals: session.location } }, { property: 'Flagged On', date: { on_or_after: since } }]);
      return { statusCode: 200, body: JSON.stringify({ flags: flags, sources: lr.SOURCES, escalations: lr.ESCALATIONS }) };
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'create') {
      const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (body.resident && residents.indexOf(body.resident) === -1) throw lz.httpError(400, 'That resident isn’t at this home.');
      return { statusCode: 200, body: JSON.stringify({ flag: await lr.createFlag(session, body) }) };
    }
    if (body.action === 'update') {
      const flag = (await lr.flagsFor([{ property: 'Location', select: { equals: session.location } }])).filter(function (f) { return f.id === body.id; })[0];
      if (!flag) throw lz.httpError(404, 'That flag wasn’t found.');
      return { statusCode: 200, body: JSON.stringify({ flag: await lr.updateFlag(flag.id, { escalation: body.escalation, resolved: body.resolved, escalationNote: body.escalationNote }) }) };
    }
    throw lz.httpError(400, 'Unknown action.');
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
