const { runMarAlertCheck } = require('./lib/mar-alert-check');

// Scheduled (see netlify.toml) — Netlify calls this daily, for real,
// every day (no checkpoint gate, since an expired/missing medication
// is urgent the day it happens).
exports.handler = async function () {
  const result = await runMarAlertCheck();
  return { statusCode: 200, body: JSON.stringify(result) };
};
