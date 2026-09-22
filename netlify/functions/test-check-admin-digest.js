const { runAdminDigestCheck } = require('./lib/admin-digest-check');

// Not scheduled — safe to hit directly. Defaults to dry-run (composes
// messages, never sends). &asOf=YYYY-MM-DD simulates running the check
// as of a different date.
//
// A real send (&send=true) additionally requires a POST. A GET request
// can't trigger one, even with &send=true present, no matter what a
// browser does with the URL afterward — reloading a GET (e.g. after a
// timeout/502) just re-runs another harmless dry run, it can never
// silently re-fire real emails to every admin the way a GET-triggered
// send could. Visiting the URL with &send=true in a browser gets back
// a dry run plus an explanation, not an error, so it's still obvious
// what to do next (curl -X POST).
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const wantsSend = params.send === 'true';
  const canSend = wantsSend && event.httpMethod === 'POST';
  const asOf = params.asOf || null;
  const result = await runAdminDigestCheck({ dryRun: !canSend, asOf: asOf });

  if (wantsSend && !canSend) {
    result.note = 'send=true was ignored because this was a GET request — real sends require POST (e.g. curl -X POST …), so a browser reload can never resend for real. This response is a dry run.';
  }

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
