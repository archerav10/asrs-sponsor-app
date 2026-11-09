const { runMonthEndReminders } = require('./lib/month-end-reminders');

// Scheduled (netlify.toml): texts the Risk Manager on the 10th and 16th
// when last month's month-end close still has open items.
exports.handler = async function () {
  try {
    const result = await runMonthEndReminders();
    console.log(JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
