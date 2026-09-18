const { runAdminDigestCheck } = require('./lib/admin-digest-check');

// Not scheduled — safe to hit directly. Defaults to dry-run (composes
// messages, never sends) unless you pass &send=true. &asOf=YYYY-MM-DD
// simulates running the check as of a different date.
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const dryRun = params.send !== 'true';
  const asOf = params.asOf || null;
  const result = await runAdminDigestCheck({ dryRun: dryRun, asOf: asOf });

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
