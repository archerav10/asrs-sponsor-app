const { runMarReminderCheck } = require('./lib/mar-reminder-check');

// Scheduled (see netlify.toml) — runs daily. Each of the three reminder
// stages only actually fires on its own specific day per period (7 days
// out, 2 days out, the 1st of the new month), guarded by a dedupe flag on
// the period tracker so a same-day re-run or retry never double-sends.
exports.handler = async function () {
  const result = await runMarReminderCheck();
  return { statusCode: 200, body: JSON.stringify(result) };
};
