const { requireSession } = require('./lib/session');
const wf = require('./lib/weekly-focus');
const mail = require('./lib/weekly-focus-email');
const { httpError, weekOptions, sponsorsFor, requireAdmin, readFields } = require('./lib/weekly-focus-compose');

// The Compose screen's Preview: the exact email this sponsor would get
// for this week, including their own carried-over checklist items and
// Daily Progress Notes count as of right now. Nothing is saved or sent.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const session = requireSession(event);
    requireAdmin(session);

    const body = JSON.parse(event.body || '{}');
    if (!weekOptions().some(function (w) { return w.weekOf === body.weekOf; })) {
      throw httpError(400, 'Choose this week or one of the next three.');
    }
    const sponsor = (await sponsorsFor(session)).filter(function (s) { return wf.normId(s.id) === wf.normId(body.sponsorId); })[0];
    if (!sponsor) throw httpError(400, 'Choose a sponsor to preview.');

    const content = Object.assign({ weekOf: body.weekOf }, readFields(body));
    const history = await wf.responsesForSponsor(sponsor.email);
    const previous = history.filter(function (r) { return r.weekOf < body.weekOf; })[0] || null;
    const docs = await wf.documentationStatus(sponsor.location, sponsor.residentInitials);
    const email = mail.weeklyEmail(sponsor, content, wf.buildChecklist(content, previous), wf.countDocsBehind(docs));

    return { statusCode: 200, body: JSON.stringify({ subject: email.subject, html: email.html, to: sponsor.name + ' <' + sponsor.email + '>' }) };
  } catch (err) {
    if (!err.statusCode) console.error(err); // expected refusals carry a statusCode
    return { statusCode: err.statusCode || 500, body: JSON.stringify({ error: err.message || 'Something went wrong.' }) };
  }
};
