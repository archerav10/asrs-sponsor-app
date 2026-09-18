const { runReportStatusCheck } = require('./lib/report-status-check');

// Scheduled (see netlify.toml) — Netlify calls this daily. All it does
// is defer to the shared logic, which self-gates on whether today is
// actually one of the 3 monthly checkpoints.
exports.handler = async function () {
  const result = await runReportStatusCheck();
  return { statusCode: 200, body: JSON.stringify(result) };
};
