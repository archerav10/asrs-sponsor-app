const { runMarReminderCheck } = require('./lib/mar-reminder-check');

// Not scheduled — safe to hit directly in a browser. Defaults to
// dry-run (composes messages, never sends) unless you pass &send=true.
// &asOf=YYYY-MM-DD simulates running the check on a different calendar
// day, same as test-check-report-status.
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const dryRun = params.send !== 'true';
  const result = await runMarReminderCheck({ dryRun: dryRun, asOf: params.asOf });

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
