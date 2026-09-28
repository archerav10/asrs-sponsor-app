const { runDailyProgressNotePdfFailureCheck } = require('./lib/daily-progress-note-pdf-alert');

// Not scheduled — safe to hit directly. Defaults to dry-run. &asOf=
// YYYY-MM-DD simulates running the check as of a different date, since
// a real stale-for-2+-nights failure only exists once one has actually
// accumulated.
//
// A real send (&send=true) additionally requires a POST, same guard as
// test-check-admin-digest.js and every other test-check-*.js in this
// app — a GET (including whatever a browser reload replays) is always a
// dry run.
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const wantsSend = params.send === 'true';
  const canSend = wantsSend && event.httpMethod === 'POST';
  const asOf = params.asOf || null;
  const result = await runDailyProgressNotePdfFailureCheck({ dryRun: !canSend, asOf: asOf });

  if (wantsSend && !canSend) {
    result.note = 'send=true was ignored because this was a GET request — real sends require POST (e.g. curl -X POST …). This response is a dry run.';
  }

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
