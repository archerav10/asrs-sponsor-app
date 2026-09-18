const { runAdminDigestCheck } = require('./lib/admin-digest-check');

// Scheduled (see netlify.toml) — Fridays at 8am ET. Runs every Friday
// unconditionally; unlike the SMS report-status check, there's no
// "trigger day" gate to self-check since Netlify's own cron already
// only fires this once a week.
exports.handler = async function () {
  const result = await runAdminDigestCheck();
  return { statusCode: 200, body: JSON.stringify(result) };
};
