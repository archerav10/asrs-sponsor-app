const { runMarAlertCheck } = require('./lib/mar-alert-check');

// Not scheduled — safe to hit directly in a browser. Defaults to
// dry-run (composes messages, never sends) unless you pass &send=true.
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const dryRun = params.send !== 'true';
  const result = await runMarAlertCheck({ dryRun: dryRun });

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
