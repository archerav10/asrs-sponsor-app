const send = require('./lib/training-modules-send');

// Scheduled weekdays at 10:00 AM Eastern (netlify.toml fires at 14:00 and
// 15:00 UTC; only the run that is 10 AM Eastern goes ahead, so it's right
// in daylight and standard time). Hands the work to module-jobs-background.
// ?force=1 with NOTIFICATION_TEST_SECRET runs it now, for testing.
exports.handler = async function (event) {
  const q = (event && event.queryStringParameters) || {};
  const forced = q.force === '1' && process.env.NOTIFICATION_TEST_SECRET && q.secret === process.env.NOTIFICATION_TEST_SECRET;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(new Date());
  const hour = Number(parts.find(function (p) { return p.type === 'hour'; }).value);
  const weekday = parts.find(function (p) { return p.type === 'weekday'; }).value;
  if (!forced && (hour !== 10 || weekday === 'Sat' || weekday === 'Sun')) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, hour: hour, weekday: weekday }) };
  }
  try {
    await send.startJob('reminders', {});
    return { statusCode: 200, body: JSON.stringify({ started: true }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
