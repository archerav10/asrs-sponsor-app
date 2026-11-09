const lz = require('./lib/liaison');
const qn = require('./lib/questionnaires');

// The Jotform link for a questionnaire, prefilled for this home, resident,
// person and liaison, with the signed app_tracking value.
//   GET ?audience=Resident|Sponsor|DSP&resident=AR&spokeWith=Name
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const session = lz.requireLiaison(event);
    const q = event.queryStringParameters || {};
    if (qn.AUDIENCES.indexOf(q.audience) === -1) throw lz.httpError(400, 'Choose a questionnaire.');
    const residents = (session.residentInitials || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (q.resident && residents.indexOf(q.resident) === -1) throw lz.httpError(403, 'That resident isn\'t at this home.');
    const link = qn.pickLink(await qn.activeLinks(), session.location, q.audience);
    if (!link) throw lz.httpError(404, 'No ' + q.audience.toLowerCase() + ' questionnaire is set up for ' + session.location + ' yet. Add one in the Questionnaire Links table in Notion.');
    const url = qn.buildFormUrl(link, {
      a: q.audience,
      l: session.location,
      r: q.resident || '',
      s: String(q.spokeWith || '').slice(0, 80),
      n: session.name || session.email,
      e: session.email,
      p: lz.periodOf(lz.easternDate()),
      t: Date.now()
    });
    return { statusCode: 200, body: JSON.stringify({ url: url, name: link.name }) };
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
