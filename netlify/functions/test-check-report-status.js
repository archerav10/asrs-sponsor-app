const { runReportStatusCheck } = require('./lib/report-status-check');

// Not scheduled — this one is meant to be hit directly in a browser for
// testing. Gated by a shared secret since it's a public URL.
// Defaults to dry-run (composes messages, never sends) unless you
// explicitly pass &send=true.
exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const secret = process.env.NOTIFICATION_TEST_SECRET;

  if (!secret || params.secret !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Missing or incorrect secret.' }) };
  }

  const dryRun = params.send !== 'true';
  const asOf = params.asOf || null; // e.g. "2026-09-23" to simulate that day
  const result = await runReportStatusCheck({ dryRun: dryRun, ignoreTriggerDay: true, asOf: asOf });

  return { statusCode: 200, body: JSON.stringify(result, null, 2) };
};
