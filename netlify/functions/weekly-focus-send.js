const { startJob } = require('./lib/weekly-focus-trigger');
const { etHour } = require('./lib/weekly-focus');

// Scheduled (see netlify.toml) — Tuesdays at 8:00am ET. Hands off to
// weekly-focus-run-background, which sends this week's Weekly Focus.
exports.handler = async function () {
  // Scheduled for two UTC hours so it lands on 8:00 Eastern in both
  // daylight and standard time; the other run does nothing.
  if (etHour() !== 8) {
    return { statusCode: 200, body: JSON.stringify({ skipped: 'not 8:00 Eastern' }) };
  }
  const result = await startJob('send');
  return { statusCode: 200, body: JSON.stringify(result) };
};
