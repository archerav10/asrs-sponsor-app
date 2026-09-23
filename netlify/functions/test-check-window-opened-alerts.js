const { runWindowOpenedAlertCheck } = require('./lib/window-opened-alert-check');

// Not scheduled — safe to hit directly. Defaults to dry-run. &asOf=
// YYYY-MM-DD simulates running the check as of a different date, which
// is the main way to actually test this — a real window-open date only
// exists on the one specific day it happens to fall on.
//
// A real send (&send=true) additionally requires a POST, same guard as
// test-check-admin-digest.js after the digest's duplicate-send incident
// — a GET (including whatever a browser reload replays) is always a
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
  const result = await runWindowOpenedAlertCheck({ dryRun: !canSend, asOf: asOf });

  if (wantsSend && !canSend) {
    result.note = 'send=true was ignored because this was a GET request — real sends require POST (e.g. curl -X POST …). This response is a dry run.';
  }

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
