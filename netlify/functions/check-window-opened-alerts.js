const { runWindowOpenedAlertCheck } = require('./lib/window-opened-alert-check');

// Scheduled (see netlify.toml) — daily. Runs unconditionally; each day
// only actually texts anyone if today happens to be an Annual Planning
// or Quarterly Reporting window-open date for some resident/service.
exports.handler = async function () {
  const result = await runWindowOpenedAlertCheck();
  return { statusCode: 200, body: JSON.stringify(result) };
};
