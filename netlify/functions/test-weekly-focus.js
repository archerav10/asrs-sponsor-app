const { runWeeklySend, runReminders } = require('./lib/weekly-focus-jobs');
const wf = require('./lib/weekly-focus');
const mail = require('./lib/weekly-focus-email');

// Not scheduled. Dry runs only — never sends, never writes. Same secret
// as the other test-check-* endpoints.
//   ?job=send|remind      what the Tuesday send / Thursday reminder would do
//   &weekOf=YYYY-MM-DD    a different week (defaults to this week)
//   &preview=<sponsor email>  returns that sponsor's email as an HTML page
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;
  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  try {
    const weekOf = params.weekOf || wf.weekOfFor(new Date());

    if (params.preview) {
      const sponsor = (await wf.activeSponsors()).filter(function (s) {
        return s.email.toLowerCase() === params.preview.toLowerCase();
      })[0];
      if (!sponsor) return { statusCode: 404, body: 'No active sponsor with that email.' };
      const content = wf.rowsForSponsor(await wf.contentsForWeek(weekOf), sponsor.id)[0];
      if (!content) return { statusCode: 404, body: 'No Ready Weekly Focus row for ' + sponsor.name + ' for the week of ' + weekOf + '.' };
      const history = await wf.responsesForSponsor(sponsor.email);
      const previous = history.filter(function (r) { return r.weekOf < weekOf; })[0] || null;
      const docs = await wf.documentationStatus(sponsor.location, sponsor.residentInitials);
      const email = mail.weeklyEmail(sponsor, content, wf.buildChecklist(content, previous), wf.countDocsBehind(docs));
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: email.html };
    }

    const result = params.job === 'remind'
      ? await runReminders({ weekOf: weekOf, dryRun: true })
      : await runWeeklySend({ weekOf: weekOf, dryRun: true });
    return { statusCode: 200, body: JSON.stringify(result, null, 2) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
