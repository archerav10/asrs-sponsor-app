const { startJob } = require('./lib/weekly-focus-trigger');
const { etHour } = require('./lib/weekly-focus');

// Scheduled (see netlify.toml) — Thursdays at 9:00am ET. Hands off to
// weekly-focus-run-background, which reminds every sponsor still
// Pending for this week.
exports.handler = async function () {
  // Scheduled for two UTC hours so it lands on 9:00 Eastern in both
  // daylight and standard time; the other run does nothing.
  if (etHour() !== 9) {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'not 9:00 Eastern' }) };
  }
  const result = await startJob('remind');
  return { statusCode: 200, body: JSON.stringify(result) };
};
